/**
 * Block-level markdown shortcuts — typed prefixes (`# `, `- `, `> `, `1. `,
 * `--- `, `$$`, `||| `) that morph a paragraph into a different block type.
 *
 * `applyMarkdownShortcuts` runs after every keystroke. Most rules in
 * `BLOCK_SHORTCUTS` are space-gated; the HR / math-block / table rules below
 * fire on the second or third character because they have no natural trailing
 * space and would otherwise force the user to add one.
 */

import { adjustMarksForDelete } from "../marks";
import { parseOrderedMarker } from "../schema";
import { createEmptyTable } from "../tableCommands";
import { findBlockIndex, generateId } from "../transform";
import type { Block, DocState } from "../types";
import { isCollapsed } from "../types";
import { collapsedAt, getDepth, setDepth } from "./helpers";

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
