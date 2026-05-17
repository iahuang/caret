/**
 * Ranking for the math-command autocomplete.
 *
 * Two tiers:
 *   1. Prefix matches — the query is a prefix of the command name (with the
 *      leading backslash stripped). Sorted by command length ascending so
 *      the most specific (shortest containing the prefix) wins.
 *   2. Subsequence matches — the query's characters appear in the command
 *      name in order, not necessarily contiguous. Scored by clustering:
 *      smaller gaps and shorter trailing tails rank higher.
 *
 * Within each tier, ties break alphabetically.
 *
 * Comparison is case-insensitive so "FR" matches "\frac" the same as "fr".
 * Uppercase Greek (e.g. \Gamma) still resolves correctly because the case
 * insensitivity applies only to ranking, not to the returned strings.
 */

export interface RankedSuggestion {
    cmd: string;
    /** Tier: 0 = prefix, 1 = subsequence. */
    tier: 0 | 1;
}

export function rankCommandMatches(
    query: string,
    commands: readonly string[],
): RankedSuggestion[] {
    const q = query.toLowerCase();
    if (q === "") {
        return [...commands]
            .sort((a, b) => stripSlash(a).localeCompare(stripSlash(b)))
            .map((cmd) => ({ cmd, tier: 0 as const }));
    }
    const prefix: Array<{ cmd: string; score: number }> = [];
    const subseq: Array<{ cmd: string; score: number }> = [];
    for (const cmd of commands) {
        const name = stripSlash(cmd).toLowerCase();
        if (name.startsWith(q)) {
            prefix.push({ cmd, score: name.length });
            continue;
        }
        const score = subsequenceScore(q, name);
        if (score !== null) subseq.push({ cmd, score });
    }
    prefix.sort((a, b) => a.score - b.score || a.cmd.localeCompare(b.cmd));
    subseq.sort((a, b) => a.score - b.score || a.cmd.localeCompare(b.cmd));
    return [
        ...prefix.map((x) => ({ cmd: x.cmd, tier: 0 as const })),
        ...subseq.map((x) => ({ cmd: x.cmd, tier: 1 as const })),
    ];
}

function stripSlash(cmd: string): string {
    return cmd.startsWith("\\") ? cmd.slice(1) : cmd;
}

function subsequenceScore(needle: string, haystack: string): number | null {
    // Walk the haystack, consuming needle characters in order. Accumulate
    // gap penalties (chars skipped between consecutive matches) and a final
    // tail penalty (haystack chars after the last match). Lower is better.
    let needleIdx = 0;
    let lastPos = -1;
    let score = 0;
    for (let j = 0; j < haystack.length; j++) {
        if (needleIdx < needle.length && haystack[j] === needle[needleIdx]) {
            score += j - lastPos - 1;
            lastPos = j;
            needleIdx++;
            if (needleIdx === needle.length) {
                score += haystack.length - j - 1;
                return score;
            }
        }
    }
    return null;
}
