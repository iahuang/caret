/**
 * Inline markdown: text + delimiter pairs + `$…$` math atoms + links/images.
 *
 * Token kinds:
 *   - text: literal characters
 *   - delim: opening/closing mark delimiter (paired greedily by type)
 *   - atom: a fully-resolved inline atom (`$…$` math, `![alt](src)` image)
 *   - linkOpen / linkClose: bracket the label of a `[label](url)` link.
 *     Paired by `linkId`; produce a `link` mark with `attrs: { href, linkId }`.
 *
 * Atoms are tokenized eagerly (left-to-right, find next unescaped `$`) so
 * they short-circuit mark detection inside their range. Links are similarly
 * eager; their label is sub-tokenized so marks/atoms inside the label still
 * apply, but delimiter pairing across the link boundary is forbidden.
 */

import { generateId } from "../transform";
import { INLINE_NODE_PLACEHOLDER, type InlineNode, type Mark } from "../types";
import type { MarkSpec } from "../schema";

export interface InlineParseResult {
    content: string;
    marks: Mark[];
    inlineNodes: InlineNode[];
}

type Token =
    | { kind: "text"; value: string }
    | { kind: "delim"; raw: string; markType: string }
    | { kind: "atom"; type: string; data: Record<string, unknown> }
    | { kind: "linkOpen"; href: string; linkId: string }
    | { kind: "linkClose"; linkId: string };

/**
 * Match `[label](url)` starting at `openIdx` (which must be the `[`).
 * Returns the label/url plus the index of the closing `)`, or null if the
 * pattern doesn't match. No bracket nesting in v1; backslash escapes inside
 * the label and url are recognized so `\]` / `\)` can be used as literals.
 */
function findLinkBracket(
    line: string,
    openIdx: number,
): { label: string; url: string; end: number } | null {
    if (line[openIdx] !== "[") return null;
    let i = openIdx + 1;
    while (i < line.length) {
        if (line[i] === "\\" && i + 1 < line.length) {
            i += 2;
            continue;
        }
        if (line[i] === "]") break;
        if (line[i] === "[") return null;
        i++;
    }
    if (line[i] !== "]") return null;
    const closeBracket = i;
    if (line[closeBracket + 1] !== "(") return null;
    let j = closeBracket + 2;
    while (j < line.length) {
        if (line[j] === "\\" && j + 1 < line.length) {
            j += 2;
            continue;
        }
        if (line[j] === ")") break;
        j++;
    }
    if (line[j] !== ")") return null;
    const closeParen = j;
    return {
        label: line.slice(openIdx + 1, closeBracket),
        url: line.slice(closeBracket + 2, closeParen),
        end: closeParen,
    };
}

function tokenize(line: string, marks: MarkSpec[]): Token[] {
    const sorted = [...marks].sort((a, b) => b.delimiter.length - a.delimiter.length);
    const codeMark = marks.find((m) => m.delimiter === "`");
    const tokens: Token[] = [];
    let buf = "";
    let i = 0;

    function flush() {
        if (buf.length > 0) {
            tokens.push({ kind: "text", value: buf });
            buf = "";
        }
    }

    while (i < line.length) {
        // Escape handling first.
        if (line[i] === "\\" && i + 1 < line.length) {
            buf += line[i + 1];
            i += 2;
            continue;
        }

        // Code span: contents between matched backticks are literal — no
        // nested marks or atoms. CommonMark's rule, and the reason
        // `` `$x^2$` `` should render as a code span around the literal
        // text rather than wrapping a math atom.
        if (codeMark && line[i] === "`") {
            const end = line.indexOf("`", i + 1);
            if (end > i) {
                flush();
                tokens.push({ kind: "delim", raw: "`", markType: codeMark.type });
                const inner = line.slice(i + 1, end);
                if (inner.length > 0) tokens.push({ kind: "text", value: inner });
                tokens.push({ kind: "delim", raw: "`", markType: codeMark.type });
                i = end + 1;
                continue;
            }
        }

        // Image atom: `![alt](src)`. Check before link so the `!` prefix
        // wins. `findLinkBracket` operates on the `[` at `i + 1`.
        if (line[i] === "!" && line[i + 1] === "[") {
            const bracket = findLinkBracket(line, i + 1);
            if (bracket) {
                flush();
                tokens.push({
                    kind: "atom",
                    type: "image",
                    data: { alt: bracket.label, src: bracket.url },
                });
                i = bracket.end + 1;
                continue;
            }
        }

        // Link: `[label](url)`. Sub-tokenize the label so inner marks/atoms
        // still apply, but emit linkOpen/linkClose markers so the outer
        // pairing pass can refuse to pair delims across the link boundary.
        if (line[i] === "[") {
            const bracket = findLinkBracket(line, i);
            if (bracket) {
                flush();
                const linkId = generateId();
                tokens.push({ kind: "linkOpen", href: bracket.url, linkId });
                for (const tk of tokenize(bracket.label, marks)) tokens.push(tk);
                tokens.push({ kind: "linkClose", linkId });
                i = bracket.end + 1;
                continue;
            }
        }

        // Inline math: `$ … $` where the inner span is non-empty and not
        // whitespace-edged. Excludes `$$` so block math markers don't fire.
        if (line[i] === "$" && line[i + 1] !== "$") {
            const end = line.indexOf("$", i + 1);
            if (end > i + 1) {
                const latex = line.slice(i + 1, end);
                if (
                    latex.length > 0 &&
                    !latex.startsWith(" ") &&
                    !latex.endsWith(" ") &&
                    !latex.includes("\n")
                ) {
                    flush();
                    tokens.push({ kind: "atom", type: "math", data: { latex } });
                    i = end + 1;
                    continue;
                }
            }
        }

        // Mark delimiter.
        let matched: MarkSpec | null = null;
        for (const m of sorted) {
            // Link spec has a sentinel delimiter; never treat it as a
            // regular delim. Links are tokenized above.
            if (m.type === "link") continue;
            if (line.startsWith(m.delimiter, i)) {
                matched = m;
                break;
            }
        }
        if (matched) {
            flush();
            tokens.push({ kind: "delim", raw: matched.delimiter, markType: matched.type });
            i += matched.delimiter.length;
            continue;
        }

        buf += line[i];
        i++;
    }
    flush();
    return tokens;
}

export function createInlineParser(marks: MarkSpec[]): (line: string) => InlineParseResult {
    return function parseInline(line: string): InlineParseResult {
        const tokens = tokenize(line, marks);

        // Collect link regions first so the delimiter pairing pass can refuse
        // to pair delims that straddle a link boundary (CommonMark: emphasis
        // can't extend across link text). Links don't nest in v1.
        type LinkRegion = { openIdx: number; closeIdx: number; href: string; linkId: string };
        const linkRegions: LinkRegion[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i]!;
            if (t.kind !== "linkOpen") continue;
            for (let j = i + 1; j < tokens.length; j++) {
                const u = tokens[j]!;
                if (u.kind === "linkClose" && u.linkId === t.linkId) {
                    linkRegions.push({
                        openIdx: i,
                        closeIdx: j,
                        href: t.href,
                        linkId: t.linkId,
                    });
                    break;
                }
            }
        }
        function sameLinkScope(i: number, j: number): boolean {
            for (const r of linkRegions) {
                const iIn = i > r.openIdx && i < r.closeIdx;
                const jIn = j > r.openIdx && j < r.closeIdx;
                if (iIn !== jIn) return false;
            }
            return true;
        }

        type PairInfo = {
            start: number;
            end: number;
            markType: string;
            attrs?: Record<string, unknown>;
        };
        const used = new Set<number>();
        const pairs: PairInfo[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i]!;
            if (t.kind !== "delim" || used.has(i)) continue;
            for (let j = i + 1; j < tokens.length; j++) {
                const u = tokens[j]!;
                if (
                    u.kind === "delim" &&
                    u.markType === t.markType &&
                    !used.has(j) &&
                    sameLinkScope(i, j)
                ) {
                    pairs.push({ start: i, end: j, markType: t.markType });
                    used.add(i);
                    used.add(j);
                    break;
                }
            }
        }
        for (const r of linkRegions) {
            pairs.push({
                start: r.openIdx,
                end: r.closeIdx,
                markType: "link",
                attrs: { href: r.href, linkId: r.linkId },
            });
        }

        let content = "";
        const tokenStarts: number[] = new Array(tokens.length);
        const inlineNodes: InlineNode[] = [];
        for (let i = 0; i < tokens.length; i++) {
            tokenStarts[i] = content.length;
            const t = tokens[i]!;
            if (t.kind === "text") {
                content += t.value;
            } else if (t.kind === "atom") {
                inlineNodes.push({
                    id: generateId(),
                    type: t.type,
                    position: content.length,
                    data: t.data,
                });
                content += INLINE_NODE_PLACEHOLDER;
            } else if (t.kind === "linkOpen" || t.kind === "linkClose") {
                // zero-width
            } else if (!used.has(i)) {
                content += t.raw;
            }
        }

        const outMarks: Mark[] = [];
        for (const p of pairs) {
            const start = tokenStarts[p.start]!;
            const end = tokenStarts[p.end]!;
            if (end > start) {
                const mark: Mark = { type: p.markType, start, end };
                if (p.attrs) mark.attrs = p.attrs;
                outMarks.push(mark);
            }
        }
        outMarks.sort((a, b) => a.start - b.start);
        return { content, marks: outMarks, inlineNodes };
    };
}
