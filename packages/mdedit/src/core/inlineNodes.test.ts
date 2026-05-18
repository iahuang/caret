import { describe, expect, test } from "bun:test";
import {
    adjustInlineNodesForDelete,
    adjustInlineNodesForInsert,
    findInlineNode,
    shiftInlineNodes,
} from "./inlineNodes";
import type { InlineNode } from "./types";

function atom(id: string, position: number, type = "math"): InlineNode {
    return { id, type, position, data: {} };
}

describe("adjustInlineNodesForInsert", () => {
    test("undefined / empty / zero-length are passed through", () => {
        expect(adjustInlineNodesForInsert(undefined, 0, 3)).toBeUndefined();
        expect(adjustInlineNodesForInsert([], 0, 3)).toEqual([]);
        const same = [atom("a", 2)];
        expect(adjustInlineNodesForInsert(same, 0, 0)).toBe(same);
    });

    test("leaves nodes strictly before the insertion alone", () => {
        expect(adjustInlineNodesForInsert([atom("a", 2)], 5, 3)).toEqual([atom("a", 2)]);
    });

    test("shifts nodes at or after the insertion point", () => {
        // A node exactly at the insertion position is pushed right — typing
        // before an atom does not displace it leftward.
        expect(adjustInlineNodesForInsert([atom("a", 5)], 5, 2)).toEqual([atom("a", 7)]);
        expect(adjustInlineNodesForInsert([atom("a", 8)], 5, 2)).toEqual([atom("a", 10)]);
    });

    test("preserves id, type, and data", () => {
        const n: InlineNode = { id: "x", type: "image", position: 4, data: { src: "y.png" } };
        const [out] = adjustInlineNodesForInsert([n], 0, 2)!;
        expect(out).toEqual({ id: "x", type: "image", position: 6, data: { src: "y.png" } });
    });
});

describe("adjustInlineNodesForDelete", () => {
    test("undefined / empty / zero-length are passed through", () => {
        expect(adjustInlineNodesForDelete(undefined, 0, 3)).toBeUndefined();
        const same = [atom("a", 2)];
        expect(adjustInlineNodesForDelete(same, 3, 3)).toBe(same);
    });

    test("leaves nodes strictly before the deletion alone", () => {
        expect(adjustInlineNodesForDelete([atom("a", 2)], 5, 8)).toEqual([atom("a", 2)]);
    });

    test("shifts nodes at or after the deletion left by len", () => {
        // The half-open delete range [from, to) — a node at `to` survives.
        expect(adjustInlineNodesForDelete([atom("a", 8)], 2, 5)).toEqual([atom("a", 5)]);
        expect(adjustInlineNodesForDelete([atom("a", 5)], 2, 5)).toEqual([atom("a", 2)]);
    });

    test("drops nodes whose position falls in [from, to)", () => {
        // Node at position === from is inside the deletion → removed.
        expect(adjustInlineNodesForDelete([atom("a", 4)], 4, 7)).toBeUndefined();
        expect(adjustInlineNodesForDelete([atom("a", 6)], 4, 7)).toBeUndefined();
    });

    test("returns undefined when all nodes are dropped", () => {
        expect(adjustInlineNodesForDelete([atom("a", 4), atom("b", 5)], 3, 8)).toBeUndefined();
    });

    test("processes multiple nodes independently", () => {
        const nodes = [atom("a", 2), atom("b", 6), atom("c", 10)];
        expect(adjustInlineNodesForDelete(nodes, 4, 8)).toEqual([atom("a", 2), atom("c", 6)]);
    });
});

describe("shiftInlineNodes", () => {
    test("undefined / empty are passed through", () => {
        expect(shiftInlineNodes(undefined, 3)).toBeUndefined();
        expect(shiftInlineNodes([], 3)).toEqual([]);
    });

    test("adds delta to every node", () => {
        expect(shiftInlineNodes([atom("a", 2), atom("b", 5)], 3)).toEqual([
            atom("a", 5),
            atom("b", 8),
        ]);
    });

    test("supports negative delta", () => {
        expect(shiftInlineNodes([atom("a", 5)], -2)).toEqual([atom("a", 3)]);
    });
});

describe("findInlineNode", () => {
    test("returns the node by id", () => {
        const a = atom("a", 1);
        const b = atom("b", 2);
        expect(findInlineNode([a, b], "b")).toBe(b);
    });

    test("returns undefined when not found or list is missing", () => {
        expect(findInlineNode([atom("a", 1)], "z")).toBeUndefined();
        expect(findInlineNode(undefined, "a")).toBeUndefined();
    });
});
