/**
 * Text-level editing commands: insertion, deletion, splitting, paste, slicing.
 * Also covers `insertInlineNode` since it's a text-level insert at the caret.
 */

import {
    adjustInlineNodesForInsert,
    shiftInlineNodes,
} from "../inlineNodes";
import { adjustMarksForInsert, shiftMarks } from "../marks";
import { getTableCellMeta } from "../schema";
import {
    deleteRangeInBlock,
    findBlockIndex,
    generateId,
    insertTextInBlock,
    mergeBlocks,
    replaceRange,
    splitBlock,
} from "../transform";
import type { Block, DocState, InlineNode } from "../types";
import { INLINE_NODE_PLACEHOLDER, isCollapsed } from "../types";
import { applyMarkdownShortcuts } from "./blockShortcuts";
import {
    LIST_TYPES,
    collapsedAt,
    getDepth,
    normalizeSelection,
    withCodeBlockLineAffinity,
} from "./helpers";
import { applyInlineShortcuts } from "./inlineShortcuts";
import { ensureMarksOnRange, marksAtPosition } from "./marks";
import { indentBlock } from "./blockType";

/**
 * Extract the blocks covered by a selection into a stand-alone sub-doc.
 *
 * The result is a plain `Block[]` — same shape as `DocState.doc` — so it
 * can be fed directly to `serializeDoc` to produce markdown, or used in
 * future paste/duplicate flows.
 *
 * Slicing semantics: the first block keeps `[from.offset, end)`, middle
 * blocks are included verbatim, and the last block keeps `[0, to.offset)`.
 * A last block at `to.offset === 0` contributed no characters, so it's
 * dropped — otherwise atomic blocks like `math-block` (whose latex lives in
 * `metadata`) would leak when the caret merely sat at their leading edge.
 */
export function sliceDocBySelection(state: DocState): Block[] {
    if (!state.selection) return [];
    const { from, to } = normalizeSelection(state.selection, state.doc);
    const fromIdx = findBlockIndex(state.doc, from.blockId);
    const toIdx = findBlockIndex(state.doc, to.blockId);
    if (fromIdx < 0 || toIdx < 0) return [];

    if (fromIdx === toIdx) {
        if (from.offset === to.offset) return [];
        return [sliceBlockRange(state.doc[fromIdx]!, from.offset, to.offset)];
    }

    const firstBlock = state.doc[fromIdx]!;
    const lastBlock = state.doc[toIdx]!;
    const blocks: Block[] = [];
    blocks.push(sliceBlockRange(firstBlock, from.offset, firstBlock.content.length));
    for (let i = fromIdx + 1; i < toIdx; i++) blocks.push(state.doc[i]!);
    if (to.offset > 0) blocks.push(sliceBlockRange(lastBlock, 0, to.offset));
    return blocks;
}

function sliceBlockRange(block: Block, from: number, to: number): Block {
    // Trim from the right first so the left-trim offsets stay valid.
    const tail = deleteRangeInBlock(block, to, block.content.length);
    return deleteRangeInBlock(tail, 0, from);
}

export function deleteSelection(state: DocState): DocState {
    if (!state.selection || isCollapsed(state.selection)) return state;
    const { from, to } = normalizeSelection(state.selection, state.doc);
    const fromIdx = findBlockIndex(state.doc, from.blockId);
    const toIdx = findBlockIndex(state.doc, to.blockId);
    if (fromIdx < 0 || toIdx < 0) return state;

    if (fromIdx === toIdx) {
        const block = state.doc[fromIdx]!;
        const next = deleteRangeInBlock(block, from.offset, to.offset);
        const doc = state.doc.slice();
        doc[fromIdx] = next;
        return withCodeBlockLineAffinity({
            doc,
            selection: collapsedAt({ blockId: next.id, offset: from.offset }),
            storedMarks: null,
        });
    }

    const firstBlock = state.doc[fromIdx]!;
    const lastBlock = state.doc[toIdx]!;
    const keptFirst = deleteRangeInBlock(firstBlock, from.offset, firstBlock.content.length);
    const keptLast = deleteRangeInBlock(lastBlock, 0, to.offset);
    const merged = mergeBlocks(keptFirst, keptLast);
    const doc = replaceRange(state.doc, fromIdx, toIdx + 1, [merged]);
    return withCodeBlockLineAffinity({
        doc,
        selection: collapsedAt({ blockId: merged.id, offset: from.offset }),
        storedMarks: null,
    });
}

export function insertText(state: DocState, text: string): DocState {
    if (!state.selection || text.length === 0) return state;
    let next: DocState = state;
    if (!isCollapsed(next.selection)) {
        next = deleteSelection(next);
    }
    const sel = next.selection!;
    const idx = findBlockIndex(next.doc, sel.anchor.blockId);
    if (idx < 0) return next;
    const block = next.doc[idx]!;
    // Math blocks and HRs are atomic — math goes through the popover, HR
    // has no content at all. In both cases, direct text input is a no-op.
    if (block.type === "math-block" || block.type === "hr") return state;
    const insertAt = sel.anchor.offset;
    const insertEnd = insertAt + text.length;

    // Active marks: explicit override > position-derived default.
    // Note: derive *before* the insertion shifts marks, so position math
    // reads pre-insert state.
    const active = next.storedMarks ?? marksAtPosition(next.doc, sel.anchor);

    const inserted = insertTextInBlock(block, insertAt, text);
    const rectifiedMarks = ensureMarksOnRange(inserted.marks, active, insertAt, insertEnd);
    const newBlock: Block = { ...inserted, marks: rectifiedMarks };
    const doc = next.doc.slice();
    doc[idx] = newBlock;

    let out: DocState = {
        doc,
        selection: collapsedAt({ blockId: block.id, offset: insertEnd }),
        // Preserve across consecutive typing.
        storedMarks: next.storedMarks ?? null,
    };
    out = applyInlineShortcuts(out);
    // Run block shortcuts on every keystroke. The space-gated shortcuts
    // (heading, bullet, blockquote, etc.) already require a trailing space
    // in their patterns, so they won't false-fire on non-space input.
    // Run on every keystroke so HR — which has no content after `---` —
    // can trigger as soon as the third character is typed.
    out = applyMarkdownShortcuts(out);
    return out;
}

/**
 * Insert a sub-doc at the caret. Used by markdown paste — `parseMarkdown`
 * produces the `blocks` argument from clipboard text.
 *
 * Single-block insertion splices the pasted inline content (text + marks +
 * atoms) into the current block at the caret. Block type/metadata of the
 * single pasted block is discarded: the caller is pasting content into the
 * user's existing block, not replacing the block.
 *
 * Multi-block insertion splits the current block at the caret into
 * `[prefix, suffix]` and produces `[prefix+first, ...middle, last+suffix]`.
 * The endpoint blocks keep the *user's* block type/metadata (prefix's at
 * the head, suffix's at the tail) so pasting into a heading leaves the
 * heading's prefix as a heading, and the surrounding tail keeps the original
 * paragraph/list/etc. type. Exception: when both prefix and suffix are
 * empty — caret in an empty paragraph — the whole block is replaced with the
 * pasted blocks verbatim, so pasting a heading into an empty line makes it
 * a heading.
 *
 * Caret lands after the last character of `last` within the tail block,
 * which is the natural "end of pasted content" position.
 */
export function insertBlocks(state: DocState, blocks: Block[]): DocState {
    if (!state.selection || blocks.length === 0) return state;
    let next: DocState = state;
    if (!isCollapsed(next.selection)) next = deleteSelection(next);
    const sel = next.selection!;
    const idx = findBlockIndex(next.doc, sel.anchor.blockId);
    if (idx < 0) return next;
    const target = next.doc[idx]!;
    // Atomic blocks can't host pasted inline content. Caller can detect this
    // and route the paste elsewhere (e.g. to the math popover) if desired.
    if (target.type === "math-block") return state;

    if (blocks.length === 1) {
        const only = blocks[0]!;
        const at = sel.anchor.offset;
        // Inline-splice only's content. We don't go through `insertText` since
        // pasted text shouldn't trigger inline shortcuts or inherit stored marks.
        const inserted = insertTextInBlock(target, at, only.content);
        const addedNodes = shiftInlineNodes(only.inlineNodes, at) ?? [];
        const combined = [...(inserted.inlineNodes ?? []), ...addedNodes];
        const newBlock: Block = {
            ...inserted,
            marks: [...inserted.marks, ...shiftMarks(only.marks, at)],
            inlineNodes: combined.length > 0 ? combined : undefined,
        };
        const doc = next.doc.slice();
        doc[idx] = newBlock;
        return {
            doc,
            selection: collapsedAt({ blockId: newBlock.id, offset: at + only.content.length }),
            storedMarks: null,
        };
    }

    const [prefix, suffix] = splitBlock(target, sel.anchor.offset);
    const first = blocks[0]!;
    const last = blocks[blocks.length - 1]!;
    const middle = blocks.slice(1, -1);

    if (prefix.content.length === 0 && suffix.content.length === 0) {
        const doc = replaceRange(next.doc, idx, idx + 1, blocks);
        return {
            doc,
            selection: collapsedAt({ blockId: last.id, offset: last.content.length }),
            storedMarks: null,
        };
    }

    // If the pasted run starts or ends with a table-cell, merging endpoints
    // into the surrounding paragraph would corrupt the pasted table. Insert
    // the pasted blocks verbatim between the prefix and suffix halves of the
    // target (dropping empty halves to avoid stray empty paragraphs).
    if (first.type === "table-cell" || last.type === "table-cell") {
        const out: Block[] = [];
        if (prefix.content.length > 0) out.push(prefix);
        out.push(...blocks);
        if (suffix.content.length > 0) out.push(suffix);
        const doc = replaceRange(next.doc, idx, idx + 1, out);
        return {
            doc,
            selection: collapsedAt({ blockId: last.id, offset: last.content.length }),
            storedMarks: null,
        };
    }

    const head: Block = {
        ...prefix,
        content: prefix.content + first.content,
        marks: [...prefix.marks, ...shiftMarks(first.marks, prefix.content.length)],
        inlineNodes: combineInlineNodes(prefix.inlineNodes, first.inlineNodes, prefix.content.length),
    };
    // Suffix's block type/metadata wins, but the inline payload comes from `last`
    // at offset 0 with the suffix shifted to after it.
    const tail: Block = {
        ...suffix,
        content: last.content + suffix.content,
        marks: [...last.marks, ...shiftMarks(suffix.marks, last.content.length)],
        inlineNodes: combineInlineNodes(last.inlineNodes, suffix.inlineNodes, last.content.length),
    };

    const doc = replaceRange(next.doc, idx, idx + 1, [head, ...middle, tail]);
    return {
        doc,
        selection: collapsedAt({ blockId: tail.id, offset: last.content.length }),
        storedMarks: null,
    };
}

function combineInlineNodes(
    base: InlineNode[] | undefined,
    addition: InlineNode[] | undefined,
    additionOffset: number,
): InlineNode[] | undefined {
    const shifted = shiftInlineNodes(addition, additionOffset);
    const all = [...(base ?? []), ...(shifted ?? [])];
    return all.length > 0 ? all : undefined;
}

/**
 * Replace `[from, to)` within a single block with `text`. Unlike `insertText`,
 * this doesn't operate on the selection, doesn't trigger inline / markdown
 * shortcuts, and doesn't touch `storedMarks` — replacements are verbatim.
 *
 * If the selection has an endpoint in the affected block, it's cleared: block
 * offsets shifted under it, so the prior range is no longer meaningful and
 * could point past `content.length`. Selections in other blocks are left
 * alone — they're unaffected by this edit.
 *
 * Mark behavior follows from the underlying delete-then-insert: marks that
 * strictly contain the replaced range extend over the new text; marks
 * exactly aligned with or strictly inside the range are dropped. This matches
 * what users expect when "finding inside a bolded run" — the result stays
 * bold — versus "finding a bolded run exactly" — fresh text wins.
 */
export function replaceTextRange(
    state: DocState,
    blockId: string,
    from: number,
    to: number,
    text: string,
): DocState {
    const idx = findBlockIndex(state.doc, blockId);
    if (idx < 0) return state;
    const block = state.doc[idx]!;
    if (block.type === "math-block" || block.type === "hr") return state;
    const clampedFrom = Math.max(0, Math.min(from, block.content.length));
    const clampedTo = Math.max(clampedFrom, Math.min(to, block.content.length));
    let next: Block = clampedFrom === clampedTo
        ? block
        : deleteRangeInBlock(block, clampedFrom, clampedTo);
    if (text.length > 0) next = insertTextInBlock(next, clampedFrom, text);
    if (next === block) return state;
    const doc = state.doc.slice();
    doc[idx] = next;
    const sel = state.selection;
    const selectionInBlock =
        sel != null && (sel.anchor.blockId === blockId || sel.focus.blockId === blockId);
    return { ...state, doc, selection: selectionInBlock ? null : sel };
}

export function deleteBackward(state: DocState): DocState {
    if (!state.selection) return state;
    if (!isCollapsed(state.selection)) return deleteSelection(state);
    const pos = state.selection.anchor;
    const idx = findBlockIndex(state.doc, pos.blockId);
    if (idx < 0) return state;
    const block = state.doc[idx]!;

    if (pos.offset > 0) {
        const next = deleteRangeInBlock(block, pos.offset - 1, pos.offset);
        const doc = state.doc.slice();
        doc[idx] = next;
        return withCodeBlockLineAffinity({
            doc,
            selection: collapsedAt({ blockId: next.id, offset: pos.offset - 1 }),
            storedMarks: null,
        });
    }

    // Table cells must not merge with their neighbors. At offset 0 of any cell
    // beyond (0,0), step to the end of the previous cell. At (0,0) it's a
    // no-op — use `deleteTable` to remove the whole table.
    if (block.type === "table-cell") {
        const meta = getTableCellMeta(block);
        if (meta && (meta.row > 0 || meta.col > 0)) {
            const prev = state.doc[idx - 1];
            if (prev) {
                return {
                    ...state,
                    selection: collapsedAt({ blockId: prev.id, offset: prev.content.length }),
                    storedMarks: null,
                };
            }
        }
        return state;
    }

    if (LIST_TYPES.has(block.type)) {
        const curIndent = (block.metadata?.indent as number | undefined) ?? 0;
        if (curIndent > 0) {
            return { ...indentBlock(state, -1), storedMarks: null };
        }
    }
    // Blockquote outdent: depth > 1 decreases by one. At depth 1 we fall
    // through to the generic "convert to paragraph" branch below.
    if (block.type === "blockquote" && getDepth(block.metadata) > 1) {
        return { ...indentBlock(state, -1), storedMarks: null };
    }
    if (block.type !== "paragraph") {
        const next: Block = { ...block, type: "paragraph", metadata: undefined };
        const doc = state.doc.slice();
        doc[idx] = next;
        return { doc, selection: state.selection, storedMarks: null };
    }

    if (idx === 0) return state;
    const prev = state.doc[idx - 1]!;
    const prevLen = prev.content.length;
    const merged = mergeBlocks(prev, block);
    const doc = replaceRange(state.doc, idx - 1, idx + 1, [merged]);
    return {
        doc,
        selection: collapsedAt({ blockId: merged.id, offset: prevLen }),
        storedMarks: null,
    };
}

export function deleteForward(state: DocState): DocState {
    if (!state.selection) return state;
    if (!isCollapsed(state.selection)) return deleteSelection(state);
    const pos = state.selection.anchor;
    const idx = findBlockIndex(state.doc, pos.blockId);
    if (idx < 0) return state;
    const block = state.doc[idx]!;

    if (pos.offset < block.content.length) {
        const next = deleteRangeInBlock(block, pos.offset, pos.offset + 1);
        const doc = state.doc.slice();
        doc[idx] = next;
        return withCodeBlockLineAffinity({ doc, selection: state.selection, storedMarks: null });
    }
    if (idx >= state.doc.length - 1) return state;
    const after = state.doc[idx + 1]!;
    // Cells must not merge — across cell boundaries, just step the caret.
    if (block.type === "table-cell" || after.type === "table-cell") {
        return {
            ...state,
            selection: collapsedAt({ blockId: after.id, offset: 0 }),
            storedMarks: null,
        };
    }
    const merged = mergeBlocks(block, after);
    const doc = replaceRange(state.doc, idx, idx + 2, [merged]);
    return {
        doc,
        selection: collapsedAt({ blockId: merged.id, offset: pos.offset }),
        storedMarks: null,
    };
}

export function insertBreak(state: DocState): DocState {
    if (!state.selection) return state;
    let next: DocState = state;
    if (!isCollapsed(next.selection)) {
        next = deleteSelection(next);
    }
    const sel = next.selection!;
    const idx = findBlockIndex(next.doc, sel.anchor.blockId);
    if (idx < 0) return next;
    const block = next.doc[idx]!;

    // Enter inside a table cell is a no-op — cells stay single-line. Use Tab
    // (or arrow keys) to navigate, or `insertRowBelow` to add a row.
    if (block.type === "table-cell") return state;

    // Code blocks hold their own newlines — Enter inserts "\n" into content
    // instead of splitting the block. The user exits via Backspace at offset
    // 0 (converts to paragraph) or by selecting / deleting the whole block.
    //
    // After typing `\n`, the caret offset sits right after the newline char.
    // Default ("upstream") affinity would render at the right edge of the
    // newline — i.e. the end of the *prior* visual line — so the caret looks
    // stuck. Tag the resulting position downstream so it renders at the start
    // of the new line, matching what the user just asked for.
    if (block.type === "code-block") {
        const after = insertText(next, "\n");
        if (after.selection && isCollapsed(after.selection)) {
            const focus = after.selection.focus;
            return {
                ...after,
                selection: {
                    anchor: { ...focus, affinity: "downstream" },
                    focus: { ...focus, affinity: "downstream" },
                },
            };
        }
        return after;
    }

    // Markdown shortcut: pressing Enter at the end of a paragraph whose entire
    // content is "```" (optionally followed by a language id) converts it into
    // an empty code-block. Trailing-space shortcuts feel wrong for code, so we
    // hook into the line break instead.
    if (block.type === "paragraph" && sel.anchor.offset === block.content.length) {
        const m = block.content.match(/^```([\w+#.-]*)$/);
        if (m) {
            const language = m[1] ?? "";
            const codeBlock: Block = {
                id: generateId(),
                type: "code-block",
                content: "",
                marks: [],
                metadata: { language },
            };
            const doc = next.doc.slice();
            doc[idx] = codeBlock;
            return {
                doc,
                selection: collapsedAt({ blockId: codeBlock.id, offset: 0 }),
                storedMarks: null,
            };
        }
    }

    const continues = LIST_TYPES.has(block.type) || block.type === "blockquote";
    if (continues && block.content.length === 0) {
        // Enter on an empty nested blockquote outdents one level instead of
        // jumping straight to a paragraph — matches the user model of "peel
        // off one level of nesting per Enter on empty".
        if (block.type === "blockquote" && getDepth(block.metadata) > 1) {
            return { ...indentBlock(next, -1), storedMarks: null };
        }
        const para: Block = { ...block, type: "paragraph", metadata: undefined };
        const doc = next.doc.slice();
        doc[idx] = para;
        return { doc, selection: collapsedAt({ blockId: para.id, offset: 0 }), storedMarks: null };
    }

    // Enter at the very start of a heading: insert an empty paragraph in
    // front and leave the heading (and its content/metadata) intact. Without
    // this branch, the generic splitBlock path below would hand the heading
    // text to the paragraph half and leave an empty heading sitting above
    // a plain paragraph that lost its level.
    if (block.type === "heading" && sel.anchor.offset === 0) {
        const para: Block = { id: generateId(), type: "paragraph", content: "", marks: [] };
        const doc = next.doc.slice();
        doc.splice(idx, 0, para);
        return {
            doc,
            selection: collapsedAt({ blockId: block.id, offset: 0 }),
            storedMarks: null,
        };
    }

    let nextType: string | undefined;
    if (block.type === "heading") nextType = "paragraph";
    else if (block.type === "hr") nextType = "paragraph";
    else if (continues) nextType = block.type;

    const [first, second] = splitBlock(block, sel.anchor.offset, nextType);
    if (LIST_TYPES.has(block.type) && nextType === block.type) {
        const indent = (block.metadata?.indent as number | undefined) ?? 0;
        const extra: Record<string, unknown> = {};
        if (indent > 0) extra.indent = indent;
        // Ordered-list style carries over so `a.` produces `b.` on Enter,
        // `iv.` produces `v.`, etc. The renderer/serializer recount the
        // number from preceding siblings; we only need the style here.
        if (block.type === "ordered-item" && block.metadata?.style) {
            extra.style = block.metadata.style;
        }
        if (Object.keys(extra).length > 0) {
            second.metadata = { ...(second.metadata ?? {}), ...extra };
        }
    }
    if (block.type === "blockquote" && nextType === "blockquote") {
        const depth = getDepth(block.metadata);
        if (depth > 1) {
            second.metadata = { ...(second.metadata ?? {}), depth };
        }
    }
    const doc = replaceRange(next.doc, idx, idx + 1, [first, second]);
    return {
        doc,
        selection: collapsedAt({ blockId: second.id, offset: 0 }),
        storedMarks: null,
    };
}

/** Insert a new inline atom at the caret. The atom occupies 1 character. */
export function insertInlineNode(
    state: DocState,
    type: string,
    data: Record<string, unknown>,
    atomId?: string,
): DocState {
    if (!state.selection) return state;
    let next: DocState = state;
    if (!isCollapsed(next.selection)) next = deleteSelection(next);
    const sel = next.selection!;
    const idx = findBlockIndex(next.doc, sel.anchor.blockId);
    if (idx < 0) return next;
    const block = next.doc[idx]!;
    // Atomic blocks (math-block, hr) and source-mode blocks (code-block)
    // don't carry inline content, so embedding an atom would break their
    // invariants. Bail silently rather than enter a corrupt state.
    if (block.type === "math-block" || block.type === "code-block" || block.type === "hr") {
        return state;
    }
    const at = sel.anchor.offset;
    const atom: InlineNode = { id: atomId ?? generateId(), type, position: at, data };
    const newContent =
        block.content.slice(0, at) + INLINE_NODE_PLACEHOLDER + block.content.slice(at);
    const newMarks = adjustMarksForInsert(block.marks, at, 1);
    const shifted = adjustInlineNodesForInsert(block.inlineNodes, at, 1) ?? [];
    const newBlock: Block = {
        ...block,
        content: newContent,
        marks: newMarks,
        inlineNodes: [...shifted, atom].sort((a, b) => a.position - b.position),
    };
    const doc = next.doc.slice();
    doc[idx] = newBlock;
    return {
        doc,
        selection: { anchor: { blockId: block.id, offset: at + 1 }, focus: { blockId: block.id, offset: at + 1 } },
        storedMarks: null,
    };
}
