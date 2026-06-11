/**
 * Shared private helpers used across the commands modules. Not re-exported
 * from the barrel — kept internal to `commands/`.
 */

import { findBlockIndex } from "../transform";
import type { Block, DocState, Position, Selection } from "../types";
import { isCollapsed } from "../types";

export const LIST_TYPES = new Set(["bullet-item", "ordered-item", "task-item"]);

/**
 * Blocks whose visible content lives in `metadata`, not `content` (`content`
 * is always ""). Text merged into one of these vanishes on serialize, so the
 * delete commands treat them as indivisible units instead of merge partners.
 */
export const ATOMIC_BLOCK_TYPES = new Set(["hr", "math-block"]);

/** Blockquote depth (>= 1). Depth 1 is the unnested base level. */
export function getDepth(metadata: Record<string, unknown> | undefined): number {
    return (metadata?.depth as number | undefined) ?? 1;
}

/**
 * Set the depth field on metadata. Depth 1 (base level) is the implicit default
 * and is stored as the absence of the `depth` key, mirroring how lists treat
 * `indent: 0`. Returns `undefined` if metadata would otherwise be empty.
 */
export function setDepth(
    metadata: Record<string, unknown> | undefined,
    depth: number,
): Record<string, unknown> | undefined {
    const rest = { ...(metadata ?? {}) };
    delete rest.depth;
    if (depth > 1) rest.depth = depth;
    return Object.keys(rest).length > 0 ? rest : undefined;
}

export function normalizeSelection(
    sel: Selection,
    doc: Block[],
): { from: Position; to: Position; isBackward: boolean } {
    const aIdx = findBlockIndex(doc, sel.anchor.blockId);
    const fIdx = findBlockIndex(doc, sel.focus.blockId);
    if (aIdx < fIdx || (aIdx === fIdx && sel.anchor.offset <= sel.focus.offset)) {
        return { from: sel.anchor, to: sel.focus, isBackward: false };
    }
    return { from: sel.focus, to: sel.anchor, isBackward: true };
}

export function collapsedAt(pos: Position): Selection {
    return { anchor: pos, focus: pos };
}

/**
 * In a code-block, a caret that lands right after a "\n" should render at the
 * start of the new visual line, not the end of the previous one. The default
 * (upstream) affinity uses the right edge of `content[offset-1]` — but that's
 * the newline character, whose rect browsers place at the end of the prior
 * line. Tag the resulting position downstream so `clientRectForPosition`
 * uses the left edge of `content[offset]` instead (or, at end of content, the
 * empty trailing line). Mirrors the same trick `insertBreak` applies after
 * typing "\n" in a code-block.
 */
export function withCodeBlockLineAffinity(state: DocState): DocState {
    if (!state.selection || !isCollapsed(state.selection)) return state;
    const focus = state.selection.focus;
    const block = state.doc.find((b) => b.id === focus.blockId);
    if (!block || block.type !== "code-block") return state;
    if (focus.offset === 0 || block.content[focus.offset - 1] !== "\n") return state;
    if (focus.affinity === "downstream") return state;
    const next: Position = { ...focus, affinity: "downstream" };
    return { ...state, selection: { anchor: next, focus: next } };
}
