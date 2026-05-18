/**
 * Link mark commands: wrap a selection in a link, update a link's href by id.
 */

import { adjustInlineNodesForInsert } from "../inlineNodes";
import { adjustMarksForInsert } from "../marks";
import { findBlockIndex } from "../transform";
import type { Block, DocState, Mark } from "../types";
import { isCollapsed } from "../types";
import { normalizeSelection } from "./helpers";

/**
 * Apply a link mark to the current selection. For a non-empty selection, the
 * mark spans the selected text. For a collapsed selection, a placeholder
 * "link" string is inserted at the cursor and the selection is extended to
 * cover it so the user can immediately overwrite the placeholder by typing.
 *
 * Cross-block selections are clipped to the focus block. Atomic blocks
 * (math-block) are no-ops.
 *
 * `linkId` is taken as a parameter so the caller (typically the Cmd-K
 * keybinding) can use the same id to open the popover in edit mode.
 */
export function wrapSelectionInLink(state: DocState, href: string, linkId: string): DocState {
    if (!state.selection) return state;
    const sel = state.selection;
    const focusIdx = findBlockIndex(state.doc, sel.focus.blockId);
    if (focusIdx < 0) return state;
    const block = state.doc[focusIdx]!;
    if (block.type === "math-block" || block.type === "code-block") return state;

    if (isCollapsed(sel)) {
        const PLACEHOLDER = "link";
        const at = sel.focus.offset;
        const newContent =
            block.content.slice(0, at) + PLACEHOLDER + block.content.slice(at);
        const adjustedMarks = adjustMarksForInsert(block.marks, at, PLACEHOLDER.length);
        const adjustedNodes = adjustInlineNodesForInsert(block.inlineNodes, at, PLACEHOLDER.length);
        const linkMark: Mark = {
            type: "link",
            start: at,
            end: at + PLACEHOLDER.length,
            attrs: { href, linkId },
        };
        const newMarks = [...adjustedMarks, linkMark].sort((a, b) => a.start - b.start);
        const newBlock: Block = {
            ...block,
            content: newContent,
            marks: newMarks,
            inlineNodes: adjustedNodes,
        };
        const doc = state.doc.slice();
        doc[focusIdx] = newBlock;
        return {
            ...state,
            doc,
            selection: {
                anchor: { blockId: newBlock.id, offset: at },
                focus: { blockId: newBlock.id, offset: at + PLACEHOLDER.length },
            },
            storedMarks: null,
        };
    }

    // Non-empty selection: apply the link mark to the focus block's slice of
    // the selection. Multi-block link spans aren't a thing in markdown.
    const { from, to } = normalizeSelection(sel, state.doc);
    let start: number;
    let end: number;
    if (from.blockId === to.blockId) {
        start = from.offset;
        end = to.offset;
    } else if (from.blockId === block.id) {
        start = from.offset;
        end = block.content.length;
    } else if (to.blockId === block.id) {
        start = 0;
        end = to.offset;
    } else {
        return state;
    }
    if (start >= end) return state;

    const linkMark: Mark = {
        type: "link",
        start,
        end,
        attrs: { href, linkId },
    };
    const newMarks = [...block.marks, linkMark].sort((a, b) => a.start - b.start);
    const newBlock: Block = { ...block, marks: newMarks };
    const doc = state.doc.slice();
    doc[focusIdx] = newBlock;
    return {
        ...state,
        doc,
        selection: {
            anchor: { blockId: newBlock.id, offset: start },
            focus: { blockId: newBlock.id, offset: end },
        },
        storedMarks: null,
    };
}

/**
 * Find the unique link mark whose `attrs.linkId` matches and update its
 * `attrs.href`. No-op if no such mark exists.
 */
export function updateLinkHref(state: DocState, linkId: string, href: string): DocState {
    let changed = false;
    const doc = state.doc.map((block) => {
        let blockChanged = false;
        const marks = block.marks.map((m) => {
            if (m.type !== "link") return m;
            if (m.attrs?.linkId !== linkId) return m;
            blockChanged = true;
            return { ...m, attrs: { ...m.attrs, href } };
        });
        if (!blockChanged) return block;
        changed = true;
        return { ...block, marks };
    });
    if (!changed) return state;
    return { ...state, doc };
}
