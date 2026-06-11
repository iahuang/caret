import { describe, expect, test } from "bun:test";
import { serializeDoc } from "../markdown/serialize";
import type { Block, DocState } from "../types";
import { deleteBackward, deleteForward, deleteSelection, insertBreak, insertText } from "./editing";

function para(id: string, content: string): Block {
    return { id, type: "paragraph", content, marks: [] };
}

function hr(id: string): Block {
    return { id, type: "hr", content: "", marks: [] };
}

function math(id: string, latex: string): Block {
    return { id, type: "math-block", content: "", marks: [], metadata: { latex } };
}

function caretIn(doc: Block[], blockId: string, offset: number): DocState {
    return {
        doc,
        selection: {
            anchor: { blockId, offset },
            focus: { blockId, offset },
        },
    };
}

describe("deleteBackward at block boundaries", () => {
    test("after an hr deletes the hr, not the paragraph text", () => {
        const state = caretIn([hr("h"), para("p", "hello")], "p", 0);
        const out = deleteBackward(state);
        expect(out.doc.map((b) => b.type)).toEqual(["paragraph"]);
        expect(out.doc[0]!.content).toBe("hello");
        expect(serializeDoc(out.doc)).toBe("hello");
        expect(out.selection?.focus).toEqual({ blockId: "p", offset: 0 });
    });

    test("after a math-block deletes the math-block, not the paragraph text", () => {
        const state = caretIn([math("m", "x^2"), para("p", "hello")], "p", 0);
        const out = deleteBackward(state);
        expect(out.doc.map((b) => b.type)).toEqual(["paragraph"]);
        expect(serializeDoc(out.doc)).toBe("hello");
    });

    test("after a table-cell steps the caret instead of merging", () => {
        const cell: Block = {
            id: "c",
            type: "table-cell",
            content: "cell",
            marks: [],
            metadata: { tableId: "t", row: 0, col: 0, rowCount: 1, colCount: 1, alignment: [null], isHeader: true },
        };
        const state = caretIn([cell, para("p", "hello")], "p", 0);
        const out = deleteBackward(state);
        expect(out.doc).toEqual(state.doc);
        expect(out.selection?.focus).toEqual({ blockId: "c", offset: 4 });
    });

    test("after a code-block steps the caret instead of merging", () => {
        const code: Block = { id: "cb", type: "code-block", content: "let x = 1;", marks: [], metadata: { language: "" } };
        const state = caretIn([code, para("p", "hello")], "p", 0);
        const out = deleteBackward(state);
        expect(out.doc).toEqual(state.doc);
        expect(out.selection?.focus.blockId).toBe("cb");
        expect(out.selection?.focus.offset).toBe(10);
    });

    test("deletes a whole emoji, not half a surrogate pair", () => {
        const state = caretIn([para("p", "hi😀")], "p", 4);
        const out = deleteBackward(state);
        expect(out.doc[0]!.content).toBe("hi");
        expect(out.selection?.focus.offset).toBe(2);
    });
});

describe("deleteForward at block boundaries", () => {
    test("before a math-block deletes the math-block whole", () => {
        const state = caretIn([para("p", "hello"), math("m", "x^2"), para("q", "")], "p", 5);
        const out = deleteForward(state);
        expect(out.doc.map((b) => b.id)).toEqual(["p", "q"]);
        expect(out.doc[0]!.content).toBe("hello");
    });

    test("inside a math-block deletes the math-block itself", () => {
        const state = caretIn([math("m", "x^2"), para("p", "after")], "m", 0);
        const out = deleteForward(state);
        expect(out.doc.map((b) => b.id)).toEqual(["p"]);
        expect(out.doc[0]!.content).toBe("after");
        expect(out.selection?.focus).toEqual({ blockId: "p", offset: 0 });
    });

    test("before a code-block steps the caret instead of merging", () => {
        const code: Block = { id: "cb", type: "code-block", content: "x", marks: [], metadata: { language: "" } };
        const state = caretIn([para("p", "hello"), code], "p", 5);
        const out = deleteForward(state);
        expect(out.doc).toEqual(state.doc);
        expect(out.selection?.focus).toEqual({ blockId: "cb", offset: 0 });
    });

    test("deletes a whole emoji forward", () => {
        const state = caretIn([para("p", "😀hi")], "p", 0);
        const out = deleteForward(state);
        expect(out.doc[0]!.content).toBe("hi");
    });
});

function cell(id: string, tableId: string, row: number, col: number, content: string): Block {
    return {
        id,
        type: "table-cell",
        content,
        marks: [],
        metadata: {
            tableId,
            row,
            col,
            rowCount: 2,
            colCount: 2,
            alignment: [null, null],
            isHeader: row === 0,
        },
    };
}

function selecting(doc: Block[], from: { blockId: string; offset: number }, to: { blockId: string; offset: number }): DocState {
    return { doc, selection: { anchor: from, focus: to } };
}

describe("deleteSelection across special blocks", () => {
    test("from inside a math-block into a paragraph consumes the math-block, never merges into it", () => {
        const state = selecting(
            [math("m", "E=mc^2"), para("p", "hello world")],
            { blockId: "m", offset: 0 },
            { blockId: "p", offset: 5 },
        );
        const out = deleteSelection(state);
        expect(out.doc.map((b) => b.type)).toEqual(["paragraph"]);
        expect(out.doc[0]!.content).toBe(" world");
        expect(serializeDoc(out.doc)).toBe(" world");
        expect(out.selection?.focus).toEqual({ blockId: "p", offset: 0 });
    });

    test("ending at a math-block's leading edge keeps the math-block intact", () => {
        const state = selecting(
            [para("p", "hello"), math("m", "x^2")],
            { blockId: "p", offset: 2 },
            { blockId: "m", offset: 0 },
        );
        const out = deleteSelection(state);
        expect(out.doc.map((b) => b.type)).toEqual(["paragraph", "math-block"]);
        expect(out.doc[0]!.content).toBe("he");
        expect(out.doc[1]!.metadata?.latex).toBe("x^2");
        expect(out.selection?.focus).toEqual({ blockId: "p", offset: 2 });
    });

    test("an hr fully inside the range is removed and the endpoints merge", () => {
        const state = selecting(
            [para("a", "hello"), hr("h"), para("b", "world")],
            { blockId: "a", offset: 3 },
            { blockId: "b", offset: 2 },
        );
        const out = deleteSelection(state);
        expect(out.doc.map((b) => b.type)).toEqual(["paragraph"]);
        expect(out.doc[0]!.content).toBe("helrld");
    });

    test("across a code-block boundary keeps the blocks separate", () => {
        const code: Block = { id: "cb", type: "code-block", content: "let x = 1;", marks: [], metadata: { language: "" } };
        const state = selecting(
            [code, para("p", "hello")],
            { blockId: "cb", offset: 3 },
            { blockId: "p", offset: 2 },
        );
        const out = deleteSelection(state);
        expect(out.doc.map((b) => b.type)).toEqual(["code-block", "paragraph"]);
        expect(out.doc[0]!.content).toBe("let");
        expect(out.doc[1]!.content).toBe("llo");
        expect(out.selection?.focus).toEqual({ blockId: "cb", offset: 3 });
    });

    test("a partially selected table keeps its cells with the covered text cleared", () => {
        const state = selecting(
            [
                cell("c00", "t", 0, 0, "aa"),
                cell("c01", "t", 0, 1, "bb"),
                cell("c10", "t", 1, 0, "cc"),
                cell("c11", "t", 1, 1, "dd"),
                para("p", "hello"),
            ],
            { blockId: "c01", offset: 1 },
            { blockId: "p", offset: 2 },
        );
        const out = deleteSelection(state);
        expect(out.doc.map((b) => b.id)).toEqual(["c00", "c01", "c10", "c11", "p"]);
        expect(out.doc.map((b) => b.content)).toEqual(["aa", "b", "", "", "llo"]);
        expect(out.selection?.focus).toEqual({ blockId: "c01", offset: 1 });
        // The (0,0) cell survived, so the table still serializes.
        expect(serializeDoc(out.doc)).toContain("| aa | b |");
    });

    test("a fully covered table is removed as a unit", () => {
        const state = selecting(
            [
                para("a", "x"),
                cell("c00", "t", 0, 0, "aa"),
                cell("c01", "t", 0, 1, "bb"),
                cell("c10", "t", 1, 0, "cc"),
                cell("c11", "t", 1, 1, "dd"),
                para("b", "y"),
            ],
            { blockId: "a", offset: 0 },
            { blockId: "b", offset: 1 },
        );
        const out = deleteSelection(state);
        expect(out.doc.map((b) => b.type)).toEqual(["paragraph"]);
        expect(out.doc[0]!.content).toBe("");
    });
});

describe("typing at a link boundary", () => {
    function linkedPara(): Block {
        return {
            id: "p",
            type: "paragraph",
            content: "see docs here",
            marks: [
                { type: "link", start: 4, end: 8, attrs: { href: "https://example.com", linkId: "L1" } },
            ],
        };
    }

    function caretIn(block: Block, offset: number): DocState {
        return {
            doc: [block],
            selection: { anchor: { blockId: block.id, offset }, focus: { blockId: block.id, offset } },
        };
    }

    test("typing after a link does not extend it or destroy its attrs", () => {
        const out = insertText(caretIn(linkedPara(), 8), "x");
        expect(out.doc[0]!.content).toBe("see docsx here");
        expect(out.doc[0]!.marks).toEqual([
            { type: "link", start: 4, end: 8, attrs: { href: "https://example.com", linkId: "L1" } },
        ]);
        expect(serializeDoc(out.doc)).toBe("see [docs](https://example.com)x here");
    });

    test("typing inside a link extends it and keeps the href", () => {
        const out = insertText(caretIn(linkedPara(), 6), "x");
        expect(out.doc[0]!.content).toBe("see doxcs here");
        expect(out.doc[0]!.marks).toEqual([
            { type: "link", start: 4, end: 9, attrs: { href: "https://example.com", linkId: "L1" } },
        ]);
    });

    test("typing at block start before a link stays outside the link", () => {
        const block: Block = {
            id: "p",
            type: "paragraph",
            content: "docs rest",
            marks: [{ type: "link", start: 0, end: 4, attrs: { href: "https://example.com", linkId: "L1" } }],
        };
        const out = insertText(caretIn(block, 0), "x");
        expect(out.doc[0]!.content).toBe("xdocs rest");
        expect(out.doc[0]!.marks).toEqual([
            { type: "link", start: 1, end: 5, attrs: { href: "https://example.com", linkId: "L1" } },
        ]);
    });
});

describe("insertBreak on atomic blocks", () => {
    test("on a math-block creates a plain paragraph below, no duplicate formula", () => {
        const state = caretIn([math("m", "x^2"), para("p", "")], "m", 0);
        const out = insertBreak(state);
        const types = out.doc.map((b) => b.type);
        expect(types).toEqual(["math-block", "paragraph", "paragraph"]);
        expect(out.doc[0]!.metadata?.latex).toBe("x^2");
        expect(out.doc[1]!.metadata).toBeUndefined();
        expect(out.selection?.focus.blockId).toBe(out.doc[1]!.id);
    });

    test("on an hr creates a paragraph below", () => {
        const state = caretIn([hr("h"), para("p", "")], "h", 0);
        const out = insertBreak(state);
        expect(out.doc.map((b) => b.type)).toEqual(["hr", "paragraph", "paragraph"]);
    });
});
