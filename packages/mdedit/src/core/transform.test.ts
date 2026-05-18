import { describe, expect, test } from "bun:test";
import {
    deleteRangeInBlock,
    findBlockIndex,
    insertTextInBlock,
    mergeBlocks,
    replaceBlock,
    replaceRange,
    splitBlock,
} from "./transform";
import type { Block, InlineNode, Mark } from "./types";

function block(id: string, content: string, marks: Mark[] = [], inlineNodes?: InlineNode[]): Block {
    return { id, type: "paragraph", content, marks, inlineNodes };
}

function bold(start: number, end: number): Mark {
    return { type: "bold", start, end };
}

function atom(id: string, position: number): InlineNode {
    return { id, type: "math", position, data: {} };
}

describe("findBlockIndex", () => {
    test("returns the index of the matching block", () => {
        const doc = [block("a", ""), block("b", ""), block("c", "")];
        expect(findBlockIndex(doc, "b")).toBe(1);
    });

    test("returns -1 when the block is missing", () => {
        expect(findBlockIndex([block("a", "")], "z")).toBe(-1);
    });
});

describe("insertTextInBlock", () => {
    test("returns the same block for empty insertion", () => {
        const b = block("x", "hello");
        expect(insertTextInBlock(b, 2, "")).toBe(b);
    });

    test("inserts text and threads marks", () => {
        const b = block("x", "hello", [bold(0, 5)]);
        const out = insertTextInBlock(b, 5, " world");
        expect(out.content).toBe("hello world");
        // Right-edge of bold does not extend — same behavior as adjustMarksForInsert.
        expect(out.marks).toEqual([bold(0, 5)]);
    });

    test("extends a mark when the insertion lands strictly inside it", () => {
        const b = block("x", "abcdef", [bold(0, 6)]);
        const out = insertTextInBlock(b, 3, "XY");
        expect(out.content).toBe("abcXYdef");
        expect(out.marks).toEqual([bold(0, 8)]);
    });

    test("threads inline nodes", () => {
        const b = block("x", "a￼b", [], [atom("n", 1)]);
        const out = insertTextInBlock(b, 0, "ZZ");
        expect(out.content).toBe("ZZa￼b");
        expect(out.inlineNodes).toEqual([atom("n", 3)]);
    });
});

describe("deleteRangeInBlock", () => {
    test("returns the same block for an empty range", () => {
        const b = block("x", "hello");
        expect(deleteRangeInBlock(b, 2, 2)).toBe(b);
    });

    test("deletes text and trims marks", () => {
        const b = block("x", "hello world", [bold(0, 5)]);
        const out = deleteRangeInBlock(b, 3, 8);
        expect(out.content).toBe("helrld");
        expect(out.marks).toEqual([bold(0, 3)]);
    });

    test("drops inline nodes that fall inside the deleted range", () => {
        const b = block("x", "a￼b￼c", [], [atom("n1", 1), atom("n2", 3)]);
        const out = deleteRangeInBlock(b, 1, 4);
        expect(out.content).toBe("ac");
        expect(out.inlineNodes).toBeUndefined();
    });
});

describe("splitBlock", () => {
    test("partitions content, marks, and inline nodes around the split", () => {
        const b = block(
            "x",
            "abcdefg",
            [bold(0, 3), bold(5, 7)],
            [atom("a", 1), atom("b", 5)],
        );
        const [first, second] = splitBlock(b, 4);
        expect(first.content).toBe("abcd");
        expect(first.marks).toEqual([bold(0, 3)]);
        expect(first.inlineNodes).toEqual([atom("a", 1)]);
        expect(second.content).toBe("efg");
        expect(second.marks).toEqual([bold(1, 3)]);
        expect(second.inlineNodes).toEqual([atom("b", 1)]);
    });

    test("first block keeps its id; second block gets a fresh id", () => {
        const [first, second] = splitBlock(block("x", "abc"), 1);
        expect(first.id).toBe("x");
        expect(second.id).not.toBe("x");
        expect(second.id.length).toBeGreaterThan(0);
    });

    test("copies metadata to the second block when type is unchanged", () => {
        const b: Block = { ...block("x", "abc"), metadata: { indent: 2 } };
        const [, second] = splitBlock(b, 1);
        expect(second.type).toBe("paragraph");
        expect(second.metadata).toEqual({ indent: 2 });
        // It's a copy, not the same reference.
        expect(second.metadata).not.toBe(b.metadata);
    });

    test("drops metadata when changing block type", () => {
        const b: Block = { ...block("x", "abc"), metadata: { indent: 2 } };
        const [, second] = splitBlock(b, 1, "heading");
        expect(second.type).toBe("heading");
        expect(second.metadata).toBeUndefined();
    });

    test("split at offset 0 leaves the first half empty, second carries everything", () => {
        const b = block("x", "abc", [bold(0, 3)], [atom("a", 0)]);
        const [first, second] = splitBlock(b, 0);
        expect(first.content).toBe("");
        expect(first.marks).toEqual([]);
        expect(first.inlineNodes).toBeUndefined();
        expect(second.content).toBe("abc");
        expect(second.marks).toEqual([bold(0, 3)]);
        expect(second.inlineNodes).toEqual([atom("a", 0)]);
    });

    test("split at end leaves the second half empty", () => {
        const b = block("x", "abc", [bold(0, 3)]);
        const [first, second] = splitBlock(b, 3);
        expect(first.content).toBe("abc");
        expect(first.marks).toEqual([bold(0, 3)]);
        expect(second.content).toBe("");
        expect(second.marks).toEqual([]);
        expect(second.inlineNodes).toBeUndefined();
    });
});

describe("mergeBlocks", () => {
    test("concatenates content and shifts the second block's marks", () => {
        const a = block("a", "hello", [bold(0, 5)]);
        const b = block("b", " world", [bold(1, 6)]);
        const out = mergeBlocks(a, b);
        expect(out.id).toBe("a");
        expect(out.content).toBe("hello world");
        expect(out.marks).toEqual([bold(0, 5), bold(6, 11)]);
    });

    test("shifts the second block's inline nodes by the first's content length", () => {
        const a = block("a", "abc", [], [atom("n1", 1)]);
        const b = block("b", "de", [], [atom("n2", 0)]);
        const out = mergeBlocks(a, b);
        expect(out.content).toBe("abcde");
        expect(out.inlineNodes).toEqual([atom("n1", 1), atom("n2", 3)]);
    });

    test("leaves inlineNodes undefined when neither side has atoms", () => {
        const out = mergeBlocks(block("a", "ab"), block("b", "cd"));
        expect(out.inlineNodes).toBeUndefined();
    });
});

describe("replaceBlock / replaceRange", () => {
    test("replaceBlock swaps a single block by index", () => {
        const doc = [block("a", "1"), block("b", "2"), block("c", "3")];
        const out = replaceBlock(doc, 1, block("B", "two"));
        expect(out.map((b) => b.id)).toEqual(["a", "B", "c"]);
        expect(out).not.toBe(doc);
    });

    test("replaceRange splices a range with replacement blocks", () => {
        const doc = [block("a", ""), block("b", ""), block("c", ""), block("d", "")];
        const out = replaceRange(doc, 1, 3, [block("X", ""), block("Y", "")]);
        expect(out.map((b) => b.id)).toEqual(["a", "X", "Y", "d"]);
    });

    test("replaceRange can insert (empty range) or remove (empty replacement)", () => {
        const doc = [block("a", ""), block("b", "")];
        expect(replaceRange(doc, 1, 1, [block("X", "")]).map((b) => b.id)).toEqual(["a", "X", "b"]);
        expect(replaceRange(doc, 0, 1, []).map((b) => b.id)).toEqual(["b"]);
    });
});
