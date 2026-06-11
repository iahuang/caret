import { describe, expect, test } from "bun:test";
import {
    adjustMarksForDelete,
    adjustMarksForInsert,
    hasMarkInRange,
    shiftMarks,
    toggleMark,
} from "./marks";
import type { Mark } from "./types";

function bold(start: number, end: number): Mark {
    return { type: "bold", start, end };
}

function italic(start: number, end: number): Mark {
    return { type: "italic", start, end };
}

describe("adjustMarksForInsert", () => {
    test("returns marks unchanged when length is 0", () => {
        const marks = [bold(2, 5)];
        expect(adjustMarksForInsert(marks, 3, 0)).toBe(marks);
    });

    test("leaves marks ending at or before the insertion point alone", () => {
        // Right-edge of a mark does not extend on insertion. A bold [0,3)
        // followed by a typed char at offset 3 stays [0,3) — the new char
        // is not absorbed into the mark.
        expect(adjustMarksForInsert([bold(0, 3)], 3, 2)).toEqual([bold(0, 3)]);
        expect(adjustMarksForInsert([bold(0, 3)], 5, 2)).toEqual([bold(0, 3)]);
    });

    test("shifts marks starting at or after the insertion point", () => {
        // At the left edge, the mark moves with its content — typing before
        // the mark does not inherit the mark.
        expect(adjustMarksForInsert([bold(3, 6)], 3, 2)).toEqual([bold(5, 8)]);
        expect(adjustMarksForInsert([bold(5, 8)], 2, 3)).toEqual([bold(8, 11)]);
    });

    test("extends the end of a mark when insertion lands strictly inside", () => {
        expect(adjustMarksForInsert([bold(2, 8)], 5, 3)).toEqual([bold(2, 11)]);
    });

    test("preserves attrs and type", () => {
        const link: Mark = { type: "link", start: 1, end: 4, attrs: { href: "x" } };
        const [out] = adjustMarksForInsert([link], 0, 2);
        expect(out).toEqual({ type: "link", start: 3, end: 6, attrs: { href: "x" } });
    });
});

describe("adjustMarksForDelete", () => {
    test("no-op for empty deletion range", () => {
        const marks = [bold(0, 5)];
        expect(adjustMarksForDelete(marks, 3, 3)).toBe(marks);
    });

    test("leaves marks fully before the deletion alone", () => {
        expect(adjustMarksForDelete([bold(0, 3)], 5, 8)).toEqual([bold(0, 3)]);
    });

    test("shifts marks fully after the deletion left by len", () => {
        expect(adjustMarksForDelete([bold(8, 12)], 2, 5)).toEqual([bold(5, 9)]);
    });

    test("trims a mark whose right portion is deleted", () => {
        expect(adjustMarksForDelete([bold(0, 8)], 5, 10)).toEqual([bold(0, 5)]);
    });

    test("shifts and trims a mark whose left portion is deleted", () => {
        expect(adjustMarksForDelete([bold(2, 10)], 0, 5)).toEqual([bold(0, 5)]);
    });

    test("shrinks a mark that fully contains the deletion", () => {
        expect(adjustMarksForDelete([bold(0, 10)], 3, 6)).toEqual([bold(0, 7)]);
    });

    test("drops marks fully inside the deletion", () => {
        expect(adjustMarksForDelete([bold(3, 6)], 2, 8)).toEqual([]);
    });

    test("drops marks exactly matching the deletion", () => {
        expect(adjustMarksForDelete([bold(2, 5)], 2, 5)).toEqual([]);
    });

    test("processes multiple marks independently", () => {
        const marks = [bold(0, 3), italic(5, 9), bold(11, 14)];
        expect(adjustMarksForDelete(marks, 6, 10)).toEqual([
            bold(0, 3),
            italic(5, 6),
            bold(7, 10),
        ]);
    });
});

describe("shiftMarks", () => {
    test("adds delta to every mark", () => {
        expect(shiftMarks([bold(0, 3), italic(5, 7)], 4)).toEqual([bold(4, 7), italic(9, 11)]);
    });

    test("supports negative delta", () => {
        expect(shiftMarks([bold(5, 8)], -2)).toEqual([bold(3, 6)]);
    });
});

describe("hasMarkInRange", () => {
    test("collapsed query: true when mark covers the offset (left-side bias)", () => {
        // Cursor at offset 5 with bold [0,5) inherits the mark — load-bearing
        // for stored-marks / cursor styling.
        expect(hasMarkInRange([bold(0, 5)], "bold", 5, 5)).toBe(true);
        expect(hasMarkInRange([bold(0, 5)], "bold", 0, 0)).toBe(true);
        expect(hasMarkInRange([bold(0, 5)], "bold", 3, 3)).toBe(true);
    });

    test("collapsed query: false when no mark of that type covers it", () => {
        expect(hasMarkInRange([bold(0, 5)], "italic", 3, 3)).toBe(false);
        expect(hasMarkInRange([bold(0, 5)], "bold", 6, 6)).toBe(false);
    });

    test("range query: true only when the range is fully covered", () => {
        expect(hasMarkInRange([bold(0, 10)], "bold", 2, 8)).toBe(true);
        expect(hasMarkInRange([bold(0, 5)], "bold", 2, 8)).toBe(false);
    });

    test("range query: contiguous marks combine to cover the range", () => {
        expect(hasMarkInRange([bold(0, 4), bold(4, 9)], "bold", 1, 8)).toBe(true);
    });

    test("range query: a gap breaks coverage", () => {
        expect(hasMarkInRange([bold(0, 4), bold(5, 9)], "bold", 1, 8)).toBe(false);
    });

    test("ignores marks of other types", () => {
        expect(hasMarkInRange([italic(0, 10)], "bold", 2, 5)).toBe(false);
    });
});

describe("toggleMark", () => {
    test("no-op on empty range", () => {
        const marks = [bold(0, 3)];
        expect(toggleMark(marks, "bold", 4, 4)).toBe(marks);
    });

    test("adds a mark on an unmarked range", () => {
        expect(toggleMark([], "bold", 2, 5)).toEqual([bold(2, 5)]);
    });

    test("absorbs adjacent same-type marks when adding", () => {
        // Toggling bold over [3,6) when bold already covers [0,3) merges them.
        expect(toggleMark([bold(0, 3)], "bold", 3, 6)).toEqual([bold(0, 6)]);
    });

    test("absorbs overlapping same-type marks when adding", () => {
        expect(toggleMark([bold(0, 4), bold(7, 10)], "bold", 3, 8)).toEqual([bold(0, 10)]);
    });

    test("removes the mark when the range is fully covered", () => {
        expect(toggleMark([bold(0, 10)], "bold", 0, 10)).toEqual([]);
    });

    test("splits a mark when removing an interior range", () => {
        expect(toggleMark([bold(0, 10)], "bold", 3, 7)).toEqual([bold(0, 3), bold(7, 10)]);
    });

    test("trims a mark when removing from its left edge", () => {
        expect(toggleMark([bold(0, 10)], "bold", 0, 4)).toEqual([bold(4, 10)]);
    });

    test("trims a mark when removing from its right edge", () => {
        expect(toggleMark([bold(0, 10)], "bold", 6, 10)).toEqual([bold(0, 6)]);
    });

    test("partial coverage adds-and-absorbs rather than removing", () => {
        // Range [3,7) is only partly bold (via [0,5)) — toggling extends bold.
        // Mirrors "select mixed text, press Cmd-B, everything becomes bold".
        expect(toggleMark([bold(0, 5)], "bold", 3, 7)).toEqual([bold(0, 7)]);
    });

    test("leaves marks of other types alone", () => {
        expect(toggleMark([italic(0, 10)], "bold", 2, 5)).toEqual([italic(0, 10), bold(2, 5)]);
    });

    test("preserves attrs when absorbing an attr-bearing mark", () => {
        const link: Mark = {
            type: "link",
            start: 0,
            end: 4,
            attrs: { href: "https://example.com", linkId: "L1" },
        };
        expect(toggleMark([link], "link", 4, 6)).toEqual([
            { ...link, end: 6 },
        ]);
    });
});
