import { describe, expect, test } from "bun:test";
import { INLINE_NODE_PLACEHOLDER, type Block, type DocState } from "../types";
import { insertText } from "./editing";

describe("inline mark shortcuts with atoms in range", () => {
    test("closing a delimiter pair shifts atoms in lockstep with the content", () => {
        // "*a ￼ b" with the atom at offset 3; typing the closing "*" fires
        // the italic shortcut, which deletes both delimiters. The atom must
        // end up exactly where its placeholder is.
        const block: Block = {
            id: "b",
            type: "paragraph",
            content: `*a ${INLINE_NODE_PLACEHOLDER} b`,
            marks: [],
            inlineNodes: [{ id: "atom", type: "math", position: 3, data: { latex: "x" } }],
        };
        const state: DocState = {
            doc: [block],
            selection: { anchor: { blockId: "b", offset: 6 }, focus: { blockId: "b", offset: 6 } },
        };
        const out = insertText(state, "*");
        const b = out.doc[0]!;
        expect(b.content).toBe(`a ${INLINE_NODE_PLACEHOLDER} b`);
        expect(b.marks).toEqual([{ type: "italic", start: 0, end: 5 }]);
        expect(b.inlineNodes).toEqual([
            { id: "atom", type: "math", position: b.content.indexOf(INLINE_NODE_PLACEHOLDER), data: { latex: "x" } },
        ]);
    });

    test("atom after the closing delimiter shifts by both deletions", () => {
        // "**x** ￼" being completed: atom sits past the closer.
        const block: Block = {
            id: "b",
            type: "paragraph",
            content: `**x*${INLINE_NODE_PLACEHOLDER}`,
            marks: [],
            inlineNodes: [{ id: "atom", type: "math", position: 4, data: { latex: "y" } }],
        };
        // Type the final "*" just before the atom (offset 4).
        const state: DocState = {
            doc: [block],
            selection: { anchor: { blockId: "b", offset: 4 }, focus: { blockId: "b", offset: 4 } },
        };
        const out = insertText(state, "*");
        const b = out.doc[0]!;
        expect(b.content).toBe(`x${INLINE_NODE_PLACEHOLDER}`);
        expect(b.inlineNodes?.[0]?.position).toBe(1);
        expect(b.content[b.inlineNodes![0]!.position]).toBe(INLINE_NODE_PLACEHOLDER);
    });
});
