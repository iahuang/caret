/**
 * Grapheme-aware character stepping for caret movement and single-character
 * deletes. Model offsets are UTF-16 code units, so a naive `offset ± 1` can
 * land inside a surrogate pair — deleting half an emoji leaves an invalid
 * lone surrogate in the doc. `Intl.Segmenter` steps over full grapheme
 * clusters (ZWJ emoji sequences, flags, combining marks); the fallback only
 * pairs surrogates, which is enough to keep the string valid where the
 * segmenter is unavailable.
 */

const segmenter: Intl.Segmenter | null =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

/** Offset of the start of the character (grapheme) ending at `offset`. */
export function prevCharOffset(content: string, offset: number): number {
    const at = Math.min(Math.max(offset, 0), content.length);
    if (at <= 0) return 0;
    if (segmenter) {
        const seg = segmenter.segment(content).containing(at - 1);
        if (seg) return seg.index;
    }
    if (
        at >= 2 &&
        isLowSurrogate(content.charCodeAt(at - 1)) &&
        isHighSurrogate(content.charCodeAt(at - 2))
    ) {
        return at - 2;
    }
    return at - 1;
}

/** Offset of the end of the character (grapheme) starting at `offset`. */
export function nextCharOffset(content: string, offset: number): number {
    const at = Math.min(Math.max(offset, 0), content.length);
    if (at >= content.length) return content.length;
    if (segmenter) {
        const seg = segmenter.segment(content).containing(at);
        if (seg) return seg.index + seg.segment.length;
    }
    if (
        at + 2 <= content.length &&
        isHighSurrogate(content.charCodeAt(at)) &&
        isLowSurrogate(content.charCodeAt(at + 1))
    ) {
        return at + 2;
    }
    return at + 1;
}
