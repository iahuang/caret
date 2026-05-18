/**
 * Find / replace over a Doc.
 *
 * Matches are single-block: a single `Match` never crosses a block boundary,
 * since paragraph-spanning matches almost never reflect user intent. The search
 * runs against `block.content` verbatim, which means atom placeholders
 * (`INLINE_NODE_PLACEHOLDER`) sit in the searched string as `￼`. Users
 * never type that codepoint, so it only matters when a regex query happens to
 * span one — in that case we drop the match. Replacing across an atom would
 * silently delete the atom, which is rarely what the user wants.
 *
 * Opaque blocks (math-block, hr) are skipped entirely: their visible content
 * lives in `metadata`, not in `content`.
 */

import type { Block, Doc, DocState, Match } from "./types";
import { INLINE_NODE_PLACEHOLDER } from "./types";
import { replaceTextRange } from "./commands";

export interface FindOptions {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
}

function isSearchable(block: Block): boolean {
    if (block.type === "math-block" || block.type === "hr") return false;
    if (block.content.length === 0) return false;
    return true;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a query + options into a `g`-flagged RegExp. Returns null for an
 * empty query or an invalid user-supplied regex.
 */
export function compileFindRegex(query: string, opts: FindOptions = {}): RegExp | null {
    if (query.length === 0) return null;
    let pattern = opts.regex ? query : escapeRegex(query);
    if (opts.wholeWord) pattern = `(?:^|\\b)(?:${pattern})(?:\\b|$)`;
    const flags = opts.caseSensitive ? "g" : "gi";
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

function rangeContainsPlaceholder(content: string, start: number, end: number): boolean {
    const at = content.indexOf(INLINE_NODE_PLACEHOLDER, start);
    return at !== -1 && at < end;
}

export function findInDoc(doc: Doc, query: string, opts: FindOptions = {}): Match[] {
    const re = compileFindRegex(query, opts);
    if (!re) return [];
    const out: Match[] = [];
    for (const block of doc) {
        if (!isSearchable(block)) continue;
        re.lastIndex = 0;
        let safety = 0;
        for (;;) {
            const m = re.exec(block.content);
            if (!m) break;
            // Zero-length matches (e.g. user-supplied regex like `a*`) can pin
            // lastIndex if we don't nudge forward. Advance manually and skip.
            if (m[0].length === 0) {
                re.lastIndex += 1;
                if (++safety > block.content.length + 1) break;
                continue;
            }
            const start = m.index;
            const end = start + m[0].length;
            if (!rangeContainsPlaceholder(block.content, start, end)) {
                out.push({ blockId: block.id, start, end });
            }
            if (++safety > block.content.length + 1) break;
        }
    }
    return out;
}

/**
 * Apply `text` to a single match. Wrapper around `replaceTextRange` that adds
 * a defensive check: the caller may hold a stale match list (doc edited
 * between search and replace). Bail if the recorded range no longer matches
 * the query — better a no-op than corrupting an unrelated range.
 */
export function replaceMatch(
    state: DocState,
    match: Match,
    text: string,
    query: string,
    opts: FindOptions = {},
): DocState {
    const block = state.doc.find((b) => b.id === match.blockId);
    if (!block) return state;
    if (match.end > block.content.length || match.start < 0) return state;
    const re = compileFindRegex(query, opts);
    if (!re) return state;
    re.lastIndex = match.start;
    const m = re.exec(block.content);
    if (!m || m.index !== match.start || m[0].length !== match.end - match.start) return state;
    return replaceTextRange(state, match.blockId, match.start, match.end, text);
}

/**
 * Apply `text` to every match in a single store update so it's one undo step.
 * Replaces from the bottom up so earlier-block, earlier-offset matches stay
 * positionally valid as later matches mutate the doc.
 */
export function replaceAllMatches(
    state: DocState,
    matches: Match[],
    text: string,
): DocState {
    if (matches.length === 0) return state;
    // Sort descending by (block index, start). Block index lookup is O(N) per
    // match in the worst case; pre-build a position map.
    const blockOrder = new Map<string, number>();
    state.doc.forEach((b, i) => blockOrder.set(b.id, i));
    const sorted = matches.slice().sort((a, b) => {
        const ai = blockOrder.get(a.blockId) ?? -1;
        const bi = blockOrder.get(b.blockId) ?? -1;
        if (ai !== bi) return bi - ai;
        return b.start - a.start;
    });
    let next = state;
    for (const m of sorted) {
        next = replaceTextRange(next, m.blockId, m.start, m.end, text);
    }
    return next;
}
