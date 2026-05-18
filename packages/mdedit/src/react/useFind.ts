/**
 * Find/replace state for an editor store.
 *
 * Subscribes to the store, recomputes matches whenever the doc or query
 * changes, and exposes navigation + replace handlers. The active match is
 * tracked locally; `replaceCurrent` consumes the current match and the next
 * one slides in at the same index (since matches are recomputed against the
 * new doc), giving you free replace-and-advance.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
    findInDoc,
    replaceAllMatches,
    replaceMatch,
    type FindOptions,
} from "../core/find";
import type { Store } from "../core/store";
import type { Match } from "../core/types";

export interface UseFindOptions {
    store: Store;
    query: string;
    options?: FindOptions;
    /** When false (e.g. bar is closed) the hook returns no matches. */
    enabled?: boolean;
}

export interface UseFindResult {
    matches: Match[];
    activeIndex: number;
    setActiveIndex: (i: number) => void;
    next: () => void;
    prev: () => void;
    /** Replace the current match. No-op if there are no matches. */
    replaceCurrent: (text: string) => void;
    /** Replace every match in a single undo step. */
    replaceAll: (text: string) => void;
}

export function useFind({
    store,
    query,
    options,
    enabled = true,
}: UseFindOptions): UseFindResult {
    const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
    const state = useSyncExternalStore(subscribe, store.getState, store.getState);

    const caseSensitive = options?.caseSensitive ?? false;
    const wholeWord = options?.wholeWord ?? false;
    const regex = options?.regex ?? false;

    const matches = useMemo<Match[]>(() => {
        if (!enabled) return [];
        return findInDoc(state.doc, query, { caseSensitive, wholeWord, regex });
    }, [enabled, state.doc, query, caseSensitive, wholeWord, regex]);

    const [activeIndex, setActiveIndex] = useState(0);

    // Reset the cursor to the first match whenever the search itself changes
    // (new query or new option). Doc edits don't reset — the user is iterating
    // through results, not running a new search.
    useEffect(() => {
        setActiveIndex(0);
    }, [query, caseSensitive, wholeWord, regex, enabled]);

    // Clamp when the match list shrinks (typically after a replace).
    useEffect(() => {
        if (matches.length === 0) return;
        if (activeIndex >= matches.length) setActiveIndex(0);
    }, [matches.length, activeIndex]);

    const next = useCallback(() => {
        setActiveIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
    }, [matches.length]);

    const prev = useCallback(() => {
        setActiveIndex((i) =>
            matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length,
        );
    }, [matches.length]);

    const replaceCurrent = useCallback(
        (text: string) => {
            if (matches.length === 0) return;
            const m = matches[activeIndex];
            if (!m) return;
            store.setState((s) =>
                replaceMatch(s, m, text, query, { caseSensitive, wholeWord, regex }),
            );
        },
        [store, matches, activeIndex, query, caseSensitive, wholeWord, regex],
    );

    const replaceAll = useCallback(
        (text: string) => {
            if (matches.length === 0) return;
            const captured = matches;
            store.setState((s) => replaceAllMatches(s, captured, text));
        },
        [store, matches],
    );

    return { matches, activeIndex, setActiveIndex, next, prev, replaceCurrent, replaceAll };
}
