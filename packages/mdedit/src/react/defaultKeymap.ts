/**
 * Default keybindings.
 *
 * Groups:
 *   - Editing:    Backspace, Delete, Enter
 *   - Word-level: Alt/Option + Arrows / Backspace / Delete  (Ctrl on non-Mac)
 *   - Line-level: Cmd + Arrows / Backspace / Delete         (Mac only)
 *   - Marks:      Cmd/Ctrl + B/I/E/Shift-X
 *   - Block type: Cmd/Ctrl + Alt + 0..6, Cmd/Ctrl + Shift + 7/8
 *   - Lists:      Tab / Shift-Tab to indent/outdent
 *   - History:    Cmd/Ctrl + Z, Shift-Z
 *   - Navigation: Arrows, Home, End
 *   - Selection:  Cmd/Ctrl + A
 *
 * Word boundaries use the core `findWordBoundary*` helpers. Visual-line
 * boundaries use `caretPositionFromPoint(0|width, y)` — one hit-test, no
 * canvas measurement.
 */

import {
    deleteBackward,
    deleteForward,
    deleteSelection,
    findWordBoundaryBackward,
    findWordBoundaryForward,
    indentBlock,
    insertBreak,
    insertInlineNode,
    insertText,
    nextCharOffset,
    prevCharOffset,
    setBlockType,
    toggleMark,
    wrapSelectionInLink,
} from "../core/commands";
import { moveToAdjacentCell, tabToNextCell } from "../core/tableCommands";
import type { Store } from "../core/store";
import { findBlockIndex, generateId } from "../core/transform";
import type { DocState, Position, Selection } from "../core/types";
import { isCollapsed } from "../core/types";
import type { DomMapping } from "./useDomMapping";
import type { KeyBinding, KeyContext } from "./useKeymap";

const isMac =
    typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const LIST_TYPES = new Set(["bullet-item", "ordered-item", "task-item"]);

function mod(e: KeyboardEvent): boolean {
    return isMac ? e.metaKey : e.ctrlKey;
}

/** "Word-jump" modifier — Option on Mac, Ctrl elsewhere. */
function wordMod(e: KeyboardEvent): boolean {
    return isMac ? e.altKey : e.ctrlKey;
}

/** "Line-jump" modifier — Cmd on Mac only. */
function lineMod(e: KeyboardEvent): boolean {
    return isMac && e.metaKey;
}

function setSelection(store: Store, sel: Selection) {
    store.setState((s) => ({ ...s, selection: sel }), { history: false });
}

function applyMovement(store: Store, target: Position, extend: boolean) {
    store.setState(
        (s) => ({
            ...s,
            selection: {
                anchor: extend && s.selection ? s.selection.anchor : target,
                focus: target,
            },
            // Cursor movement always clears any pending mark override.
            storedMarks: null,
        }),
        { history: false },
    );
}

function currentRect(mapping: DomMapping, store: Store): DOMRect | null {
    const sel = store.getState().selection;
    if (!sel) return null;
    return mapping.clientRectForPosition(sel.focus);
}

function deleteFromCurrentTo(store: Store, target: Position) {
    const state = store.getState();
    if (!state.selection) return;
    const cur = state.selection.focus;
    store.setState((s) =>
        deleteSelection({ ...s, selection: { anchor: cur, focus: target } }),
    );
}

// =============================================================================
// Movement helpers
// =============================================================================

function withWrapAffinity(ctx: KeyContext, pos: Position): Position {
    if (pos.affinity) return pos;
    if (ctx.mapping.isWrapBoundary(pos.blockId, pos.offset)) {
        return { ...pos, affinity: "downstream" };
    }
    return pos;
}

function moveByChar(ctx: KeyContext, dir: "left" | "right", extend: boolean) {
    const state = ctx.store.getState();
    if (!state.selection) return;
    const cur = state.selection.focus;
    const idx = findBlockIndex(state.doc, cur.blockId);
    if (idx < 0) return;
    const block = state.doc[idx]!;
    let next: Position = cur;
    if (dir === "left") {
        // Grapheme-aware stepping so the caret never lands inside a
        // surrogate pair (emoji).
        if (cur.offset > 0) next = { blockId: cur.blockId, offset: prevCharOffset(block.content, cur.offset) };
        else if (idx > 0) {
            const prev = state.doc[idx - 1]!;
            next = { blockId: prev.id, offset: prev.content.length };
        }
    } else {
        if (cur.offset < block.content.length) next = { blockId: cur.blockId, offset: nextCharOffset(block.content, cur.offset) };
        else if (idx < state.doc.length - 1) {
            const after = state.doc[idx + 1]!;
            next = { blockId: after.id, offset: 0 };
        }
    }
    applyMovement(ctx.store, withWrapAffinity(ctx, next), extend);
}

function moveByWord(ctx: KeyContext, dir: "left" | "right", extend: boolean) {
    const state = ctx.store.getState();
    if (!state.selection) return;
    const cur = state.selection.focus;
    const idx = findBlockIndex(state.doc, cur.blockId);
    if (idx < 0) return;
    const block = state.doc[idx]!;
    let next: Position;
    if (dir === "left") {
        const newOff = findWordBoundaryBackward(block.content, cur.offset);
        if (newOff === cur.offset && idx > 0) {
            const prev = state.doc[idx - 1]!;
            next = { blockId: prev.id, offset: prev.content.length };
        } else {
            next = { blockId: cur.blockId, offset: newOff };
        }
    } else {
        const newOff = findWordBoundaryForward(block.content, cur.offset);
        if (newOff === cur.offset && idx < state.doc.length - 1) {
            const after = state.doc[idx + 1]!;
            next = { blockId: after.id, offset: 0 };
        } else {
            next = { blockId: cur.blockId, offset: newOff };
        }
    }
    applyMovement(ctx.store, withWrapAffinity(ctx, next), extend);
}

function moveVertical(ctx: KeyContext, dir: "up" | "down", extend: boolean) {
    const r = currentRect(ctx.mapping, ctx.store);
    if (!r) return;
    const state = ctx.store.getState();
    if (!state.selection) return;
    const cur = state.selection.focus;
    const lineHeight = r.height || 20;
    const x = r.left;

    // Walk outward in line-height-sized steps. A single half-line nudge often
    // lands in the inter-block margin (where `caretPositionFromPoint` returns
    // null) when the caret is on the first/last visual line of a block.
    for (let step = 0; step < 4; step++) {
        const dy = lineHeight * (0.5 + step);
        const y = dir === "up" ? r.top - dy : r.bottom + dy;
        const next = ctx.mapping.positionFromPoint(x, y);
        if (!next) continue;
        if (next.blockId === cur.blockId && next.offset === cur.offset) continue;
        // Reject probes that snap to a position in the wrong vertical
        // direction (or back onto the current visual line). Two failure
        // modes share this fix:
        //  - The y target lands in a block's padding (common in table cells)
        //    and `caretPositionFromPoint` returns the nearest text position
        //    on the current line. Without this, ArrowDown in a padded cell
        //    would walk the caret to the cell's text end before crossing
        //    into the row below.
        //  - The y target lands in the inter-block margin around an atomic
        //    block (HR, math) whose `data-block-content` is 0-height. WebKit
        //    snaps to the closest text caret, which can be in the OPPOSITE
        //    direction (e.g. the top of the document). Without this, ArrowDown
        //    from a paragraph just above an HR teleports to the doc start.
        const nextRect = ctx.mapping.clientRectForPosition(next);
        if (nextRect) {
            if (dir === "down" && nextRect.top < r.top + lineHeight * 0.5) continue;
            if (dir === "up" && nextRect.bottom > r.bottom - lineHeight * 0.5) continue;
        }
        applyMovement(ctx.store, next, extend);
        return;
    }

    // Hit-testing failed (e.g. tall headings + margins). Fall back to the
    // doc-level neighbor block at the corresponding edge offset.
    const idx = findBlockIndex(state.doc, cur.blockId);
    if (idx < 0) return;
    if (dir === "up" && idx > 0) {
        const prev = state.doc[idx - 1]!;
        applyMovement(ctx.store, { blockId: prev.id, offset: prev.content.length }, extend);
    } else if (dir === "down" && idx < state.doc.length - 1) {
        const after = state.doc[idx + 1]!;
        applyMovement(ctx.store, { blockId: after.id, offset: 0 }, extend);
    }
}

/**
 * Visual-line edge of the focused block at the caret's vertical position.
 * Hit-tests against the focused block's content rect (not the viewport),
 * so this works regardless of where the editor sits in the page layout.
 */
function lineEdgePosition(ctx: KeyContext, edge: "start" | "end") {
    const state = ctx.store.getState();
    if (!state.selection) return null;
    const r = currentRect(ctx.mapping, ctx.store);
    if (!r) return null;
    const blockEl = ctx.mapping.findBlockElement(state.selection.focus.blockId);
    if (!blockEl) return null;
    const contentEl =
        (blockEl.querySelector("[data-block-content]") as HTMLElement | null) ?? blockEl;
    const cr = contentEl.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const x = edge === "start" ? cr.left + 0.5 : cr.right - 0.5;
    return ctx.mapping.positionFromPoint(x, y);
}

function moveToLineEdge(ctx: KeyContext, edge: "start" | "end", extend: boolean) {
    const next = lineEdgePosition(ctx, edge);
    if (!next) return;
    applyMovement(ctx.store, next, extend);
}

// =============================================================================
// Delete helpers
// =============================================================================

function deleteByWord(ctx: KeyContext, dir: "back" | "forward") {
    const state = ctx.store.getState();
    if (!state.selection) return;
    const cur = state.selection.focus;
    const idx = findBlockIndex(state.doc, cur.blockId);
    if (idx < 0) return;
    const block = state.doc[idx]!;
    let target: Position;
    if (dir === "back") {
        const newOff = findWordBoundaryBackward(block.content, cur.offset);
        if (newOff === cur.offset && idx > 0) {
            const prev = state.doc[idx - 1]!;
            target = { blockId: prev.id, offset: prev.content.length };
        } else {
            target = { blockId: cur.blockId, offset: newOff };
        }
    } else {
        const newOff = findWordBoundaryForward(block.content, cur.offset);
        if (newOff === cur.offset && idx < state.doc.length - 1) {
            const after = state.doc[idx + 1]!;
            target = { blockId: after.id, offset: 0 };
        } else {
            target = { blockId: cur.blockId, offset: newOff };
        }
    }
    if (target.blockId === cur.blockId && target.offset === cur.offset) return;
    deleteFromCurrentTo(ctx.store, target);
}

function deleteToLineEdge(ctx: KeyContext, edge: "start" | "end") {
    const target = lineEdgePosition(ctx, edge);
    if (!target) return;
    const state = ctx.store.getState();
    if (!state.selection) return;
    const cur = state.selection.focus;
    if (target.blockId === cur.blockId && target.offset === cur.offset) return;
    deleteFromCurrentTo(ctx.store, target);
}

// =============================================================================
// Bindings
// =============================================================================

export const defaultKeymap: KeyBinding[] = [
    // ---- Word- and line-level delete (must come before plain Backspace/Delete) ----
    {
        match: (e) => e.key === "Backspace" && wordMod(e) && !lineMod(e),
        run: (ctx) => {
            deleteByWord(ctx, "back");
            return true;
        },
    },
    {
        match: (e) => e.key === "Delete" && wordMod(e) && !lineMod(e),
        run: (ctx) => {
            deleteByWord(ctx, "forward");
            return true;
        },
    },
    {
        match: (e) => e.key === "Backspace" && lineMod(e),
        run: (ctx) => {
            deleteToLineEdge(ctx, "start");
            return true;
        },
    },
    {
        match: (e) => e.key === "Delete" && lineMod(e),
        run: (ctx) => {
            deleteToLineEdge(ctx, "end");
            return true;
        },
    },

    // ---- Plain editing ----
    {
        match: (e) => e.key === "Backspace",
        run: ({ store }) => {
            store.setState(deleteBackward);
            return true;
        },
    },
    {
        match: (e) => e.key === "Delete",
        run: ({ store }) => {
            store.setState(deleteForward);
            return true;
        },
    },
    {
        match: (e) => e.key === "Enter" && !e.shiftKey,
        run: ({ store }) => {
            store.setState(insertBreak);
            return true;
        },
    },

    // ---- Tab: code-block indent, list indent/outdent, table cell navigation ----
    {
        match: (e) => e.key === "Tab",
        run: ({ store, event }) => {
            const state: DocState = store.getState();
            if (!state.selection) return true; // swallow so focus doesn't move
            const focus = state.selection.focus;
            const idx = findBlockIndex(state.doc, focus.blockId);
            const block = state.doc[idx];
            if (!block) return true;
            // Table cells: Tab cycles forward through cells (appending a row at
            // the end), Shift-Tab cycles backward (no-op at the head).
            if (block.type === "table-cell") {
                if (event.shiftKey) {
                    store.setState((s) => moveToAdjacentCell(s, "prev"));
                } else {
                    store.setState(tabToNextCell);
                }
                return true;
            }
            // Inside a code block Tab inserts four spaces. Shift-Tab is a no-op
            // for now — outdent-by-leading-whitespace can come later.
            if (block.type === "code-block") {
                if (event.shiftKey) return true;
                store.setState((s) => insertText(s, "    "));
                return true;
            }
            // Blockquotes also use Tab/Shift-Tab to nest/unnest, via
            // `metadata.depth` (min 1). Same offset==0 rule as lists.
            if (block.type === "blockquote") {
                if (event.shiftKey) {
                    store.setState((s) => indentBlock(s, -1));
                    return true;
                }
                if (focus.offset !== 0) return true;
                store.setState((s) => indentBlock(s, 1));
                return true;
            }
            if (!LIST_TYPES.has(block.type)) return true; // swallow
            if (event.shiftKey) {
                store.setState((s) => indentBlock(s, -1));
                return true;
            }
            // Tab indents only at the start of a list item — matches the user
            // model of "tab to nest this whole item".
            if (focus.offset !== 0) return true;
            store.setState((s) => indentBlock(s, 1));
            return true;
        },
    },

    // ---- Formatting marks ----
    {
        match: (e) => mod(e) && e.key.toLowerCase() === "b",
        run: ({ store }) => {
            store.setState((s) => toggleMark(s, "bold"));
            return true;
        },
    },
    {
        match: (e) => mod(e) && e.key.toLowerCase() === "i",
        run: ({ store }) => {
            store.setState((s) => toggleMark(s, "italic"));
            return true;
        },
    },
    {
        match: (e) => mod(e) && e.key.toLowerCase() === "e",
        run: ({ store }) => {
            store.setState((s) => toggleMark(s, "code"));
            return true;
        },
    },
    {
        match: (e) => mod(e) && e.shiftKey && e.key.toLowerCase() === "x",
        run: ({ store }) => {
            store.setState((s) => toggleMark(s, "strike"));
            return true;
        },
    },

    // ---- Link ----
    // Cmd-K: if the caret is inside an existing link, open its popover in
    // edit mode; otherwise wrap the selection (or insert a placeholder if
    // collapsed) in a new link and immediately open the popover.
    {
        match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k",
        run: ({ store, actions }) => {
            const state = store.getState();
            if (!state.selection) return true;
            const sel = state.selection;
            const block = state.doc.find((b) => b.id === sel.focus.blockId);
            // Atomic blocks (math-block) and source-mode blocks (code-block)
            // don't support inline marks — skip silently rather than enter
            // a stuck edit state.
            if (!block || block.type === "math-block" || block.type === "code-block") {
                return true;
            }
            if (isCollapsed(sel)) {
                const off = sel.focus.offset;
                const existing = block.marks.find(
                    (m) => m.type === "link" && m.start < off && off < m.end,
                );
                if (existing?.attrs?.linkId) {
                    actions.requestEditing(String(existing.attrs.linkId));
                    return true;
                }
            }
            const linkId = generateId();
            store.setState((s) => wrapSelectionInLink(s, "", linkId));
            actions.requestEditing(linkId);
            return true;
        },
    },

    // ---- Inline math ----
    // Cmd-Shift-M: insert an empty inline math atom at the caret and open
    // its popover in edit mode. Mirrors the link flow (Cmd-K): atom id is
    // generated up front so the same id can be handed to requestEditing.
    {
        match: (e) => mod(e) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m",
        run: ({ store, actions }) => {
            const state = store.getState();
            if (!state.selection) return true;
            const sel = state.selection;
            const block = state.doc.find((b) => b.id === sel.focus.blockId);
            // Same blocklist as insertInlineNode — bail before generating an
            // id so we don't leave a dangling requestEditing target.
            if (!block || block.type === "math-block" || block.type === "code-block" || block.type === "hr") {
                return true;
            }
            const atomId = generateId();
            store.setState((s) => insertInlineNode(s, "math", { latex: "" }, atomId));
            actions.requestEditing(atomId);
            return true;
        },
    },

    // ---- Block type ----
    ...([1, 2, 3, 4, 5, 6] as const).map<KeyBinding>((level) => ({
        match: (e) => mod(e) && e.altKey && e.key === String(level),
        run: ({ store }) => {
            store.setState((s) => setBlockType(s, "heading", { level }));
            return true;
        },
    })),
    {
        match: (e) => mod(e) && e.altKey && e.key === "0",
        run: ({ store }) => {
            store.setState((s) => setBlockType(s, "paragraph"));
            return true;
        },
    },
    {
        match: (e) => mod(e) && e.shiftKey && e.key === "8",
        run: ({ store }) => {
            store.setState((s) => setBlockType(s, "bullet-item"));
            return true;
        },
    },
    {
        match: (e) => mod(e) && e.shiftKey && e.key === "7",
        run: ({ store }) => {
            store.setState((s) => setBlockType(s, "ordered-item", { number: 1 }));
            return true;
        },
    },

    // ---- History ----
    {
        match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === "z",
        run: ({ store }) => {
            store.undo();
            return true;
        },
    },
    {
        match: (e) => mod(e) && (e.key === "Z" || (e.shiftKey && e.key.toLowerCase() === "z")),
        run: ({ store }) => {
            store.redo();
            return true;
        },
    },

    // ---- Word-level movement (Alt/Option on Mac, Ctrl elsewhere) ----
    {
        match: (e) => wordMod(e) && !lineMod(e) && e.key === "ArrowLeft",
        run: (ctx) => {
            moveByWord(ctx, "left", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => wordMod(e) && !lineMod(e) && e.key === "ArrowRight",
        run: (ctx) => {
            moveByWord(ctx, "right", ctx.event.shiftKey);
            return true;
        },
    },

    // ---- Line-level movement (Cmd on Mac) ----
    {
        match: (e) => lineMod(e) && e.key === "ArrowLeft",
        run: (ctx) => {
            moveToLineEdge(ctx, "start", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => lineMod(e) && e.key === "ArrowRight",
        run: (ctx) => {
            moveToLineEdge(ctx, "end", ctx.event.shiftKey);
            return true;
        },
    },

    // ---- Plain navigation ----
    {
        match: (e) => e.key === "ArrowLeft",
        run: (ctx) => {
            moveByChar(ctx, "left", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => e.key === "ArrowRight",
        run: (ctx) => {
            moveByChar(ctx, "right", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => e.key === "ArrowUp",
        run: (ctx) => {
            moveVertical(ctx, "up", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => e.key === "ArrowDown",
        run: (ctx) => {
            moveVertical(ctx, "down", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => e.key === "Home",
        run: (ctx) => {
            moveToLineEdge(ctx, "start", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => e.key === "End",
        run: (ctx) => {
            moveToLineEdge(ctx, "end", ctx.event.shiftKey);
            return true;
        },
    },
    {
        match: (e) => mod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a",
        run: ({ store }) => {
            const state = store.getState();
            if (state.doc.length === 0) return true;
            const first = state.doc[0]!;
            const last = state.doc[state.doc.length - 1]!;
            setSelection(store, {
                anchor: { blockId: first.id, offset: 0 },
                focus: { blockId: last.id, offset: last.content.length },
            });
            return true;
        },
    },
];
