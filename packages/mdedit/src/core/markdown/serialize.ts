/**
 * Doc -> Markdown.
 *
 * `serializeInline` walks character-by-character, emitting:
 *   - mark delimiters at mark boundaries (close-then-open ordering for
 *     well-nested output)
 *   - link marks as `[label](href)` (special-cased: opens `[`, closes
 *     `](href)`, and `]` inside the label is escaped to `\]`)
 *   - inline-atom markdown (`$latex$`, `![alt](src)`) at placeholder positions
 *   - escaped backslashes; everything else verbatim
 */

import type { Block, InlineNode, Mark } from "../types";
import { INLINE_NODE_PLACEHOLDER } from "../types";
import { defaultSchema, type MarkSpec, type Schema } from "../schema";

function serializeInlineNode(node: InlineNode): string {
    if (node.type === "math") {
        const latex = (node.data.latex as string | undefined) ?? "";
        return `$${latex}$`;
    }
    if (node.type === "image") {
        const alt = ((node.data.alt as string | undefined) ?? "").replace(/]/g, "\\]");
        const src = ((node.data.src as string | undefined) ?? "").replace(/\)/g, "\\)");
        return `![${alt}](${src})`;
    }
    // Unknown atom: emit the placeholder so at least round-tripping doesn't
    // corrupt offset math.
    return INLINE_NODE_PLACEHOLDER;
}

export function createInlineSerializer(
    marks: MarkSpec[],
): (content: string, blockMarks: Mark[], inlineNodes?: InlineNode[]) => string {
    const delimByType = new Map<string, string>(
        marks.filter((m) => m.type !== "link").map((m) => [m.type, m.delimiter]),
    );

    function escapeChar(c: string): string {
        return c === "\\" ? "\\\\" : c;
    }

    return function serializeInline(content, blockMarks, inlineNodes) {
        const nodeByPos = new Map<number, InlineNode>();
        for (const n of inlineNodes ?? []) nodeByPos.set(n.position, n);

        if (blockMarks.length === 0) {
            let out = "";
            for (let i = 0; i < content.length; i++) {
                const c = content[i]!;
                if (c === INLINE_NODE_PLACEHOLDER) {
                    const node = nodeByPos.get(i);
                    if (node) out += serializeInlineNode(node);
                    else out += escapeChar(c);
                } else {
                    out += escapeChar(c);
                }
            }
            return out;
        }

        type Action = { kind: "open" | "close"; markType: string; idx: number };
        const actions = new Map<number, Action[]>();
        const add = (pos: number, a: Action) => {
            const arr = actions.get(pos);
            if (arr) arr.push(a);
            else actions.set(pos, [a]);
        };
        blockMarks.forEach((m, idx) => {
            add(m.start, { kind: "open", markType: m.type, idx });
            add(m.end, { kind: "close", markType: m.type, idx });
        });

        let out = "";
        let linkDepth = 0;
        for (let i = 0; i <= content.length; i++) {
            const acts = actions.get(i);
            if (acts) {
                const closes = acts.filter((a) => a.kind === "close").sort((a, b) => b.idx - a.idx);
                const opens = acts.filter((a) => a.kind === "open").sort((a, b) => a.idx - b.idx);
                for (const c of closes) {
                    if (c.markType === "link") {
                        const m = blockMarks[c.idx];
                        const href = ((m?.attrs?.href as string | undefined) ?? "").replace(
                            /\)/g,
                            "\\)",
                        );
                        out += `](${href})`;
                        linkDepth--;
                    } else {
                        out += delimByType.get(c.markType) ?? "";
                    }
                }
                for (const o of opens) {
                    if (o.markType === "link") {
                        out += "[";
                        linkDepth++;
                    } else {
                        out += delimByType.get(o.markType) ?? "";
                    }
                }
            }
            if (i < content.length) {
                const c = content[i]!;
                if (c === INLINE_NODE_PLACEHOLDER) {
                    const node = nodeByPos.get(i);
                    if (node) out += serializeInlineNode(node);
                    else out += escapeChar(c);
                } else if (linkDepth > 0 && c === "]") {
                    out += "\\]";
                } else {
                    out += escapeChar(c);
                }
            }
        }
        return out;
    };
}

function stripTrailingEmptyParagraph(doc: Block[]): Block[] {
    if (doc.length === 0) return doc;
    const last = doc[doc.length - 1]!;
    if (
        last.type === "paragraph" &&
        last.content === "" &&
        last.marks.length === 0 &&
        (last.inlineNodes === undefined || last.inlineNodes.length === 0)
    ) {
        return doc.slice(0, -1);
    }
    return doc;
}

// Bullet and task items belong to the same "unordered list" family for
// serialization tightness — a run of mixed `- foo` and `- [ ] bar` should
// emit one tight list rather than blank-line-separated chunks.
function sameTightFamily(a: string, b: string): boolean {
    if (a === b) return true;
    const UL = new Set(["bullet-item", "task-item"]);
    if (UL.has(a) && UL.has(b)) return true;
    return false;
}

export function serializeDoc(doc: Block[], schema: Schema = defaultSchema): string {
    const serInline = createInlineSerializer(schema.marks);
    const specByType = new Map(schema.blocks.map((s) => [s.type, s]));
    const parts: string[] = [];
    let lastIdx = -1;

    // Drop a single trailing empty paragraph. The editor auto-appends one
    // after atomic / source-mode last blocks so the caret can exit them;
    // it's a UI affordance, not user content, so saves shouldn't gain a
    // spurious blank line. Only the very last block is considered — empty
    // paragraphs that appear earlier are real user-authored gaps.
    const effective = stripTrailingEmptyParagraph(doc);

    for (let i = 0; i < effective.length; i++) {
        const block = effective[i]!;
        const spec = specByType.get(block.type);
        if (!spec) continue;
        const text = spec.serialize(block, serInline, { doc: effective, index: i });
        // A block can opt out by returning "" — used by table-cell blocks where
        // only the first cell emits the full pipe-table markdown.
        if (text === "") continue;

        if (lastIdx >= 0) {
            const prev = effective[lastIdx]!;
            const prevSpec = specByType.get(prev.type);
            const tight = spec.tight && prevSpec?.tight && sameTightFamily(prev.type, block.type);
            parts.push(tight ? "\n" : "\n\n");
        }
        parts.push(text);
        lastIdx = i;
    }
    return parts.join("");
}
