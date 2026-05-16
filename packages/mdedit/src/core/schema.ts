/**
 * Schema: block and mark specs.
 *
 * `BlockSpec.serialize` takes a `SerializeContext` (for things like ordered-
 * list numbering) and a `serializeInline` that knows about marks AND inline
 * atoms — so block-level serializers don't need to know which inline atom
 * types exist.
 */

import { generateId } from "./transform";
import type { Block, Doc, InlineNode, Mark } from "./types";
import type { InlineParseResult } from "./markdown/inline";

export type ParseInlineFn = (text: string) => InlineParseResult;
export type SerializeInlineFn = (
    content: string,
    marks: Mark[],
    inlineNodes?: InlineNode[],
) => string;

export interface SerializeContext {
    doc: Doc;
    index: number;
}

export type ParseResult =
    | { block: Block; consumed: number }
    | { blocks: Block[]; consumed: number };

export interface BlockSpec {
    type: string;
    parse: (
        lines: string[],
        startIdx: number,
        parseInline: ParseInlineFn,
    ) => ParseResult | null;
    serialize: (
        block: Block,
        serializeInline: SerializeInlineFn,
        ctx: SerializeContext,
    ) => string;
    tight?: boolean;
}

export interface MarkSpec {
    type: string;
    delimiter: string;
}

export interface Schema {
    blocks: BlockSpec[];
    marks: MarkSpec[];
}

const INDENT_SPACES = 2;

function getIndent(block: Block): number {
    return (block.metadata?.indent as number | undefined) ?? 0;
}

function indentString(level: number): string {
    return " ".repeat(level * INDENT_SPACES);
}

function maybeNodes(nodes: InlineNode[]): InlineNode[] | undefined {
    return nodes.length > 0 ? nodes : undefined;
}

// =============================================================================
// Ordered-list markers (decimal / alpha / roman, both cases)
// =============================================================================
//
// Not canonical markdown, but a common Pandoc-style extension. Lists can use
// `1.`, `a.`, `A.`, `i.`, `I.` (and continue with the next marker in the same
// style on subsequent items). Style + 1-based position are stored on each item;
// the renderer/serializer recount position from preceding same-style siblings,
// so inserting/deleting items always renumbers correctly.

export type OrderedListStyle =
    | "decimal"
    | "lower-alpha"
    | "upper-alpha"
    | "lower-roman"
    | "upper-roman";

const ROMAN_VALUES: ReadonlyArray<readonly [number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];
const ROMAN_INT: Record<string, number> = {
    i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000,
};

function romanToInt(s: string): number {
    let total = 0;
    let prev = 0;
    for (let i = s.length - 1; i >= 0; i--) {
        const v = ROMAN_INT[s[i]!.toLowerCase()]!;
        if (v < prev) total -= v;
        else total += v;
        prev = v;
    }
    return total;
}

function intToRoman(n: number, upper: boolean): string {
    if (n <= 0) return upper ? "I" : "i";
    let s = "";
    let x = n;
    for (const [v, ch] of ROMAN_VALUES) {
        while (x >= v) {
            s += ch;
            x -= v;
        }
    }
    return upper ? s.toUpperCase() : s;
}

/**
 * Parse an ordered-list marker (without the trailing `.`). Returns null if
 * the string isn't a recognized marker.
 *
 * Disambiguation rules (matches what users intuitively expect, similar to
 * Pandoc):
 *   - Pure digits → decimal.
 *   - Single letter `i` / `I` → roman (1). Most users typing `i.` mean roman.
 *   - Any other single letter → alpha.
 *   - Multiple letters that are all valid roman digits (i/v/x/l/c/d/m) → roman.
 *   - Multi-letter alpha (e.g. `aa.`, `bb.`) → not supported; returns null.
 */
export function parseOrderedMarker(
    marker: string,
): { number: number; style: OrderedListStyle } | null {
    if (/^\d+$/.test(marker)) {
        return { number: parseInt(marker, 10), style: "decimal" };
    }
    if (marker.length === 1) {
        if (/^[a-z]$/.test(marker)) {
            if (marker === "i") return { number: 1, style: "lower-roman" };
            return { number: marker.charCodeAt(0) - 96, style: "lower-alpha" };
        }
        if (/^[A-Z]$/.test(marker)) {
            if (marker === "I") return { number: 1, style: "upper-roman" };
            return { number: marker.charCodeAt(0) - 64, style: "upper-alpha" };
        }
        return null;
    }
    if (/^[ivxlcdm]+$/.test(marker)) {
        return { number: romanToInt(marker), style: "lower-roman" };
    }
    if (/^[IVXLCDM]+$/.test(marker)) {
        return { number: romanToInt(marker), style: "upper-roman" };
    }
    return null;
}

export function formatOrderedMarker(num: number, style: OrderedListStyle): string {
    if (style === "lower-alpha" || style === "upper-alpha") {
        const upper = style === "upper-alpha";
        let s = "";
        let x = Math.max(1, num);
        while (x > 0) {
            x--;
            s = String.fromCharCode((upper ? 65 : 97) + (x % 26)) + s;
            x = Math.floor(x / 26);
        }
        return s;
    }
    if (style === "lower-roman") return intToRoman(num, false);
    if (style === "upper-roman") return intToRoman(num, true);
    return String(num);
}

export function getOrderedStyle(block: Block): OrderedListStyle {
    const s = block.metadata?.style;
    if (
        s === "decimal" ||
        s === "lower-alpha" ||
        s === "upper-alpha" ||
        s === "lower-roman" ||
        s === "upper-roman"
    ) {
        return s;
    }
    return "decimal";
}

/**
 * Compute the displayed position for an ordered-item, honoring the first
 * item's stored `metadata.number` as the starting offset. A run breaks on a
 * non-ordered-item, a shallower indent, or a different style. Deeper indents
 * are skipped (nested runs don't reset the count). Items created via
 * Enter-continuation have no stored number; the value comes from the run's
 * head — so `iii.` + Enter renders the new item as `iv.`, not `i.`.
 */
export function countOrderedPosition(doc: Doc, index: number): number {
    const block = doc[index];
    if (!block || block.type !== "ordered-item") return 1;
    const indent = (block.metadata?.indent as number | undefined) ?? 0;
    const style = getOrderedStyle(block);
    let offset = 0;
    let firstIdx = index;
    for (let i = index - 1; i >= 0; i--) {
        const prev = doc[i]!;
        if (prev.type !== "ordered-item") break;
        const prevIndent = (prev.metadata?.indent as number | undefined) ?? 0;
        if (prevIndent < indent) break;
        if (prevIndent > indent) continue;
        if (getOrderedStyle(prev) !== style) break;
        firstIdx = i;
        offset++;
    }
    const firstNum = (doc[firstIdx]!.metadata?.number as number | undefined) ?? 1;
    return firstNum + offset;
}

export const headingBlock: BlockSpec = {
    type: "heading",
    parse: (lines, idx, parseInline) => {
        const line = lines[idx];
        if (!line) return null;
        const m = line.match(/^(#{1,6})\s+(.*)$/);
        if (!m) return null;
        const { content, marks, inlineNodes } = parseInline(m[2]!);
        return {
            block: {
                id: generateId(),
                type: "heading",
                content,
                marks,
                inlineNodes: maybeNodes(inlineNodes),
                metadata: { level: m[1]!.length },
            },
            consumed: 1,
        };
    },
    serialize: (block, serInline) => {
        const level = (block.metadata?.level as number | undefined) ?? 1;
        return `${"#".repeat(level)} ${serInline(block.content, block.marks, block.inlineNodes)}`;
    },
};

export const bulletItemBlock: BlockSpec = {
    type: "bullet-item",
    tight: true,
    parse: (lines, idx, parseInline) => {
        const line = lines[idx];
        if (!line) return null;
        const m = line.match(/^(\s*)[-*]\s+(.*)$/);
        if (!m) return null;
        const indent = Math.floor((m[1]?.length ?? 0) / INDENT_SPACES);
        const { content, marks, inlineNodes } = parseInline(m[2]!);
        return {
            block: {
                id: generateId(),
                type: "bullet-item",
                content,
                marks,
                inlineNodes: maybeNodes(inlineNodes),
                metadata: indent > 0 ? { indent } : undefined,
            },
            consumed: 1,
        };
    },
    serialize: (block, serInline) =>
        `${indentString(getIndent(block))}- ${serInline(block.content, block.marks, block.inlineNodes)}`,
};

export const orderedItemBlock: BlockSpec = {
    type: "ordered-item",
    tight: true,
    parse: (lines, idx, parseInline) => {
        const line = lines[idx];
        if (!line) return null;
        const m = line.match(/^(\s*)([a-zA-Z]+|\d+)\.\s+(.*)$/);
        if (!m) return null;
        const parsed = parseOrderedMarker(m[2]!);
        if (!parsed) return null;
        const indent = Math.floor((m[1]?.length ?? 0) / INDENT_SPACES);
        const { content, marks, inlineNodes } = parseInline(m[3]!);
        const metadata: Record<string, unknown> = {
            number: parsed.number,
            style: parsed.style,
        };
        if (indent > 0) metadata.indent = indent;
        return {
            block: {
                id: generateId(),
                type: "ordered-item",
                content,
                marks,
                inlineNodes: maybeNodes(inlineNodes),
                metadata,
            },
            consumed: 1,
        };
    },
    serialize: (block, serInline, ctx) => {
        const indent = getIndent(block);
        const style = getOrderedStyle(block);
        const num = countOrderedPosition(ctx.doc, ctx.index);
        const marker = formatOrderedMarker(num, style);
        return `${indentString(indent)}${marker}. ${serInline(block.content, block.marks, block.inlineNodes)}`;
    },
};

/**
 * Blockquote: each `>`-prefixed line is its own block. Nesting depth is the
 * number of leading `>` markers, stored in `metadata.depth` (>= 1). Consecutive
 * blockquote blocks are `tight`, so a multi-line quote round-trips without
 * blank-line gaps. The flat block model can't represent multi-paragraph nested
 * quotes structurally — same trade-off lists make for indent.
 *
 * Marker syntax accepts both `>>>text` (run with optional single trailing
 * space) and `> > > text` (a space between each `>`). Each `>` must be
 * followed by a space, another `>`, or end-of-line — `>foo` is a paragraph.
 */
function parseBlockquoteMarkers(line: string): { depth: number; rest: string } | null {
    let depth = 0;
    let i = 0;
    while (i < line.length && line[i] === ">") {
        depth++;
        i++;
        if (i >= line.length) break;
        if (line[i] === " ") {
            i++;
            // After the space, the next char may be another `>` (continue
            // the marker run) or content (stop and treat the rest as text).
            if (i < line.length && line[i] !== ">") break;
            continue;
        }
        if (line[i] === ">") continue;
        // `>` followed by non-space, non-`>`, non-EOL — not a valid marker.
        return null;
    }
    if (depth === 0) return null;
    return { depth, rest: line.slice(i) };
}

export const blockquoteBlock: BlockSpec = {
    type: "blockquote",
    tight: true,
    parse: (lines, idx, parseInline) => {
        const line = lines[idx];
        if (!line) return null;
        const parsed = parseBlockquoteMarkers(line);
        if (!parsed) return null;
        const { content, marks, inlineNodes } = parseInline(parsed.rest);
        const metadata: Record<string, unknown> | undefined =
            parsed.depth > 1 ? { depth: parsed.depth } : undefined;
        return {
            block: {
                id: generateId(),
                type: "blockquote",
                content,
                marks,
                inlineNodes: maybeNodes(inlineNodes),
                metadata,
            },
            consumed: 1,
        };
    },
    serialize: (block, serInline) => {
        const depth = (block.metadata?.depth as number | undefined) ?? 1;
        const inline = serInline(block.content, block.marks, block.inlineNodes);
        return `${">".repeat(depth)} ${inline}`;
    },
};

export const paragraphBlock: BlockSpec = {
    type: "paragraph",
    parse: () => null,
    serialize: (block, serInline) => serInline(block.content, block.marks, block.inlineNodes),
};

/**
 * Horizontal rule: a line of 3+ matching `-`, `*`, or `_` (with optional
 * spaces between). Atomic — no content, no marks, no metadata. Typing
 * inside an HR is a no-op (see `insertText`).
 */
export const hrBlock: BlockSpec = {
    type: "hr",
    parse: (lines, idx) => {
        const line = lines[idx];
        if (line === undefined) return null;
        // CommonMark allows up to 3 leading spaces, then 3+ of the same
        // marker with optional whitespace between, optional trailing space.
        if (!/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) return null;
        return {
            block: { id: generateId(), type: "hr", content: "", marks: [] },
            consumed: 1,
        };
    },
    serialize: () => "---",
};

/**
 * Task item: `- [ ] foo` / `- [x] foo`. Modeled as a sibling of `bullet-item`
 * — same indentation/continuation behavior, but the marker is a checkbox
 * and `metadata.checked` holds the state. Splitting a task on Enter creates
 * a fresh (unchecked) task below; that fall-through happens naturally
 * because `splitBlock` discards metadata when the caller passes a concrete
 * `nextType`.
 */
export const taskItemBlock: BlockSpec = {
    type: "task-item",
    tight: true,
    parse: (lines, idx, parseInline) => {
        const line = lines[idx];
        if (!line) return null;
        const m = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (!m) return null;
        const indent = Math.floor((m[1]?.length ?? 0) / INDENT_SPACES);
        const checked = m[2] === "x" || m[2] === "X";
        const { content, marks, inlineNodes } = parseInline(m[3]!);
        const metadata: Record<string, unknown> = { checked };
        if (indent > 0) metadata.indent = indent;
        return {
            block: {
                id: generateId(),
                type: "task-item",
                content,
                marks,
                inlineNodes: maybeNodes(inlineNodes),
                metadata,
            },
            consumed: 1,
        };
    },
    serialize: (block, serInline) => {
        const checked = (block.metadata?.checked as boolean | undefined) ?? false;
        return `${indentString(getIndent(block))}- [${checked ? "x" : " "}] ${serInline(block.content, block.marks, block.inlineNodes)}`;
    },
};

/**
 * Block math: `$$ ... $$` (single-line or multi-line). The block's `content`
 * holds the raw LaTeX; rendering is the React layer's job.
 */
/**
 * Block math is an atomic block: the LaTeX source lives in `metadata.latex`
 * and `content` is always empty. Cursor can land inside the block (for
 * navigation) but typing into it is a no-op — editing happens via the popover.
 */
export const mathBlock: BlockSpec = {
    type: "math-block",
    parse: (lines, idx) => {
        const line = lines[idx];
        if (!line || !line.startsWith("$$")) return null;
        const after = line.slice(2);

        function makeBlock(latex: string): { block: Block; consumed: number } {
            return {
                block: {
                    id: generateId(),
                    type: "math-block",
                    content: "",
                    marks: [],
                    metadata: { latex: latex.trim() },
                },
                consumed: 0, // overwritten by caller
            };
        }

        // Single-line: `$$ ... $$`
        if (after.length >= 2 && after.endsWith("$$")) {
            const out = makeBlock(after.slice(0, -2));
            out.consumed = 1;
            return out;
        }

        // Multi-line: open on this line, close on a later one.
        const latexLines: string[] = [];
        if (after.trim().length > 0) latexLines.push(after);
        for (let j = idx + 1; j < lines.length; j++) {
            const l = lines[j]!;
            if (l === "$$") {
                const out = makeBlock(latexLines.join("\n"));
                out.consumed = j - idx + 1;
                return out;
            }
            if (l.endsWith("$$")) {
                latexLines.push(l.slice(0, -2));
                const out = makeBlock(latexLines.join("\n"));
                out.consumed = j - idx + 1;
                return out;
            }
            latexLines.push(l);
        }
        return null;
    },
    serialize: (block) => {
        const latex = (block.metadata?.latex as string | undefined) ?? "";
        if (latex.includes("\n")) return `$$\n${latex}\n$$`;
        return `$$${latex}$$`;
    },
};

/**
 * Code block: ```lang\n...\n``` fenced. The source lives in `content` with
 * literal `\n` characters (the only block type that holds newlines). The
 * language id lives in `metadata.language` and is chosen via the dropdown on
 * the rendered block. Inline marks aren't applied inside code — the renderer
 * paints highlight.js tokens, not mark spans.
 */
export const codeBlock: BlockSpec = {
    type: "code-block",
    parse: (lines, idx) => {
        const line = lines[idx];
        if (!line) return null;
        const open = line.match(/^```([\w+#.-]*)\s*$/);
        if (!open) return null;
        const language = open[1] ?? "";
        const sourceLines: string[] = [];
        for (let j = idx + 1; j < lines.length; j++) {
            const l = lines[j]!;
            if (/^```\s*$/.test(l)) {
                return {
                    block: {
                        id: generateId(),
                        type: "code-block",
                        content: sourceLines.join("\n"),
                        marks: [],
                        metadata: { language },
                    },
                    consumed: j - idx + 1,
                };
            }
            sourceLines.push(l);
        }
        // Unterminated fence: consume to end of input so an in-progress block
        // round-trips, then the user can close the fence.
        return {
            block: {
                id: generateId(),
                type: "code-block",
                content: sourceLines.join("\n"),
                marks: [],
                metadata: { language },
            },
            consumed: lines.length - idx,
        };
    },
    serialize: (block) => {
        const language = (block.metadata?.language as string | undefined) ?? "";
        return `\`\`\`${language}\n${block.content}\n\`\`\``;
    },
};

/**
 * Tables — GFM pipe syntax. A table is encoded as a contiguous run of
 * `table-cell` blocks sharing a `metadata.tableId`. The parser emits all
 * `rowCount * colCount` cells in row-major order; the BlockView groups them
 * back into a real <table> at render time. Only the (0,0) cell serializes
 * the full pipe-table markdown; the rest return "" and the serializeDoc
 * separator logic skips them.
 *
 * This trade lets cells inherit ordinary block machinery (marks, inline
 * atoms, caret, undo) at the cost of being a sibling run rather than a
 * single Block. Same trick lists already play with indented bullets.
 */
export type ColAlignment = "left" | "center" | "right" | null;

export interface TableCellMeta {
    tableId: string;
    row: number;
    col: number;
    rowCount: number;
    colCount: number;
    alignment: ColAlignment[];
    isHeader: boolean;
}

export function getTableCellMeta(block: Block): TableCellMeta | null {
    const m = block.metadata;
    if (!m) return null;
    const tableId = m.tableId;
    if (typeof tableId !== "string") return null;
    return {
        tableId,
        row: (m.row as number) ?? 0,
        col: (m.col as number) ?? 0,
        rowCount: (m.rowCount as number) ?? 1,
        colCount: (m.colCount as number) ?? 1,
        alignment: ((m.alignment as ColAlignment[]) ?? []).slice(),
        isHeader: (m.isHeader as boolean) ?? false,
    };
}

const SEPARATOR_CELL = /^\s*:?-+:?\s*$/;

/**
 * Split a GFM pipe row into its cell strings. Leading and trailing pipes
 * are optional. Backslash-escaped pipes (`\|`) are literal pipe characters
 * in the cell content, not separators.
 */
function splitPipeRow(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.includes("|")) return null;
    let body = trimmed;
    if (body.startsWith("|")) body = body.slice(1);
    if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
    const cells: string[] = [];
    let cur = "";
    for (let i = 0; i < body.length; i++) {
        const c = body[i]!;
        if (c === "\\" && body[i + 1] === "|") {
            cur += "|";
            i++;
            continue;
        }
        if (c === "|") {
            cells.push(cur.trim());
            cur = "";
            continue;
        }
        cur += c;
    }
    cells.push(cur.trim());
    return cells;
}

function parseAlignment(cell: string): ColAlignment {
    const t = cell.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
}

function alignmentDelimiter(a: ColAlignment): string {
    if (a === "left") return ":---";
    if (a === "center") return ":---:";
    if (a === "right") return "---:";
    return "---";
}

function escapePipes(text: string): string {
    return text.replace(/\|/g, "\\|");
}

export const tableCellBlock: BlockSpec = {
    type: "table-cell",
    parse: (lines, idx, parseInline) => {
        const headerLine = lines[idx];
        const sepLine = lines[idx + 1];
        if (!headerLine || !sepLine) return null;
        const header = splitPipeRow(headerLine);
        if (!header || header.length === 0) return null;
        const sep = splitPipeRow(sepLine);
        if (!sep || sep.length !== header.length) return null;
        for (const s of sep) {
            if (!SEPARATOR_CELL.test(s)) return null;
        }
        const colCount = header.length;
        const alignment: ColAlignment[] = sep.map(parseAlignment);

        // Collect body rows: pipe rows with the same column count. Stop at a
        // blank line, EOF, or a row that doesn't pipe-parse.
        const bodyRows: string[][] = [];
        let j = idx + 2;
        while (j < lines.length) {
            const line = lines[j]!;
            if (line.trim() === "") break;
            const row = splitPipeRow(line);
            if (!row) break;
            // GFM is lenient about column count — pad or truncate to match.
            const padded =
                row.length === colCount
                    ? row
                    : row.length < colCount
                      ? [...row, ...Array(colCount - row.length).fill("")]
                      : row.slice(0, colCount);
            bodyRows.push(padded);
            j++;
        }

        const rowCount = 1 + bodyRows.length;
        const tableId = generateId();
        const blocks: Block[] = [];
        const allRows = [header, ...bodyRows];
        for (let r = 0; r < rowCount; r++) {
            for (let c = 0; c < colCount; c++) {
                const cellText = allRows[r]![c] ?? "";
                const { content, marks, inlineNodes } = parseInline(cellText);
                blocks.push({
                    id: generateId(),
                    type: "table-cell",
                    content,
                    marks,
                    inlineNodes: maybeNodes(inlineNodes),
                    metadata: {
                        tableId,
                        row: r,
                        col: c,
                        rowCount,
                        colCount,
                        alignment,
                        isHeader: r === 0,
                    },
                });
            }
        }
        return { blocks, consumed: j - idx };
    },
    serialize: (block, serInline, ctx) => {
        const meta = getTableCellMeta(block);
        if (!meta) return "";
        if (meta.row !== 0 || meta.col !== 0) return "";

        // Gather every cell in this table by scanning forward from `index`.
        const cells: Block[][] = Array.from({ length: meta.rowCount }, () =>
            new Array<Block>(meta.colCount),
        );
        for (let j = ctx.index; j < ctx.doc.length; j++) {
            const b = ctx.doc[j]!;
            if (b.type !== "table-cell") break;
            const m = getTableCellMeta(b);
            if (!m || m.tableId !== meta.tableId) break;
            if (m.row < meta.rowCount && m.col < meta.colCount) {
                cells[m.row]![m.col] = b;
            }
        }

        function rowToMd(row: Block[]): string {
            const cellTexts = row.map((b) =>
                b ? escapePipes(serInline(b.content, b.marks, b.inlineNodes)) : "",
            );
            return `| ${cellTexts.join(" | ")} |`;
        }

        const headerMd = rowToMd(cells[0]!);
        const sepMd = `| ${meta.alignment.map(alignmentDelimiter).join(" | ")} |`;
        const bodyMd: string[] = [];
        for (let r = 1; r < meta.rowCount; r++) bodyMd.push(rowToMd(cells[r]!));
        return [headerMd, sepMd, ...bodyMd].join("\n");
    },
};

export const boldMark: MarkSpec = { type: "bold", delimiter: "**" };
export const italicMark: MarkSpec = { type: "italic", delimiter: "*" };
export const codeMark: MarkSpec = { type: "code", delimiter: "`" };
export const strikeMark: MarkSpec = { type: "strike", delimiter: "~~" };
// Link uses `[label](href)` syntax; the delimiter field is informational only.
// Tokenizer and serializer both special-case `type === "link"`.
export const linkMark: MarkSpec = { type: "link", delimiter: "[]()" };

export const defaultSchema: Schema = {
    blocks: [
        headingBlock,
        codeBlock,
        mathBlock,
        hrBlock,
        blockquoteBlock,
        // Task before bullet — `- [ ] foo` would otherwise be parsed as a
        // bullet whose content begins with `[ ]`.
        taskItemBlock,
        bulletItemBlock,
        orderedItemBlock,
        tableCellBlock,
        paragraphBlock,
    ],
    marks: [boldMark, italicMark, codeMark, strikeMark, linkMark],
};

export function createSchema(opts: { blocks: BlockSpec[]; marks: MarkSpec[] }): Schema {
    return { blocks: opts.blocks, marks: opts.marks };
}
