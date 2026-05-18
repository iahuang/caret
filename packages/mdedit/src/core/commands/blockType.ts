/**
 * Block-type and metadata commands: setBlockType / indentBlock /
 * updateBlockMetadata / updateInlineNode. These are "shape" edits — they
 * change a block's type or metadata, or patch an inline node by id — without
 * touching textual content directly.
 */

import { findBlockIndex } from "../transform";
import type { DocState } from "../types";
import { LIST_TYPES, getDepth, setDepth, normalizeSelection } from "./helpers";

export function setBlockType(
    state: DocState,
    type: string,
    metadata?: Record<string, unknown>,
): DocState {
    if (!state.selection) return state;
    const { from, to } = normalizeSelection(state.selection, state.doc);
    const fromIdx = findBlockIndex(state.doc, from.blockId);
    const toIdx = findBlockIndex(state.doc, to.blockId);
    if (fromIdx < 0 || toIdx < 0) return state;
    const doc = state.doc.map((b, i) => {
        if (i < fromIdx || i > toIdx) return b;
        // Table cells refuse type changes — a cell that became a heading would
        // break the surrounding table. Use `deleteTable` to remove the table.
        if (b.type === "table-cell") return b;
        return { ...b, type, metadata };
    });
    return { ...state, doc, storedMarks: null };
}

export function indentBlock(state: DocState, delta: number): DocState {
    if (!state.selection) return state;
    const pos = state.selection.focus;
    const idx = findBlockIndex(state.doc, pos.blockId);
    if (idx < 0) return state;
    const block = state.doc[idx]!;
    // Blockquotes use `metadata.depth` (min 1, where 1 is the unnested base)
    // instead of `indent` (min 0). Shift-Tab below depth 1 is a no-op; exiting
    // the quote happens via Backspace at offset 0 (same as lists hit depth 0).
    if (block.type === "blockquote") {
        const cur = getDepth(block.metadata);
        const next = Math.max(1, cur + delta);
        if (next === cur) return state;
        const newBlock = { ...block, metadata: setDepth(block.metadata, next) };
        const doc = state.doc.slice();
        doc[idx] = newBlock;
        return { ...state, doc, storedMarks: null };
    }
    if (!LIST_TYPES.has(block.type)) return state;
    const cur = (block.metadata?.indent as number | undefined) ?? 0;
    const next = Math.max(0, cur + delta);
    if (next === cur) return state;
    const metadata = { ...(block.metadata ?? {}), indent: next };
    const newBlock = { ...block, metadata };
    const doc = state.doc.slice();
    doc[idx] = newBlock;
    return { ...state, doc, storedMarks: null };
}

/** Patch a block's `metadata` by id (e.g. update math-block LaTeX source). */
export function updateBlockMetadata(
    state: DocState,
    blockId: string,
    patch: Record<string, unknown>,
): DocState {
    let touched = false;
    const doc = state.doc.map((b) => {
        if (b.id !== blockId) return b;
        touched = true;
        return { ...b, metadata: { ...(b.metadata ?? {}), ...patch } };
    });
    if (!touched) return state;
    return { ...state, doc };
}

/** Patch the `data` of an existing inline atom by id. */
export function updateInlineNode(
    state: DocState,
    nodeId: string,
    data: Partial<Record<string, unknown>>,
): DocState {
    let touched = false;
    const doc = state.doc.map((b) => {
        if (!b.inlineNodes || !b.inlineNodes.some((n) => n.id === nodeId)) return b;
        touched = true;
        return {
            ...b,
            inlineNodes: b.inlineNodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
            ),
        };
    });
    if (!touched) return state;
    return { ...state, doc };
}
