/**
 * The DOM bridge.
 *
 * Translates between *model positions* (`{blockId, offset}`) and *DOM positions*
 * (text-node + offset, or element + child-index). Hit-testing uses
 * `caretPositionFromPoint`; pixel geometry uses `Range.getBoundingClientRect`
 * and `Range.getClientRects`.
 *
 * Two contracts with block renderers:
 *   - The root block element has `data-block-id="<id>"`.
 *   - The element containing the editable text content has `data-block-content`.
 *
 * Plus the inline-atom contract (`renderInline.tsx`):
 *   - Atoms are wrapped in `<span data-atom-id data-atom-len="N">`. The walker
 *     treats such elements as exactly N model characters, regardless of their
 *     inner text. Clicks landing inside an atom are resolved to "just before"
 *     or "just after" based on which half of the atom rect the cursor hit.
 */

import { useCallback, useMemo } from "react";
import type { RefObject } from "react";
import type { Doc, Position } from "../core/types";

export interface DomMapping {
    positionFromPoint(x: number, y: number): Position | null;
    rangeForPosition(pos: Position): Range | null;
    rangeForSpan(blockId: string, from: number, to: number): Range | null;
    /**
     * Client rect for a caret position. Like `rangeForPosition(...).
     * getBoundingClientRect()`, but with a fallback for the "collapsed range
     * at an element child-index" case (e.g. directly after an inline atom
     * with no following text node), which natively returns an empty 0×0 rect.
     * Falls back to the right edge of the previous sibling element.
     */
    clientRectForPosition(pos: Position): DOMRect | null;
    /**
     * True when this offset sits at a visual-line wrap — i.e. the position
     * has two distinct visual locations (end of one line, start of the next).
     * Used by character/word movement so the destination can be tagged with
     * downstream affinity, letting users arrow-key into the start of a
     * wrapped continuation line.
     */
    isWrapBoundary(blockId: string, offset: number): boolean;
    positionFromDom(node: Node, offset: number): Position | null;
    findBlockElement(blockId: string): HTMLElement | null;
}

function isNoContent(node: Node): boolean {
    return node instanceof HTMLElement && node.dataset.noContent === "true";
}

// WebKit (Safari, the Tauri webview on macOS) does not implement
// `caretPositionFromPoint` — it ships the older `caretRangeFromPoint` which
// returns a Range instead. Normalize to the CaretPosition shape we use below.
type CaretPositionLike = { offsetNode: Node; offset: number };

function caretPositionFromPointCompat(x: number, y: number): CaretPositionLike | null {
    const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (typeof doc.caretPositionFromPoint === "function") {
        const cp = doc.caretPositionFromPoint(x, y);
        return cp && cp.offsetNode ? { offsetNode: cp.offsetNode, offset: cp.offset } : null;
    }
    if (typeof doc.caretRangeFromPoint === "function") {
        const r = doc.caretRangeFromPoint(x, y);
        return r && r.startContainer ? { offsetNode: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
}

function atomLen(node: Node): number | null {
    if (!(node instanceof HTMLElement)) return null;
    const v = node.dataset.atomLen;
    if (v === undefined) return null;
    const n = parseInt(v, 10);
    return isFinite(n) ? n : null;
}

function getContentEl(blockEl: HTMLElement): HTMLElement {
    return (blockEl.querySelector("[data-block-content]") as HTMLElement | null) ?? blockEl;
}

function textLengthOf(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue?.length ?? 0;
    if (isNoContent(node)) return 0;
    const atom = atomLen(node);
    if (atom !== null) return atom;
    let total = 0;
    for (let i = 0; i < node.childNodes.length; i++) {
        total += textLengthOf(node.childNodes[i]!);
    }
    return total;
}

// =============================================================================
// Shared content-tree walker
// =============================================================================
//
// Every model<->DOM lookup below has the same tree-walk shape: visit text and
// atom leaves in document order (contributing N model characters each), skip
// `data-no-content` subtrees, recurse through everything else. The differences
// are what each walker does at each leaf and when it stops. `walkContent`
// captures the shape; the per-walker logic lives in a `ContentVisitor`.

type Step<T> = { done: true; result: T } | { done: false };
const NEXT: Step<never> = { done: false };
function step<T>(result: T): Step<T> {
    return { done: true, result };
}

interface ContentVisitor<T> {
    /** Called for every node before any leaf classification. Use for identity short-circuit. */
    onEnter?: (node: Node) => Step<T>;
    onText: (text: Text, len: number) => Step<T>;
    onAtom: (atom: HTMLElement, len: number) => Step<T>;
}

function walkContent<T>(contentEl: HTMLElement, visitor: ContentVisitor<T>): T | null {
    function visit(node: Node): Step<T> {
        if (visitor.onEnter) {
            const r = visitor.onEnter(node);
            if (r.done) return r;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            return visitor.onText(node as Text, (node as Text).nodeValue?.length ?? 0);
        }
        if (isNoContent(node)) return NEXT;
        const al = atomLen(node);
        if (al !== null) {
            return visitor.onAtom(node as HTMLElement, al);
        }
        for (let i = 0; i < node.childNodes.length; i++) {
            const r = visit(node.childNodes[i]!);
            if (r.done) return r;
        }
        return NEXT;
    }
    const r = visit(contentEl);
    return r.done ? r.result : null;
}

function computeOffsetInBlock(blockEl: HTMLElement, target: Node, targetOffset: number): number {
    let offset = 0;
    const result = walkContent<number>(getContentEl(blockEl), {
        onEnter: (node) => {
            if (node !== target) return NEXT;
            if (node.nodeType === Node.TEXT_NODE) {
                offset += targetOffset;
            } else {
                // Element target: `targetOffset` is a child index.
                for (let i = 0; i < targetOffset && i < node.childNodes.length; i++) {
                    offset += textLengthOf(node.childNodes[i]!);
                }
            }
            return step(offset);
        },
        onText: (_text, len) => {
            offset += len;
            return NEXT;
        },
        onAtom: (atom, len) => {
            // Target landed inside an atom: treat as "before the atom".
            // `positionFromPoint` refines left/right by click x.
            if (atom.contains(target)) return step(offset);
            offset += len;
            return NEXT;
        },
    });
    return result ?? 0;
}

function domPositionInBlock(blockEl: HTMLElement, modelOffset: number): { node: Node; offset: number } {
    const contentEl = getContentEl(blockEl);
    let remaining = modelOffset;
    // Fallback for when the walk finishes without a direct match (e.g. the
    // model offset lands exactly at the end of the content's last node).
    // Updated whenever the walker passes a text node or an atom.
    let lastEndPoint: { node: Node; offset: number } | null = null;

    const result = walkContent<{ node: Node; offset: number }>(contentEl, {
        onText: (text, len) => {
            if (remaining <= len) return step({ node: text, offset: remaining });
            remaining -= len;
            lastEndPoint = { node: text, offset: len };
            return NEXT;
        },
        onAtom: (atom, len) => {
            const parent = atom.parentNode;
            const idx = parent ? Array.prototype.indexOf.call(parent.childNodes, atom) : -1;
            if (remaining === 0) {
                // Right before the atom — point at parent + child-index.
                if (parent && idx >= 0) return step({ node: parent, offset: idx });
                return NEXT;
            }
            if (remaining < len) {
                // Inside a multi-char atom — place before it. 1-char atoms never hit this branch.
                if (parent && idx >= 0) return step({ node: parent, offset: idx });
                return NEXT;
            }
            // Walking past the atom — record the position right after it as the fallback.
            remaining -= len;
            if (parent && idx >= 0) lastEndPoint = { node: parent, offset: idx + 1 };
            return NEXT;
        },
    });

    if (result) return result;
    if (lastEndPoint) return lastEndPoint;
    return { node: contentEl, offset: 0 };
}

/**
 * Bounding rect of `content[m]` — the model character at offset m.
 *
 * Crucially, the probe range stays *inside the single text node* (or atom
 * element) that owns the character, so `getBoundingClientRect` is unambiguous.
 * A naive cross-element range like `range(worldText:12, fooText:1)` — which is
 * what you get when a wrap boundary coincides with a mark boundary — produces
 * inconsistent results across browsers (empty start rect, union covering both
 * lines, etc.). Single-node ranges sidestep all of that.
 *
 * Returns `null` when m is past the end of the content or its glyph has no
 * geometry (e.g. a collapsed trailing whitespace).
 */
function charRectAt(blockEl: HTMLElement, m: number): DOMRect | null {
    let pos = 0;
    return walkContent<DOMRect | null>(getContentEl(blockEl), {
        onText: (text, len) => {
            if (m < pos || m >= pos + len) {
                pos += len;
                return NEXT;
            }
            const local = m - pos;
            const range = document.createRange();
            try {
                range.setStart(text, local);
                range.setEnd(text, local + 1);
            } catch {
                pos += len;
                return NEXT;
            }
            // Walk the rect list in reverse. When the probe range starts at a
            // visual line break (e.g. inside a <pre>, right after a "\n"),
            // browsers emit a phantom zero/height rect at the end of the prior
            // line first; the actual glyph rect is last. Picking the first
            // non-empty rect mis-locates the caret at end-of-content in a
            // code-block.
            const rects = range.getClientRects();
            for (let i = rects.length - 1; i >= 0; i--) {
                const r = rects[i]!;
                if (r.width > 0 || r.height > 0) return step(r);
            }
            return step(null);
        },
        onAtom: (atom, len) => {
            if (m >= pos && m < pos + len) return step(atom.getBoundingClientRect());
            pos += len;
            return NEXT;
        },
    });
}

function offsetOfAtomElement(blockEl: HTMLElement, atomEl: HTMLElement): number | null {
    let offset = 0;
    return walkContent<number>(getContentEl(blockEl), {
        onEnter: (node) => (node === atomEl ? step(offset) : NEXT),
        onText: (_text, len) => {
            offset += len;
            return NEXT;
        },
        onAtom: (_atom, len) => {
            offset += len;
            return NEXT;
        },
    });
}

export interface UseDomMappingOptions {
    containerRef: RefObject<HTMLElement | null>;
    doc: Doc;
}

export function useDomMapping({ containerRef, doc }: UseDomMappingOptions): DomMapping {
    void doc;

    const findBlockElement = useCallback(
        (blockId: string): HTMLElement | null => {
            const root = containerRef.current;
            if (!root) return null;
            return root.querySelector(`[data-block-id="${blockId}"]`);
        },
        [containerRef],
    );

    const findBlockIdFor = useCallback(
        (node: Node): string | null => {
            const root = containerRef.current;
            let n: Node | null = node;
            while (n && n !== root) {
                if (n instanceof HTMLElement && n.dataset.blockId) return n.dataset.blockId;
                n = n.parentNode;
            }
            return null;
        },
        [containerRef],
    );

    const positionFromDom = useCallback(
        (node: Node, domOffset: number): Position | null => {
            const blockId = findBlockIdFor(node);
            if (!blockId) return null;
            const blockEl = findBlockElement(blockId);
            if (!blockEl) return null;
            const offset = computeOffsetInBlock(blockEl, node, domOffset);
            return { blockId, offset };
        },
        [findBlockElement, findBlockIdFor],
    );

    const positionFromPoint = useCallback(
        (x: number, y: number): Position | null => {
            const cp = caretPositionFromPointCompat(x, y);
            if (!cp || !cp.offsetNode) return null;

            // Click landed inside an atom — refine left/right by x position.
            let n: Node | null = cp.offsetNode;
            const root = containerRef.current;
            while (n && n !== root) {
                if (n instanceof HTMLElement && n.dataset.atomLen !== undefined) {
                    const blockEl = n.closest("[data-block-id]") as HTMLElement | null;
                    if (!blockEl) break;
                    const rect = n.getBoundingClientRect();
                    const isLeft = x < rect.left + rect.width / 2;
                    const before = offsetOfAtomElement(blockEl, n);
                    if (before === null) break;
                    const al = parseInt(n.dataset.atomLen, 10) || 1;
                    return {
                        blockId: blockEl.dataset.blockId!,
                        offset: isLeft ? before : before + al,
                    };
                }
                n = n.parentNode;
            }

            const pos = positionFromDom(cp.offsetNode, cp.offset);
            if (!pos) return null;

            // At a wrap boundary the same model offset has two visual positions
            // — end of one line vs. start of the next. Probe the rects of
            // content[offset-1] and content[offset]; if they're on different
            // lines, prefer the one whose vertical midpoint is closest to y.
            const blockEl = findBlockElement(pos.blockId);
            if (!blockEl) return pos;
            const contentLen = textLengthOf(getContentEl(blockEl));
            if (pos.offset <= 0 || pos.offset >= contentLen) return pos;

            const upRect = charRectAt(blockEl, pos.offset - 1);
            const downRect = charRectAt(blockEl, pos.offset);
            if (!upRect || !downRect) return pos;
            if (Math.abs(upRect.top - downRect.top) < 1) return pos;

            const distUp = Math.abs(y - (upRect.top + upRect.height / 2));
            const distDown = Math.abs(y - (downRect.top + downRect.height / 2));
            if (distDown < distUp) return { ...pos, affinity: "downstream" };
            return pos;
        },
        [containerRef, findBlockElement, positionFromDom],
    );

    const rangeForPosition = useCallback(
        (pos: Position): Range | null => {
            const blockEl = findBlockElement(pos.blockId);
            if (!blockEl) return null;
            const { node, offset } = domPositionInBlock(blockEl, pos.offset);
            const range = document.createRange();
            try {
                range.setStart(node, offset);
                range.collapse(true);
            } catch {
                return null;
            }
            return range;
        },
        [findBlockElement],
    );

    const clientRectForPosition = useCallback(
        (pos: Position): DOMRect | null => {
            const blockEl = findBlockElement(pos.blockId);
            if (!blockEl) return null;
            const contentEl = getContentEl(blockEl);
            const contentLen = textLengthOf(contentEl);

            // Caret rect = an edge of an adjacent character's rect. Upstream
            // (default) uses the right edge of content[offset-1]; downstream
            // (e.g. caret at the start of a wrapped continuation line) uses
            // the left edge of content[offset]. Each probe is a single-node
            // range, so it's reliable across browsers even when the wrap
            // boundary coincides with a mark boundary.
            function edgeOf(m: number, edge: "left" | "right"): DOMRect | null {
                if (m < 0 || m >= contentLen) return null;
                const r = charRectAt(blockEl!, m);
                if (!r) return null;
                return new DOMRect(
                    edge === "left" ? r.left : r.right,
                    r.top,
                    0,
                    r.height,
                );
            }

            const affinity = pos.affinity ?? "upstream";
            const tryFns: Array<() => DOMRect | null> =
                affinity === "downstream"
                    ? [() => edgeOf(pos.offset, "left"), () => edgeOf(pos.offset - 1, "right")]
                    : [() => edgeOf(pos.offset - 1, "right"), () => edgeOf(pos.offset, "left")];
            for (const fn of tryFns) {
                const r = fn();
                if (r) return r;
            }

            // Empty / unmeasurable — collapsed range, then the "right edge of
            // previous sibling element" trick for "just after an inline atom".
            const { node, offset } = domPositionInBlock(blockEl, pos.offset);
            const range = document.createRange();
            try {
                range.setStart(node, offset);
                range.collapse(true);
            } catch {
                return null;
            }
            const r = range.getBoundingClientRect();
            if (r.width !== 0 || r.height !== 0) return r;
            if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
                const prev = node.childNodes[offset - 1];
                if (prev instanceof HTMLElement) {
                    const pr = prev.getBoundingClientRect();
                    return new DOMRect(pr.right, pr.top, 0, pr.height);
                }
            }
            return r;
        },
        [findBlockElement],
    );

    const isWrapBoundary = useCallback(
        (blockId: string, offset: number): boolean => {
            const blockEl = findBlockElement(blockId);
            if (!blockEl) return false;
            const contentLen = textLengthOf(getContentEl(blockEl));
            if (offset <= 0 || offset >= contentLen) return false;
            const upRect = charRectAt(blockEl, offset - 1);
            const downRect = charRectAt(blockEl, offset);
            if (!upRect || !downRect) return false;
            return Math.abs(upRect.top - downRect.top) >= 1;
        },
        [findBlockElement],
    );

    const rangeForSpan = useCallback(
        (blockId: string, from: number, to: number): Range | null => {
            const blockEl = findBlockElement(blockId);
            if (!blockEl) return null;
            const start = domPositionInBlock(blockEl, from);
            const end = domPositionInBlock(blockEl, to);
            const range = document.createRange();
            try {
                range.setStart(start.node, start.offset);
                range.setEnd(end.node, end.offset);
            } catch {
                return null;
            }
            return range;
        },
        [findBlockElement],
    );

    return useMemo(
        () => ({
            positionFromPoint,
            positionFromDom,
            rangeForPosition,
            rangeForSpan,
            clientRectForPosition,
            isWrapBoundary,
            findBlockElement,
        }),
        [
            positionFromPoint,
            positionFromDom,
            rangeForPosition,
            rangeForSpan,
            clientRectForPosition,
            isWrapBoundary,
            findBlockElement,
        ],
    );
}
