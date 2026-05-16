/**
 * Markdown -> Doc.
 *
 * Each line is offered to every BlockSpec in schema order. If none accept,
 * the line and any following non-blank lines that no block spec recognizes
 * become a paragraph (joined with spaces).
 */

import { generateId } from "../transform";
import type { Block } from "../types";
import { defaultSchema, type Schema } from "../schema";
import { createInlineParser } from "./inline";

export function parseMarkdown(md: string, schema: Schema = defaultSchema): Block[] {
    const parseInline = createInlineParser(schema.marks);
    const lines = md.split("\n");
    const out: Block[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i]!;
        if (line.trim() === "") {
            i++;
            continue;
        }

        let matched = false;
        for (const spec of schema.blocks) {
            const result = spec.parse(lines, i, parseInline);
            if (result) {
                if ("blocks" in result) out.push(...result.blocks);
                else out.push(result.block);
                i += result.consumed;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        // Paragraph fallback.
        const para: string[] = [];
        while (i < lines.length && lines[i]!.trim() !== "") {
            // Stop if a non-paragraph spec would accept this line.
            let recognized = false;
            for (const spec of schema.blocks) {
                if (spec.type === "paragraph") continue;
                if (spec.parse(lines, i, parseInline)) {
                    recognized = true;
                    break;
                }
            }
            if (recognized) break;
            para.push(lines[i]!);
            i++;
        }
        if (para.length > 0) {
            const { content, marks, inlineNodes } = parseInline(para.join(" "));
            out.push({
                id: generateId(),
                type: "paragraph",
                content,
                marks,
                inlineNodes: inlineNodes.length > 0 ? inlineNodes : undefined,
            });
        }
    }

    return out;
}
