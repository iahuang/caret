import { describe, expect, test } from "bun:test";
import { nextCharOffset, prevCharOffset } from "./charBoundary";

describe("prevCharOffset / nextCharOffset", () => {
    test("steps single code units for BMP text", () => {
        expect(prevCharOffset("abc", 2)).toBe(1);
        expect(nextCharOffset("abc", 1)).toBe(2);
    });

    test("clamps at the edges", () => {
        expect(prevCharOffset("abc", 0)).toBe(0);
        expect(nextCharOffset("abc", 3)).toBe(3);
        expect(prevCharOffset("abc", 99)).toBe(2);
        expect(nextCharOffset("abc", -1)).toBe(1);
    });

    test("steps over a whole surrogate pair", () => {
        const s = "a😀b"; // 😀 occupies offsets 1..3
        expect(prevCharOffset(s, 3)).toBe(1);
        expect(nextCharOffset(s, 1)).toBe(3);
    });

    test("steps over a ZWJ emoji sequence as one unit", () => {
        const family = "👨‍👩‍👧"; // multiple code points joined by ZWJ
        const s = `x${family}y`;
        expect(nextCharOffset(s, 1)).toBe(1 + family.length);
        expect(prevCharOffset(s, 1 + family.length)).toBe(1);
    });

    test("keeps combining marks attached to their base", () => {
        const s = "éx"; // e + combining acute
        expect(nextCharOffset(s, 0)).toBe(2);
        expect(prevCharOffset(s, 2)).toBe(0);
    });
});
