/**
 * High-level edit commands.
 *
 * Every command has the same shape: `(state: DocState) => DocState`. They are
 * pure, composable, and easy to test.
 *
 * Stored-marks contract:
 *   - `insertText` and the inline-mark `toggleMark` (collapsed branch) preserve
 *     or update `storedMarks`.
 *   - Every other command (delete, break, indent, set-block-type, range
 *     mark-toggle, block-level markdown shortcut) clears it.
 *   - Cursor movement (in the React keymap) also clears it.
 */

import {
    adjustInlineNodesForDelete,
    adjustInlineNodesForInsert,
    shiftInlineNodes,
} from "./inlineNodes";
import { adjustMarksForDelete, adjustMarksForInsert, hasMarkInRange, shiftMarks, toggleMark as toggleMarkInList } from "./marks";
import {
    deleteRangeInBlock,
    findBlockIndex,
    generateId,
    insertTextInBlock,
    mergeBlocks,
    replaceRange,
    splitBlock,
} from "./transform";
import { getTableCellMeta, parseOrderedMarker } from "./schema";
import { createEmptyTable } from "./tableCommands";
import type { Block, Doc, DocState, InlineNode, Mark, MarkType, Position, Selection } from "./types";
import { INLINE_NODE_PLACEHOLDER, isCollapsed } from "./types";

const LIST_TYPES = new Set(["bullet-item", "ordered-item", "task-item"]);

/** Blockquote depth (>= 1). Depth 1 is the unnested base level. */
function getDepth(metadata: Record<string, unknown> | undefined): number {
    return (metadata?.depth as number | undefined) ?? 1;
}

/**
 * Set the depth field on metadata. Depth 1 (base level) is the implicit default
 * and is stored as the absence of the `depth` key, mirroring how lists treat
 * `indent: 0`. Returns `undefined` if metadata would otherwise be empty.
 */
function setDepth(
    metadata: Record<string, unknown> | undefined,
    depth: number,
): Record<string, unknown> | undefined {
    const rest = { ...(metadata ?? {}) };
    delete rest.depth;
    if (depth > 1) rest.depth = depth;
    return Object.keys(rest).length > 0 ? rest : undefined;
}

function normalizeSelection(
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

function collapsedAt(pos: Position): Selection {
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
function withCodeBlockLineAffinity(state: DocState): DocState {
    if (!state.selection || !isCollapsed(state.selection)) return state;
    const focus = state.selection.focus;
    const block = state.doc.find((b) => b.id === focus.blockId);
    if (!block || block.type !== "code-block") return state;
    if (focus.offset === 0 || block.content[focus.offset - 1] !== "\n") return state;
    if (focus.affinity === "downstream") return state;
    const next: Position = { ...focus, affinity: "downstream" };
    return { ...state, selection: { anchor: next, focus: next } };
}

// =============================================================================
// Active / stored marks
// =============================================================================

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

// =============================================================================
// Mark range helpers (private)
// =============================================================================

/** Add a mark to a range. Idempotent; merges with adjacent same-type marks. */
function applyMarkToList(marks: Mark[], type: MarkType, from: number, to: number): Mark[] {
    if (from === to || hasMarkInRange(marks, type, from, to)) return marks;
    let newStart = from;
    let newEnd = to;
    const out: Mark[] = [];
    for (const m of marks) {
        if (m.type !== type || m.end < from || m.start > to) {
            out.push(m);
            continue;
        }
        newStart = Math.min(newStart, m.start);
        newEnd = Math.max(newEnd, m.end);
    }
    out.push({ type, start: newStart, end: newEnd });
    return out.sort((a, b) => a.start - b.start);
}

/**
 * Reconcile the marks covering `[from, to)` to be exactly `activeTypes`.
 * Other marks (outside this range, or partially overlapping) are unaffected
 * beyond the natural split that removal causes.
 */
function ensureMarksOnRange(
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

// =============================================================================
// Editing commands
// =============================================================================

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
        const cur = (block.metadata?.depth as number | undefined) ?? 1;
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

// =============================================================================
// Inline node commands (insert / update)
// =============================================================================

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

// =============================================================================
// Word / boundary utilities
// =============================================================================

function isWordChar(c: string | undefined): boolean {
    if (c === undefined) return false;
    return /[\p{L}\p{N}_']/u.test(c);
}

export function findWordBoundaryBackward(content: string, offset: number): number {
    let i = Math.min(Math.max(offset, 0), content.length);
    while (i > 0 && !isWordChar(content[i - 1])) i--;
    while (i > 0 && isWordChar(content[i - 1])) i--;
    return i;
}

export function findWordBoundaryForward(content: string, offset: number): number {
    let i = Math.min(Math.max(offset, 0), content.length);
    while (i < content.length && !isWordChar(content[i])) i++;
    while (i < content.length && isWordChar(content[i])) i++;
    return i;
}

// =============================================================================
// Block-level markdown shortcuts
// =============================================================================

interface BlockShortcut {
    pattern: RegExp;
    /**
     * Block types this shortcut can be applied to. Most shortcuts only fire on
     * paragraph (the user is typing the first characters of a new block), but
     * `> ` also fires inside an existing blockquote to deepen the nesting.
     */
    accepts: (type: string) => boolean;
    /**
     * Return null to decline the match — used when the regex matches a
     * candidate string but secondary disambiguation rejects it (e.g. an
     * ordered-list marker that isn't a valid alpha/roman).
     */
    transform: (block: Block, m: RegExpMatchArray) => {
        type: string;
        metadata?: Record<string, unknown>;
        consumed: number;
    } | null;
}

const BLOCK_SHORTCUTS: BlockShortcut[] = [
    {
        pattern: /^(#{1,6}) $/,
        accepts: (t) => t === "paragraph",
        transform: (_block, m) => ({ type: "heading", metadata: { level: m[1]!.length }, consumed: m[0]!.length }),
    },
    // Task item from a paragraph, e.g. when pasting `- [ ] foo`. The mid-
    // typing path fires through the bullet-item case below (the user types
    // `- ` first, which converts to a bullet, then `[ ] ` finishes the
    // conversion to a task).
    {
        pattern: /^[-*] \[([ xX])\] $/,
        accepts: (t) => t === "paragraph",
        transform: (_block, m) => ({
            type: "task-item",
            metadata: { checked: m[1] === "x" || m[1] === "X" },
            consumed: m[0]!.length,
        }),
    },
    {
        pattern: /^\[([ xX])\] $/,
        accepts: (t) => t === "bullet-item",
        transform: (_block, m) => ({
            type: "task-item",
            metadata: { checked: m[1] === "x" || m[1] === "X" },
            consumed: m[0]!.length,
        }),
    },
    {
        pattern: /^[-*] $/,
        accepts: (t) => t === "paragraph",
        transform: (_block, m) => ({ type: "bullet-item", consumed: m[0]!.length }),
    },
    {
        // Ordered list with any supported marker: `1. `, `a. `, `A. `, `i. `,
        // `I. ` (and multi-char roman variants). Decimal markers may start at
        // any number; alpha/roman markers always start a list at their parsed
        // value (e.g. `c. ` starts a lower-alpha list at position 3).
        pattern: /^([a-zA-Z]+|\d+)\. $/,
        accepts: (t) => t === "paragraph",
        transform: (_block, m) => {
            const parsed = parseOrderedMarker(m[1]!);
            if (!parsed) return null;
            return {
                type: "ordered-item",
                metadata: { number: parsed.number, style: parsed.style },
                consumed: m[0]!.length,
            };
        },
    },
    {
        pattern: /^> $/,
        accepts: (t) => t === "paragraph" || t === "blockquote",
        transform: (block, m) => {
            const nextDepth = block.type === "blockquote" ? getDepth(block.metadata) + 1 : 1;
            return {
                type: "blockquote",
                metadata: setDepth(block.metadata, nextDepth),
                consumed: m[0]!.length,
            };
        },
    },
];

export function applyMarkdownShortcuts(state: DocState): DocState {
    if (!state.selection || !isCollapsed(state.selection)) return state;
    const pos = state.selection.anchor;
    const idx = findBlockIndex(state.doc, pos.blockId);
    if (idx < 0) return state;
    const block = state.doc[idx]!;

    // HR shortcut: in a paragraph whose entire content is `---` (or `***` /
    // `___`), replace the paragraph with an HR block plus a fresh paragraph
    // below for further typing. No trailing space required — the rule fires
    // as soon as the third character is typed, like Notion.
    if (
        block.type === "paragraph" &&
        pos.offset === block.content.length &&
        /^(?:---|\*\*\*|___)$/.test(block.content)
    ) {
        const hr: Block = { id: generateId(), type: "hr", content: "", marks: [] };
        const para: Block = { id: generateId(), type: "paragraph", content: "", marks: [] };
        const doc = state.doc.slice();
        doc.splice(idx, 1, hr, para);
        return {
            doc,
            selection: collapsedAt({ blockId: para.id, offset: 0 }),
            storedMarks: null,
        };
    }

    // Math-block shortcut: a paragraph whose entire content is `$$` becomes
    // an empty math-block (plus a trailing paragraph for further typing).
    // The editor's existing math-block detection auto-opens the popover as
    // soon as the cursor lands inside the new block, so the user just keeps
    // typing LaTeX. Fires after the second `$` is typed — the inline
    // `$...$` shortcut intentionally skips `$$` pairs (see `tryMathShortcut`),
    // so the two paths don't conflict.
    if (
        block.type === "paragraph" &&
        pos.offset === block.content.length &&
        block.content === "$$"
    ) {
        const math: Block = {
            id: generateId(),
            type: "math-block",
            content: "",
            marks: [],
            metadata: { latex: "" },
        };
        const para: Block = { id: generateId(), type: "paragraph", content: "", marks: [] };
        const doc = state.doc.slice();
        doc.splice(idx, 1, math, para);
        return {
            doc,
            selection: collapsedAt({ blockId: math.id, offset: 0 }),
            storedMarks: null,
        };
    }

    // Table shortcut: at the head of a paragraph whose entire content is
    // "|||...| " (3+ pipes then space), replace with an empty (N-1)-column
    // 2-row table and focus cell (0, 0). `|||` → 2 cols, `||||` → 3 cols, …
    if (
        block.type === "paragraph" &&
        pos.offset === block.content.length &&
        /^\|{3,} $/.test(block.content)
    ) {
        const pipes = block.content.length - 1;
        const cols = pipes - 1;
        const cells = createEmptyTable(2, cols);
        const doc = state.doc.slice();
        doc.splice(idx, 1, ...cells);
        return {
            doc,
            selection: collapsedAt({ blockId: cells[0]!.id, offset: 0 }),
            storedMarks: null,
        };
    }

    for (const sc of BLOCK_SHORTCUTS) {
        if (!sc.accepts(block.type)) continue;
        const prefix = block.content.slice(0, pos.offset);
        const m = prefix.match(sc.pattern);
        if (!m || m[0]!.length !== pos.offset) continue;
        const t = sc.transform(block, m);
        if (!t) continue;
        const next: Block = {
            ...block,
            type: t.type,
            metadata: t.metadata,
            content: block.content.slice(t.consumed),
            marks: adjustMarksForDelete(block.marks, 0, t.consumed),
        };
        const doc = state.doc.slice();
        doc[idx] = next;
        return {
            doc,
            selection: collapsedAt({ blockId: next.id, offset: 0 }),
            storedMarks: null,
        };
    }
    return state;
}

// =============================================================================
// Inline mark shortcuts
// =============================================================================

interface InlineShortcut {
    delim: string;
    markType: string;
}

const INLINE_SHORTCUTS: InlineShortcut[] = [
    { delim: "**", markType: "bold" },
    { delim: "~~", markType: "strike" },
    { delim: "`", markType: "code" },
    { delim: "*", markType: "italic" },
    { delim: "_", markType: "italic" },
];

/**
 * Convert `![alt](src)` ending at `cursorOffset` into an inline image atom.
 */
function tryImageShortcut(state: DocState, idx: number, cursorOffset: number): DocState | null {
    const block = state.doc[idx]!;
    if (block.content[cursorOffset - 1] !== ")") return null;
    const closeParen = cursorOffset - 1;
    const before = block.content.slice(0, closeParen);
    const labelEnd = before.lastIndexOf("](");
    if (labelEnd < 0) return null;
    const openBang = block.content.lastIndexOf("![", labelEnd);
    if (openBang < 0) return null;
    // Reject mismatched brackets: anything between `![` and `](` must not
    // contain another `[` or `]`.
    const alt = block.content.slice(openBang + 2, labelEnd);
    if (alt.includes("[") || alt.includes("]")) return null;
    const src = block.content.slice(labelEnd + 2, closeParen);
    if (src.length === 0) return null;
    if (alt.includes(INLINE_NODE_PLACEHOLDER) || src.includes(INLINE_NODE_PLACEHOLDER)) return null;

    const newContent =
        block.content.slice(0, openBang) +
        INLINE_NODE_PLACEHOLDER +
        block.content.slice(cursorOffset);

    let nextMarks = adjustMarksForDelete(block.marks, openBang, cursorOffset);
    nextMarks = adjustMarksForInsert(nextMarks, openBang, 1);

    let nextNodes = adjustInlineNodesForDelete(block.inlineNodes, openBang, cursorOffset);
    nextNodes = adjustInlineNodesForInsert(nextNodes, openBang, 1);

    const atom: InlineNode = {
        id: generateId(),
        type: "image",
        position: openBang,
        data: { alt, src },
    };
    const inlineNodes = [...(nextNodes ?? []), atom].sort((a, b) => a.position - b.position);

    const newBlock: Block = {
        ...block,
        content: newContent,
        marks: nextMarks,
        inlineNodes,
    };
    const doc = state.doc.slice();
    doc[idx] = newBlock;
    return {
        ...state,
        doc,
        selection: collapsedAt({ blockId: newBlock.id, offset: openBang + 1 }),
        storedMarks: null,
    };
}

/**
 * Convert `[label](url)` ending at `cursorOffset` into a link mark over `label`.
 *
 * Implementation: delete `](url)`, then `[`, then add the link mark over the
 * range the label now occupies. `storedMarks` is set so the next typed char
 * isn't absorbed back into the link by left-side bias.
 */
function tryLinkShortcut(state: DocState, idx: number, cursorOffset: number): DocState | null {
    const block = state.doc[idx]!;
    if (block.content[cursorOffset - 1] !== ")") return null;
    const closeParen = cursorOffset - 1;
    const before = block.content.slice(0, closeParen);
    const labelEnd = before.lastIndexOf("](");
    if (labelEnd < 0) return null;
    // Walk back from labelEnd to find the matching `[`. Bail if we hit a `]`
    // or `[` along the way that breaks the bracket balance.
    let openBracket = -1;
    for (let k = labelEnd - 1; k >= 0; k--) {
        const ch = block.content[k];
        if (ch === "]") return null;
        if (ch === "[") {
            openBracket = k;
            break;
        }
    }
    if (openBracket < 0) return null;
    // Image shortcut handles `![...](...)`. Bail if `[` is preceded by `!`.
    if (openBracket > 0 && block.content[openBracket - 1] === "!") return null;

    const label = block.content.slice(openBracket + 1, labelEnd);
    if (label.length === 0) return null;
    const url = block.content.slice(labelEnd + 2, closeParen);
    if (url.length === 0) return null;

    // Step 1: delete `](url)` from labelEnd to cursorOffset.
    let nextContent = block.content.slice(0, labelEnd) + block.content.slice(cursorOffset);
    let nextMarks = adjustMarksForDelete(block.marks, labelEnd, cursorOffset);
    let nextNodes = adjustInlineNodesForDelete(block.inlineNodes, labelEnd, cursorOffset);

    // Step 2: delete the opening `[`.
    nextContent = nextContent.slice(0, openBracket) + nextContent.slice(openBracket + 1);
    nextMarks = adjustMarksForDelete(nextMarks, openBracket, openBracket + 1);
    nextNodes = adjustInlineNodesForDelete(nextNodes, openBracket, openBracket + 1);

    // Step 3: add the link mark over what was the label.
    const linkId = generateId();
    const markEnd = openBracket + label.length;
    const linkMark: Mark = {
        type: "link",
        start: openBracket,
        end: markEnd,
        attrs: { href: url, linkId },
    };
    nextMarks = [...nextMarks, linkMark].sort((a, b) => a.start - b.start);

    const newBlock: Block = {
        ...block,
        content: nextContent,
        marks: nextMarks,
        inlineNodes: nextNodes,
    };
    const doc = state.doc.slice();
    doc[idx] = newBlock;
    const newPos: Position = { blockId: newBlock.id, offset: markEnd };
    return {
        ...state,
        doc,
        selection: collapsedAt(newPos),
        storedMarks: marksAtPosition(doc, newPos).filter((t) => t !== "link"),
    };
}

/**
 * Convert `$...$` ending at `cursorOffset` into an inline math atom.
 * Returns the new state, or null if no conversion fired.
 */
function tryMathShortcut(state: DocState, idx: number, cursorOffset: number): DocState | null {
    const block = state.doc[idx]!;
    const closerStart = cursorOffset - 1;
    const before = block.content.slice(0, closerStart);
    const openerStart = before.lastIndexOf("$");
    if (openerStart < 0) return null;
    // Don't treat `$$` as a pair.
    if (block.content[openerStart + 1] === "$") return null;

    const inner = block.content.slice(openerStart + 1, closerStart);
    if (inner.length === 0) return null;
    if (/^\s/.test(inner) || /\s$/.test(inner)) return null;
    if (inner.includes("$")) return null;
    if (inner.includes(INLINE_NODE_PLACEHOLDER)) return null;

    // Replace `$inner$` with a single placeholder + atom.
    const newContent =
        block.content.slice(0, openerStart) +
        INLINE_NODE_PLACEHOLDER +
        block.content.slice(cursorOffset);

    let nextMarks = adjustMarksForDelete(block.marks, openerStart, cursorOffset);
    nextMarks = adjustMarksForInsert(nextMarks, openerStart, 1);

    let nextNodes = adjustInlineNodesForDelete(block.inlineNodes, openerStart, cursorOffset);
    nextNodes = adjustInlineNodesForInsert(nextNodes, openerStart, 1);

    const atom: InlineNode = {
        id: generateId(),
        type: "math",
        position: openerStart,
        data: { latex: inner },
    };
    const inlineNodes = [...(nextNodes ?? []), atom].sort((a, b) => a.position - b.position);

    const newBlock: Block = {
        ...block,
        content: newContent,
        marks: nextMarks,
        inlineNodes,
    };
    const doc = state.doc.slice();
    doc[idx] = newBlock;
    return {
        ...state,
        doc,
        selection: collapsedAt({ blockId: newBlock.id, offset: openerStart + 1 }),
    };
}

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

export function applyInlineShortcuts(state: DocState): DocState {
    if (!state.selection || !isCollapsed(state.selection)) return state;
    const pos = state.selection.anchor;
    const idx = findBlockIndex(state.doc, pos.blockId);
    if (idx < 0) return state;
    const block = state.doc[idx]!;

    // Skip shortcuts when the user is editing a math-block's LaTeX source —
    // `$` and `**` are LaTeX, not markdown delimiters in that context. Same
    // for code-block content: source text, not formatted prose.
    if (block.type === "math-block" || block.type === "code-block") return state;

    // Math shortcut: `$...$` ending at the cursor becomes an inline math atom.
    if (pos.offset >= 3 && block.content[pos.offset - 1] === "$") {
        const mathResult = tryMathShortcut(state, idx, pos.offset);
        if (mathResult) return mathResult;
    }

    // Link / image shortcut: `[label](url)` and `![alt](src)` both end with `)`.
    // Image is checked before link so `![…](…)` isn't read as `!`-then-link.
    if (block.content[pos.offset - 1] === ")") {
        const imgResult = tryImageShortcut(state, idx, pos.offset);
        if (imgResult) return imgResult;
        const linkResult = tryLinkShortcut(state, idx, pos.offset);
        if (linkResult) return linkResult;
    }

    for (const sc of INLINE_SHORTCUTS) {
        const d = sc.delim;
        if (pos.offset < d.length * 2 + 1) continue;
        const closerStart = pos.offset - d.length;
        if (block.content.slice(closerStart, pos.offset) !== d) continue;

        const before = block.content.slice(0, closerStart);
        const openerStart = before.lastIndexOf(d);
        if (openerStart < 0) continue;

        if (d.length === 1) {
            if (block.content[openerStart - 1] === d) continue;
            if (block.content[openerStart + 1] === d) continue;
            if (block.content[closerStart - 1] === d) continue;
        }

        const innerStart = openerStart + d.length;
        const innerEnd = closerStart;
        const inner = block.content.slice(innerStart, innerEnd);
        if (inner.length === 0) continue;
        if (/^\s/.test(inner) || /\s$/.test(inner)) continue;
        if (inner === d) continue;

        let nextMarks = adjustMarksForDelete(block.marks, innerEnd, pos.offset);
        nextMarks = adjustMarksForDelete(nextMarks, openerStart, innerStart);
        const newMark: Mark = {
            type: sc.markType,
            start: openerStart,
            end: openerStart + inner.length,
        };
        const newContent =
            block.content.slice(0, openerStart) + inner + block.content.slice(pos.offset);
        const newBlock: Block = {
            ...block,
            content: newContent,
            marks: [...nextMarks, newMark].sort((a, b) => a.start - b.start),
        };
        const doc = state.doc.slice();
        doc[idx] = newBlock;
        const newOffset = openerStart + inner.length;
        const newPos: Position = { blockId: newBlock.id, offset: newOffset };
        // The cursor now sits at the right edge of the just-applied mark.
        // Left-side bias would re-absorb the cursor into it, so the next
        // character would inherit the mark — making the closing delimiter
        // feel like a no-op. Step out explicitly by setting storedMarks to
        // the position-derived set *minus* the freshly-applied mark.
        const derived = marksAtPosition(doc, newPos);
        return {
            ...state,
            doc,
            selection: collapsedAt(newPos),
            storedMarks: derived.filter((t) => t !== sc.markType),
        };
    }
    return state;
}
