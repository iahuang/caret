/**
 * Lightweight LaTeX-math tokenizer.
 *
 * Pure function — no DOM, no React. Walks the source once and emits a flat
 * stream of tokens that covers every character with no gaps. The token
 * stream is just enough for syntax highlighting; it doesn't try to model
 * matched braces, KaTeX function arities, or anything semantic. Future
 * features (completion, brace-match, error squigglies) plug on top by
 * indexing the same stream.
 */

export type MathTokenKind =
    | "command"
    | "brace"
    | "bracket"
    | "paren"
    | "subscript"
    | "superscript"
    | "number"
    | "operator"
    | "comment"
    | "text";

export interface MathToken {
    kind: MathTokenKind;
    value: string;
    start: number;
    end: number;
}

const ALPHA = /[a-zA-Z]/;
const DIGIT_OR_DOT = /[\d.]/;

export function tokenizeMath(src: string): MathToken[] {
    const tokens: MathToken[] = [];
    let i = 0;
    let textStart = -1;

    function flushText(end: number) {
        if (textStart < 0) return;
        tokens.push({ kind: "text", value: src.slice(textStart, end), start: textStart, end });
        textStart = -1;
    }

    while (i < src.length) {
        const c = src[i]!;

        if (c === "%") {
            flushText(i);
            const nl = src.indexOf("\n", i);
            const end = nl < 0 ? src.length : nl;
            tokens.push({ kind: "comment", value: src.slice(i, end), start: i, end });
            i = end;
            continue;
        }

        if (c === "\\") {
            flushText(i);
            let j = i + 1;
            if (j < src.length && ALPHA.test(src[j]!)) {
                while (j < src.length && ALPHA.test(src[j]!)) j++;
            } else if (j < src.length) {
                // Escape sequences like \\, \{, \}, \$, \%, \,, \;
                j++;
            }
            tokens.push({ kind: "command", value: src.slice(i, j), start: i, end: j });
            i = j;
            continue;
        }

        const single = singleCharKind(c);
        if (single) {
            flushText(i);
            tokens.push({ kind: single, value: c, start: i, end: i + 1 });
            i++;
            continue;
        }

        if (c >= "0" && c <= "9") {
            flushText(i);
            let j = i + 1;
            while (j < src.length && DIGIT_OR_DOT.test(src[j]!)) j++;
            tokens.push({ kind: "number", value: src.slice(i, j), start: i, end: j });
            i = j;
            continue;
        }

        if (textStart < 0) textStart = i;
        i++;
    }
    flushText(i);
    return tokens;
}

function singleCharKind(c: string): MathTokenKind | null {
    switch (c) {
        case "{":
        case "}":
            return "brace";
        case "[":
        case "]":
            return "bracket";
        case "(":
        case ")":
            return "paren";
        case "_":
            return "subscript";
        case "^":
            return "superscript";
        case "+":
        case "-":
        case "=":
        case "<":
        case ">":
        case "*":
        case "/":
        case "|":
        case "&":
            return "operator";
        default:
            return null;
    }
}
