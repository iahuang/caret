/**
 * Active / stored marks + mark toggling at the document level.
 */

import { hasMarkInRange, toggleMark as toggleMarkInList } from "../marks";
import { findBlockIndex } from "../transform";
import type { Doc, DocState, Mark, MarkType, Position } from "../types";
import { isCollapsed } from "../types";
import { normalizeSelection } from "./helpers";

/**
 * The marks the cursor "inherits" at a collapsed position.
 *
 * Left-side bias: a cursor at offset N inherits the marks of the character
 * at N-1. At offset 0 we fall back to the right-side character. Matches the
 * convention in Word / Google Docs / ProseMirror.
 */
export function marksAtPosition(doc: Doc, position: Position): MarkType[] {
    const idx = findBlockIndex(doc, position.blockId);
    if (idx < 0) return [];
    const block = doc[idx]!;
    if (block.content.length === 0) return [];
    const probe = position.offset === 0 ? 0 : position.offset - 1;
    const types = new Set<MarkType>();
    for (const m of block.marks) {
        if (m.start <= probe && m.end > probe) types.add(m.type);
    }
    return Array.from(types);
}

/** The marks that will be applied to the next typed character. */
export function activeMarks(state: DocState): MarkType[] {
    if (!state.selection || !isCollapsed(state.selection)) return [];
    if (state.storedMarks) return state.storedMarks;
    return marksAtPosition(state.doc, state.selection.anchor);
}

/** Add a mark to a range. Idempotent; merges with adjacent same-type marks. */
function applyMarkToList(marks: Mark[], type: MarkType, from: number, to: number): Mark[] {
    if (from === to || hasMarkInRange(marks, type, from, to)) return marks;
    let newStart = from;
    let newEnd = to;
    // Absorbed neighbors may carry attrs (e.g. a link's href). The merged
    // mark must keep them — emitting a bare {type, start, end} would silently
    // destroy the data.
    let attrs: Record<string, unknown> | undefined;
    const out: Mark[] = [];
    for (const m of marks) {
        if (m.type !== type || m.end < from || m.start > to) {
            out.push(m);
            continue;
        }
        newStart = Math.min(newStart, m.start);
        newEnd = Math.max(newEnd, m.end);
        if (attrs === undefined && m.attrs !== undefined) attrs = m.attrs;
    }
    const added: Mark = { type, start: newStart, end: newEnd };
    if (attrs !== undefined) added.attrs = attrs;
    out.push(added);
    return out.sort((a, b) => a.start - b.start);
}

/**
 * Reconcile the marks covering `[from, to)` to be exactly `activeTypes`.
 * Other marks (outside this range, or partially overlapping) are unaffected
 * beyond the natural split that removal causes.
 *
 * Used by `insertText` to apply stored / active marks to freshly inserted
 * content. Internal — not re-exported from the barrel.
 */
export function ensureMarksOnRange(
    marks: Mark[],
    activeTypes: MarkType[],
    from: number,
    to: number,
): Mark[] {
    if (from === to) return marks;
    const candidateTypes = new Set<MarkType>(activeTypes);
    for (const m of marks) candidateTypes.add(m.type);

    let result = marks;
    const want = new Set(activeTypes);
    for (const t of candidateTypes) {
        // Links are never reconciled here. A bare MarkType list can't carry
        // their attrs (href, linkId), so "covering" the range would absorb a
        // neighboring link into a synthesized mark with no URL — typing at a
        // link's edge would destroy it. Typing strictly inside a link is
        // already handled by the natural extension in adjustMarksForInsert
        // (covered === shouldCover, no action); typing at an edge stays
        // outside the link, matching editors where links don't grow on
        // boundary typing.
        if (t === "link") continue;
        const covered = hasMarkInRange(result, t, from, to);
        const shouldCover = want.has(t);
        if (covered && !shouldCover) {
            result = toggleMarkInList(result, t, from, to);
        } else if (!covered && shouldCover) {
            result = applyMarkToList(result, t, from, to);
        }
    }
    return result;
}

export function toggleMark(state: DocState, markType: MarkType): DocState {
    if (!state.selection) return state;

    // Collapsed: toggle the mark in storedMarks, don't touch the doc.
    if (isCollapsed(state.selection)) {
        const current = state.storedMarks ?? marksAtPosition(state.doc, state.selection.anchor);
        const has = current.includes(markType);
        const next = has ? current.filter((t) => t !== markType) : [...current, markType];
        return { ...state, storedMarks: next };
    }

    // Range: toggle the mark in the doc.
    const { from, to } = normalizeSelection(state.selection, state.doc);
    const fromIdx = findBlockIndex(state.doc, from.blockId);
    const toIdx = findBlockIndex(state.doc, to.blockId);
    if (fromIdx < 0 || toIdx < 0) return state;
    const doc = state.doc.map((b, i) => {
        if (i < fromIdx || i > toIdx) return b;
        const start = i === fromIdx ? from.offset : 0;
        const end = i === toIdx ? to.offset : b.content.length;
        if (start === end) return b;
        return { ...b, marks: toggleMarkInList(b.marks, markType, start, end) };
    });
    return { ...state, doc, storedMarks: null };
}

export function isMarkActive(state: DocState, markType: MarkType): boolean {
    if (!state.selection) return false;
    if (isCollapsed(state.selection)) {
        return activeMarks(state).includes(markType);
    }
    const { from, to } = normalizeSelection(state.selection, state.doc);
    if (from.blockId !== to.blockId) return false;
    const idx = findBlockIndex(state.doc, from.blockId);
    if (idx < 0) return false;
    const block = state.doc[idx]!;
    return hasMarkInRange(block.marks, markType, from.offset, to.offset);
}
