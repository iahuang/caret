/**
 * Editor: the main component.
 *
 * Responsibilities:
 *   - Subscribe to the store and render blocks.
 *   - Own the offscreen textarea, route keystrokes through the keymap, route
 *     typed characters through `insertText`.
 *   - Translate mouse events into model selections using the DOM mapping.
 *   - Mount the drawn Caret and SelectionLayer.
 *   - Manage a single editing popover that anchors either to an inline atom
 *     adjacent to the caret, or to the math-block the caret is inside of.
 *
 * Popover entry / exit model:
 *   - Inline atom: arrow-right at the position just before the atom, or
 *     arrow-left at the position just after, focuses the popover textarea
 *     instead of stepping past. The main caret stays put; further arrow keys
 *     navigate inside the textarea. Arrow-left at offset 0 / arrow-right at
 *     end of the textarea exits to the corresponding side of the atom.
 *   - Math-block: the whole block is the atom, so any time the caret is in
 *     a math-block we auto-focus the textarea. Exits move the caret to the
 *     adjacent block.
 *   - Click on the atom span or math-block also enters edit mode.
 *   - Escape blurs the textarea, refocuses the hidden input, and leaves the
 *     popover in its read-only "preview" state. The user can then arrow-key
 *     out of the atom/block via normal cursor movement; the auto-enter only
 *     refires when the caret crosses into a *different* popover target.
 */

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
    type RefObject,
} from "react";
import {
    activeMarks,
    deleteSelection,
    findWordBoundaryBackward,
    findWordBoundaryForward,
    insertBlocks,
    insertText,
    sliceDocBySelection,
    updateBlockMetadata,
    updateInlineNode,
    updateLinkHref,
} from "../core/commands";
import { parseMarkdown } from "../core/markdown/parse";
import { serializeDoc } from "../core/markdown/serialize";
import type { Store } from "../core/store";
import { deleteRangeInBlock, findBlockIndex, generateId } from "../core/transform";
import type { Block, InlineNode, Mark } from "../core/types";
import { isCollapsed } from "../core/types";
import { RenderedBlocks } from "./BlockView";
import { Caret } from "./Caret";
import { defaultKeymap } from "./defaultKeymap";
import { defaultRenderers, type BlockRenderer } from "./defaultRenderer";
import { EditorActionsContext, type EditorActions } from "./editorContext";
import { HiddenInput } from "./HiddenInput";
import { ImagePopover } from "./ImagePopover";
import { NodePopover } from "./NodePopover";
import {
    defaultInlineRenderers,
    defaultMarkRenderers,
    type InlineNodeRenderer,
    type MarkRenderer,
} from "./renderInline";
import { SelectionLayer } from "./SelectionLayer";
import { useDomMapping } from "./useDomMapping";
import { useKeymap, type KeyBinding } from "./useKeymap";

export interface EditorProps {
    store: Store;
    renderers?: Record<string, BlockRenderer>;
    markRenderers?: MarkRenderer[];
    inlineRenderers?: InlineNodeRenderer[];
    keymap?: KeyBinding[];
    readOnly?: boolean;
    autoFocus?: boolean;
    className?: string;
    "aria-label"?: string;
    /**
     * Optional host override for the editing popover. Called whenever a
     * popover would otherwise be rendered. Return:
     *   - a ReactNode to use instead of the default popover for this target.
     *   - `null` to suppress the popover entirely for this target.
     *   - `undefined` to fall through to the default popover.
     *
     * The host is responsible for: (a) anchoring/positioning (use
     * `useNodePopoverShell` for the standard contract), (b) routing user
     * intent to `onExitLeft`/`onExitRight`/`onDoneEditing`, and (c) calling
     * `onStartEditing` when the host wants to switch out of preview state.
     */
    renderPopover?: PopoverRenderer;
}

export type PopoverTarget =
    | { kind: "inline"; id: string; atom: InlineNode; blockId: string }
    | { kind: "block"; id: string; block: Block }
    | { kind: "link"; id: string; mark: Mark; blockId: string };

interface PopoverRenderBase {
    editing: boolean;
    containerRef: RefObject<HTMLElement | null>;
    onStartEditing: () => void;
    onDoneEditing: () => void;
    onExitLeft: () => void;
    onExitRight: () => void;
    /**
     * Remove the target from the document entirely. For inline atoms, drops
     * the atom + its placeholder character and parks the caret at the
     * atom's former position. For block targets, splices the block out and
     * lands the caret at the end of the previous block (or start of the
     * next if the deleted block was first; or in a fresh empty paragraph
     * if it was the only block). For links, strips the link mark. Closes
     * the popover and returns focus to the editor.
     *
     * Typical use: backspace inside an empty popover textarea — gives the
     * user a fast undo for a node they just created and didn't fill in.
     */
    onDelete: () => void;
}

export type PopoverRenderContext = PopoverRenderBase &
    (
        | {
              kind: "inline";
              atom: InlineNode;
              blockId: string;
              /** Patches the inline atom's `data` object. */
              onChange: (patch: Partial<Record<string, unknown>>) => void;
          }
        | {
              kind: "block";
              block: Block;
              /** Patches the block's `metadata` object. */
              onChange: (patch: Record<string, unknown>) => void;
          }
        | {
              kind: "link";
              mark: Mark;
              blockId: string;
              /** Replaces the link mark's `href`. */
              onChange: (patch: { href: string }) => void;
          }
    );

export type PopoverRenderer = (ctx: PopoverRenderContext) => ReactNode | undefined;

export function Editor({
    store,
    renderers = defaultRenderers,
    markRenderers = defaultMarkRenderers,
    inlineRenderers = defaultInlineRenderers,
    keymap = defaultKeymap,
    readOnly = false,
    autoFocus = true,
    className,
    "aria-label": ariaLabel = "Editor",
    renderPopover,
}: EditorProps) {
    const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
    const state = useSyncExternalStore(subscribe, store.getState, store.getState);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [inputHasFocus, setInputHasFocus] = useState(false);
    const [windowHasFocus, setWindowHasFocus] = useState(() =>
        typeof document === "undefined" ? true : document.hasFocus(),
    );
    // The editor is "focused" only when our hidden textarea owns DOM focus AND
    // the window itself is focused. Window-level blur doesn't fire `blur` on
    // the textarea in WebKit/Tauri, so we'd otherwise keep drawing the caret
    // while the user is in another app or window.
    const isFocused = inputHasFocus && windowHasFocus;
    const [editingId, setEditingId] = useState<string | null>(null);

    useEffect(() => {
        function onWindowFocus() {
            setWindowHasFocus(true);
        }
        function onWindowBlur() {
            setWindowHasFocus(false);
        }
        window.addEventListener("focus", onWindowFocus);
        window.addEventListener("blur", onWindowBlur);
        return () => {
            window.removeEventListener("focus", onWindowFocus);
            window.removeEventListener("blur", onWindowBlur);
        };
    }, []);

    const mapping = useDomMapping({ containerRef, doc: state.doc });

    const editorActions = useMemo<EditorActions>(
        () => ({
            updateBlockMetadata: (blockId, patch) =>
                store.setState((s) => updateBlockMetadata(s, blockId, patch)),
            dispatch: (fn) => store.setState(fn),
            requestEditing: (id) => setEditingId(id),
        }),
        [store],
    );

    const keymapHandler = useKeymap({ store, mapping, keymap, actions: editorActions, readOnly });

    // The popover target — at most one of: an inline atom adjacent to the
    // caret, the math-block the caret is inside, or the link mark the caret
    // is inside / selection lies within. Priority: block > inline > link.
    //
    // A non-collapsed selection only resolves to a target when it lies
    // entirely within a single link mark — covers the freshly-wrapped link
    // after Cmd-K so the popover is available immediately.
    const popoverTarget = useMemo<PopoverTarget | null>(() => {
        if (!state.selection) return null;
        const sel = state.selection;
        if (sel.anchor.blockId !== sel.focus.blockId) return null;
        const block = state.doc.find((b) => b.id === sel.focus.blockId);
        if (!block) return null;
        const collapsed = isCollapsed(sel);

        if (collapsed) {
            if (block.type === "math-block") {
                return { kind: "block", id: block.id, block };
            }
            const off = sel.focus.offset;
            if (block.inlineNodes) {
                const atom = block.inlineNodes.find(
                    (n) => n.position === off || n.position + 1 === off,
                );
                if (atom) return { kind: "inline", id: atom.id, atom, blockId: block.id };
            }
            const linkMark = block.marks.find(
                (m) => m.type === "link" && m.start < off && off < m.end,
            );
            if (linkMark) {
                const linkId = (linkMark.attrs?.linkId as string | undefined) ?? "";
                if (linkId) {
                    return { kind: "link", id: linkId, mark: linkMark, blockId: block.id };
                }
            }
            return null;
        }

        const lo = Math.min(sel.anchor.offset, sel.focus.offset);
        const hi = Math.max(sel.anchor.offset, sel.focus.offset);
        const linkMark = block.marks.find(
            (m) => m.type === "link" && m.start <= lo && hi <= m.end,
        );
        if (linkMark) {
            const linkId = (linkMark.attrs?.linkId as string | undefined) ?? "";
            if (linkId) {
                return { kind: "link", id: linkId, mark: linkMark, blockId: block.id };
            }
        }
        return null;
    }, [state.selection, state.doc]);

    // Auto-enter math-blocks: tracking by previous target id lets us re-enter
    // only when the caret crosses INTO a new math-block, so Escape can release
    // focus without immediately re-triggering. Inline atoms intentionally
    // don't auto-enter — they require an explicit step-in (arrow or click).
    const prevTargetIdRef = useRef<string | null>(null);
    useEffect(() => {
        const curId = popoverTarget?.id ?? null;
        const prevId = prevTargetIdRef.current;
        if (curId === prevId) return;
        prevTargetIdRef.current = curId;
        if (popoverTarget?.kind === "block") {
            setEditingId(curId);
            return;
        }
        // Cursor moved off the previous target (or to a different inline atom).
        // Drop any stale editing state — explicit entry re-sets it.
        if (editingId !== null && editingId !== curId) {
            setEditingId(null);
        }
    }, [popoverTarget, editingId]);

    // Arrow-into-atom: convert horizontal arrow keys at an atom boundary into
    // a focus-the-textarea action instead of moving the caret past the atom.
    // Runs before the keymap so the regular arrow bindings only fire when no
    // atom is adjacent in the relevant direction.
    const onKeyDown = useCallback(
        (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            const native = e.nativeEvent;
            if (
                popoverTarget?.kind === "inline" &&
                !native.shiftKey &&
                !native.metaKey &&
                !native.altKey &&
                !native.ctrlKey &&
                (native.key === "ArrowRight" || native.key === "ArrowLeft")
            ) {
                const sel = store.getState().selection;
                if (sel && isCollapsed(sel)) {
                    const atom = popoverTarget.atom;
                    const off = sel.focus.offset;
                    const enteringFromLeft = native.key === "ArrowRight" && off === atom.position;
                    const enteringFromRight = native.key === "ArrowLeft" && off === atom.position + 1;
                    if (enteringFromLeft || enteringFromRight) {
                        setEditingId(atom.id);
                        e.preventDefault();
                        return;
                    }
                }
            }
            keymapHandler(e);
        },
        [popoverTarget, keymapHandler, store],
    );

    useEffect(() => {
        if (state.doc.length === 0) {
            store.setState(
                () => ({
                    doc: [{ id: generateId(), type: "paragraph", content: "", marks: [] }],
                    selection: null,
                }),
                { history: false },
            );
        }
    }, [state.doc.length, store]);

    useEffect(() => {
        if (!autoFocus) return;
        inputRef.current?.focus({ preventScroll: true });
        const s = store.getState();
        if (!s.selection && s.doc[0]) {
            store.setState(
                (cur) => ({
                    ...cur,
                    selection: {
                        anchor: { blockId: s.doc[0]!.id, offset: 0 },
                        focus: { blockId: s.doc[0]!.id, offset: 0 },
                    },
                }),
                { history: false },
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Code blocks are the only block type whose content holds literal newlines.
    // Elsewhere we collapse them to spaces so paragraphs stay single-line.
    const sanitizeInsertedText = useCallback((text: string): string => {
        const s = store.getState();
        const blockId = s.selection?.focus.blockId;
        if (!blockId) return text.replace(/\r?\n/g, " ");
        const block = s.doc.find((b) => b.id === blockId);
        if (block?.type === "code-block") return text.replace(/\r\n?/g, "\n");
        return text.replace(/\r?\n/g, " ");
    }, [store]);

    const onInput = useCallback(
        (e: FormEvent<HTMLTextAreaElement>) => {
            if (readOnly) return;
            const target = e.currentTarget;
            const value = target.value;
            if (!value) return;
            const text = sanitizeInsertedText(value);
            store.setState((s) => insertText(s, text));
            target.value = "";
        },
        [store, readOnly, sanitizeInsertedText],
    );

    // The hidden textarea is empty (cleared after each keystroke), so the
    // browser's default copy/cut would put nothing on the clipboard. We
    // serialize the model selection to markdown and write it ourselves.
    const onCopy = useCallback(
        (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            const s = store.getState();
            if (!s.selection || isCollapsed(s.selection)) return;
            const blocks = sliceDocBySelection(s);
            if (blocks.length === 0) return;
            const md = serializeDoc(blocks);
            e.clipboardData.setData("text/plain", md);
            e.preventDefault();
        },
        [store],
    );

    const onCut = useCallback(
        (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            if (readOnly) return;
            const s = store.getState();
            if (!s.selection || isCollapsed(s.selection)) return;
            const blocks = sliceDocBySelection(s);
            if (blocks.length === 0) return;
            const md = serializeDoc(blocks);
            e.clipboardData.setData("text/plain", md);
            e.preventDefault();
            store.setState((state) => deleteSelection(state));
        },
        [store, readOnly],
    );

    // Paste parses clipboard text as markdown. text/html is intentionally
    // ignored — that's a separate, much hairier integration. For block-typed
    // pastes (e.g. inside a code-block, which holds literal newlines), the
    // markdown parse would collapse structure, so fall back to plain-text
    // insertion via `insertText`.
    const onPaste = useCallback(
        (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            if (readOnly) return;
            const text = e.clipboardData.getData("text/plain");
            if (!text) return;
            e.preventDefault();
            const s = store.getState();
            const blockId = s.selection?.focus.blockId;
            const targetBlock = blockId ? s.doc.find((b) => b.id === blockId) : undefined;
            if (targetBlock?.type === "code-block") {
                store.setState((cur) => insertText(cur, sanitizeInsertedText(text)));
                return;
            }
            const blocks = parseMarkdown(text);
            if (blocks.length === 0) return;
            store.setState((cur) => insertBlocks(cur, blocks));
        },
        [store, readOnly, sanitizeInsertedText],
    );

    const lastClickRef = useRef<{ time: number; x: number; y: number; count: number } | null>(null);
    const DOUBLE_CLICK_WINDOW_MS = 500;
    const DOUBLE_CLICK_DISTANCE_PX = 4;

    const onContainerMouseDown = useCallback(
        (e: ReactMouseEvent) => {
            if (e.button !== 0) return;
            // Math-block: the whole block is the atom. A click anywhere on
            // the block (including the KaTeX display, which is otherwise
            // `data-no-content`) should drop the caret in and enter edit mode.
            // Has to come before the `data-no-content` early-return below.
            const targetEl = e.target as HTMLElement | null;
            const mathBlockEl = targetEl?.closest(
                "[data-block-type='math-block']",
            ) as HTMLElement | null;
            if (mathBlockEl) {
                const blockId = mathBlockEl.getAttribute("data-block-id");
                if (blockId) {
                    const blockPos = { blockId, offset: 0 };
                    store.setState(
                        (s) => ({
                            ...s,
                            selection: { anchor: blockPos, focus: blockPos },
                            storedMarks: null,
                        }),
                        { history: false },
                    );
                    setEditingId(blockId);
                    e.preventDefault();
                    return;
                }
            }
            // Let renderer-owned widgets (e.g. the code-block language dropdown)
            // receive mousedown normally. These mark themselves `data-no-content`
            // and sit INSIDE a block — the closest `[data-block-id]` ancestor
            // contains the no-content widget. Outer wrappers like the table
            // <tr>/<thead>/<tbody> also carry `data-no-content` (for the DOM
            // walker) but CONTAIN cell blocks; clicks inside a cell must not
            // be swallowed.
            const nc = targetEl?.closest("[data-no-content]");
            if (nc) {
                const bi = targetEl?.closest("[data-block-id]");
                if (!bi || bi.contains(nc)) return;
            }
            const pos = mapping.positionFromPoint(e.clientX, e.clientY);
            if (!pos) return;
            // Click landed on an inline atom — enter edit mode in addition to
            // dropping the caret. The popover's own focus effect takes over
            // from there, so we skip the usual `inputRef.focus` (focusing the
            // hidden input would steal focus right back from the textarea).
            const atomEl = targetEl?.closest("[data-atom-id]") as HTMLElement | null;
            const clickedAtomId = atomEl?.getAttribute("data-atom-id") ?? null;

            const now = Date.now();
            const last = lastClickRef.current;
            const isMulti =
                last !== null &&
                now - last.time < DOUBLE_CLICK_WINDOW_MS &&
                Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_CLICK_DISTANCE_PX;
            const clickCount = isMulti ? last!.count + 1 : 1;
            lastClickRef.current = { time: now, x: e.clientX, y: e.clientY, count: clickCount };

            if (clickCount === 2) {
                const cur = store.getState();
                const blockIdx = findBlockIndex(cur.doc, pos.blockId);
                const block = blockIdx >= 0 ? cur.doc[blockIdx] : undefined;
                if (block) {
                    const start = findWordBoundaryBackward(block.content, pos.offset);
                    const end = findWordBoundaryForward(block.content, pos.offset);
                    if (start !== end) {
                        store.setState(
                            (s) => ({
                                ...s,
                                selection: {
                                    anchor: { blockId: pos.blockId, offset: start },
                                    focus: { blockId: pos.blockId, offset: end },
                                },
                                storedMarks: null,
                            }),
                            { history: false },
                        );
                        inputRef.current?.focus({ preventScroll: true });
                        e.preventDefault();
                        return;
                    }
                }
            }

            const extend = e.shiftKey;
            const initial = store.getState();
            const anchor = extend && initial.selection ? initial.selection.anchor : pos;
            store.setState(
                () => ({
                    ...initial,
                    selection: { anchor, focus: pos },
                    storedMarks: null,
                }),
                { history: false },
            );
            if (clickedAtomId) {
                setEditingId(clickedAtomId);
            } else {
                inputRef.current?.focus({ preventScroll: true });
            }
            e.preventDefault();

            function onMove(ev: globalThis.MouseEvent) {
                const next = mapping.positionFromPoint(ev.clientX, ev.clientY);
                if (!next) return;
                store.setState(
                    (s) => ({ ...s, selection: { anchor, focus: next }, storedMarks: null }),
                    { history: false },
                );
            }
            function onUp() {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            }
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        },
        [mapping, store],
    );

    const renderedBlocks = useMemo(
        () => (
            <RenderedBlocks
                doc={state.doc}
                renderers={renderers}
                markRenderers={markRenderers}
                inlineRenderers={inlineRenderers}
            />
        ),
        [state.doc, renderers, markRenderers, inlineRenderers],
    );

    // Exit the popover by moving the main caret to the appropriate side of
    // the target. For inline atoms that's just before / just after the atom.
    // For links it's mark.start / mark.end. For math-blocks it's the previous
    // / next block; clamp to no-op at the document edges (Escape is still
    // available as a manual fallback).
    const exitPopover = useCallback(
        (side: "left" | "right") => {
            if (!popoverTarget) return;
            const cur = store.getState();
            if (popoverTarget.kind === "inline") {
                const off = popoverTarget.atom.position + (side === "right" ? 1 : 0);
                const target = { blockId: popoverTarget.blockId, offset: off };
                store.setState(
                    (s) => ({
                        ...s,
                        selection: { anchor: target, focus: target },
                        storedMarks: null,
                    }),
                    { history: false },
                );
            } else if (popoverTarget.kind === "link") {
                const off = side === "right" ? popoverTarget.mark.end : popoverTarget.mark.start;
                const target = { blockId: popoverTarget.blockId, offset: off };
                store.setState(
                    (s) => ({
                        ...s,
                        selection: { anchor: target, focus: target },
                        // Stepping out of a link via the popover should not
                        // re-absorb the next typed char.
                        storedMarks: side === "right" ? [] : null,
                    }),
                    { history: false },
                );
            } else {
                const idx = findBlockIndex(cur.doc, popoverTarget.block.id);
                let target: { blockId: string; offset: number } | null = null;
                if (side === "left" && idx > 0) {
                    const prev = cur.doc[idx - 1]!;
                    target = { blockId: prev.id, offset: prev.content.length };
                } else if (side === "right" && idx >= 0 && idx < cur.doc.length - 1) {
                    const next = cur.doc[idx + 1]!;
                    target = { blockId: next.id, offset: 0 };
                }
                if (!target) return;
                store.setState(
                    (s) => ({
                        ...s,
                        selection: { anchor: target!, focus: target! },
                        storedMarks: null,
                    }),
                    { history: false },
                );
            }
            setEditingId(null);
            inputRef.current?.focus({ preventScroll: true });
        },
        [popoverTarget, store],
    );

    // Remove the popover's target from the doc and return focus to the editor.
    // For inline atoms: drop the atom + placeholder char; caret to where the
    // atom was. For blocks: splice the block out; caret to end of prev (or
    // start of next if first; or a fresh paragraph if the block was alone).
    // For links: strip the mark only — the labeled text remains in place.
    const deletePopoverTarget = useCallback(() => {
        if (!popoverTarget) return;
        if (popoverTarget.kind === "inline") {
            const { atom, blockId } = popoverTarget;
            store.setState((s) => {
                const idx = findBlockIndex(s.doc, blockId);
                if (idx < 0) return s;
                const b = s.doc[idx]!;
                if (!b.inlineNodes?.some((n) => n.id === atom.id)) return s;
                const next = deleteRangeInBlock(b, atom.position, atom.position + 1);
                const doc = s.doc.slice();
                doc[idx] = next;
                return {
                    ...s,
                    doc,
                    selection: {
                        anchor: { blockId, offset: atom.position },
                        focus: { blockId, offset: atom.position },
                    },
                    storedMarks: null,
                };
            });
        } else if (popoverTarget.kind === "block") {
            const blockId = popoverTarget.block.id;
            store.setState((s) => {
                const idx = findBlockIndex(s.doc, blockId);
                if (idx < 0) return s;
                const doc = s.doc.slice();
                doc.splice(idx, 1);
                let target: { blockId: string; offset: number };
                if (idx > 0) {
                    const prev = doc[idx - 1]!;
                    target = { blockId: prev.id, offset: prev.content.length };
                } else if (doc.length > 0) {
                    const next = doc[0]!;
                    target = { blockId: next.id, offset: 0 };
                } else {
                    const para: Block = {
                        id: generateId(),
                        type: "paragraph",
                        content: "",
                        marks: [],
                    };
                    doc.push(para);
                    target = { blockId: para.id, offset: 0 };
                }
                return {
                    ...s,
                    doc,
                    selection: { anchor: target, focus: target },
                    storedMarks: null,
                };
            });
        } else {
            const linkId = popoverTarget.id;
            store.setState((s) => {
                const doc = s.doc.map((b) => {
                    const filtered = b.marks.filter(
                        (m) => !(m.type === "link" && m.attrs?.linkId === linkId),
                    );
                    if (filtered.length === b.marks.length) return b;
                    return { ...b, marks: filtered };
                });
                return { ...s, doc, storedMarks: null };
            });
        }
        setEditingId(null);
        inputRef.current?.focus({ preventScroll: true });
    }, [popoverTarget, store]);

    const popoverElement = useMemo(() => {
        if (!popoverTarget) return null;
        const onDoneEditing = () => {
            setEditingId(null);
            inputRef.current?.focus({ preventScroll: true });
        };
        const onExitLeft = () => exitPopover("left");
        const onExitRight = () => exitPopover("right");
        const editing = editingId === popoverTarget.id;
        const onStartEditing = () => setEditingId(popoverTarget.id);

        if (renderPopover) {
            const base = {
                editing,
                containerRef,
                onStartEditing,
                onDoneEditing,
                onExitLeft,
                onExitRight,
                onDelete: deletePopoverTarget,
            };
            let ctx: PopoverRenderContext;
            if (popoverTarget.kind === "inline") {
                const atom = popoverTarget.atom;
                ctx = {
                    ...base,
                    kind: "inline",
                    atom,
                    blockId: popoverTarget.blockId,
                    onChange: (patch) =>
                        store.setState((s) => updateInlineNode(s, atom.id, patch)),
                };
            } else if (popoverTarget.kind === "block") {
                const block = popoverTarget.block;
                ctx = {
                    ...base,
                    kind: "block",
                    block,
                    onChange: (patch) =>
                        store.setState((s) => updateBlockMetadata(s, block.id, patch)),
                };
            } else {
                const linkId = popoverTarget.id;
                ctx = {
                    ...base,
                    kind: "link",
                    mark: popoverTarget.mark,
                    blockId: popoverTarget.blockId,
                    onChange: (patch) =>
                        store.setState((s) => updateLinkHref(s, linkId, patch.href)),
                };
            }
            const hostNode = renderPopover(ctx);
            if (hostNode !== undefined) return hostNode;
            // Fall through to defaults.
        }

        if (popoverTarget.kind === "inline" && popoverTarget.atom.type === "image") {
            const atom = popoverTarget.atom;
            return (
                <ImagePopover
                    anchorSelector={`[data-atom-id="${atom.id}"]`}
                    alt={(atom.data.alt as string | undefined) ?? ""}
                    src={(atom.data.src as string | undefined) ?? ""}
                    editing={editing}
                    onStartEditing={onStartEditing}
                    onChange={(patch) =>
                        store.setState((s) => updateInlineNode(s, atom.id, patch))
                    }
                    onDoneEditing={onDoneEditing}
                    onExitLeft={onExitLeft}
                    onExitRight={onExitRight}
                    containerRef={containerRef}
                />
            );
        }

        if (popoverTarget.kind === "inline") {
            const atom = popoverTarget.atom;
            return (
                <NodePopover
                    anchorSelector={`[data-atom-id="${atom.id}"]`}
                    label={atom.type}
                    value={(atom.data.latex as string | undefined) ?? ""}
                    editing={editing}
                    onStartEditing={onStartEditing}
                    onChange={(latex) =>
                        store.setState((s) => updateInlineNode(s, atom.id, { latex }))
                    }
                    onDoneEditing={onDoneEditing}
                    onExitLeft={onExitLeft}
                    onExitRight={onExitRight}
                    containerRef={containerRef}
                />
            );
        }

        if (popoverTarget.kind === "link") {
            const linkId = popoverTarget.id;
            const href = (popoverTarget.mark.attrs?.href as string | undefined) ?? "";
            return (
                <NodePopover
                    anchorSelector={`[data-link-id="${linkId}"]`}
                    label="link"
                    value={href}
                    editing={editing}
                    onStartEditing={onStartEditing}
                    onChange={(next) => store.setState((s) => updateLinkHref(s, linkId, next))}
                    onDoneEditing={onDoneEditing}
                    onExitLeft={onExitLeft}
                    onExitRight={onExitRight}
                    containerRef={containerRef}
                    placeholder="URL"
                    openHref={href}
                />
            );
        }

        const block = popoverTarget.block;
        return (
            <NodePopover
                anchorSelector={`[data-block-id="${block.id}"]`}
                label="math"
                value={(block.metadata?.latex as string | undefined) ?? ""}
                editing={editing}
                onStartEditing={onStartEditing}
                onChange={(latex) =>
                    store.setState((s) => updateBlockMetadata(s, block.id, { latex }))
                }
                onDoneEditing={onDoneEditing}
                onExitLeft={onExitLeft}
                onExitRight={onExitRight}
                containerRef={containerRef}
                anchorAlignment="center"
            />
        );
    }, [popoverTarget, editingId, exitPopover, deletePopoverTarget, store, renderPopover]);

    return (
        <div
            ref={containerRef}
            className={`mdedit-editor${className ? ` ${className}` : ""}`}
            role="textbox"
            aria-label={ariaLabel}
            aria-multiline="true"
            aria-readonly={readOnly}
            onMouseDown={onContainerMouseDown}
        >
            <HiddenInput
                ref={inputRef}
                onKeyDown={onKeyDown}
                onInput={onInput}
                onPaste={onPaste}
                onCopy={onCopy}
                onCut={onCut}
                onFocus={() => setInputHasFocus(true)}
                onBlur={() => setInputHasFocus(false)}
            />
            <EditorActionsContext.Provider value={editorActions}>
                <div className="mdedit-content">{renderedBlocks}</div>
            </EditorActionsContext.Provider>
            <SelectionLayer
                selection={state.selection}
                doc={state.doc}
                containerRef={containerRef}
                mapping={mapping}
            />
            <Caret
                selection={state.selection}
                doc={state.doc}
                containerRef={containerRef}
                mapping={mapping}
                isFocused={isFocused}
                activeMarks={activeMarks(state)}
            />
            {popoverElement}
        </div>
    );
}
