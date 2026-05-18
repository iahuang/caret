/**
 * Inline markdown shortcuts: `$...$`, `[label](url)`, `![alt](src)`, and the
 * delimiter-based mark shortcuts (`**`, `*`, `_`, `` ` ``, `~~`).
 *
 * `applyInlineShortcuts` runs after every keystroke in `insertText`. The
 * image / link / math `try*` helpers each scan back from the cursor and
 * return null on no-match.
 */

import {
    adjustInlineNodesForDelete,
    adjustInlineNodesForInsert,
} from "../inlineNodes";
import { adjustMarksForDelete, adjustMarksForInsert } from "../marks";
import { findBlockIndex, generateId } from "../transform";
import type { Block, DocState, InlineNode, Mark, Position } from "../types";
import { INLINE_NODE_PLACEHOLDER, isCollapsed } from "../types";
import { collapsedAt } from "./helpers";
import { marksAtPosition } from "./marks";

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
