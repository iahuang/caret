/**
 * Minimal observable store with history.
 *
 * Designed for `useSyncExternalStore` — `subscribe(fn)` returns an unsubscribe
 * function, and `getState()` is synchronous and stable between commits.
 *
 * Updates that pass `{ history: false }` skip the history stack, used for
 * selection-only changes (mouse drag, arrow keys) so each keystroke doesn't
 * become its own undo step.
 */

import type { DocState } from "./types";

export interface StoreOptions {
    initialState: DocState;
    historyLimit?: number;
    /** Time window (ms) within which consecutive history-eligible updates collapse into one. */
    historyDebounceMs?: number;
}

export interface SetStateOptions {
    history?: boolean;
}

export interface Store {
    getState(): DocState;
    setState(updater: (state: DocState) => DocState, opts?: SetStateOptions): void;
    subscribe(fn: () => void): () => void;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
}

export function createStore(options: StoreOptions): Store {
    let state = options.initialState;
    const listeners = new Set<() => void>();
    const historyLimit = options.historyLimit ?? 100;
    const debounce = options.historyDebounceMs ?? 400;
    const past: DocState[] = [];
    const future: DocState[] = [];
    let lastHistoryAt = 0;

    function emit() {
        for (const fn of listeners) fn();
    }

    function pushHistory(prev: DocState) {
        const now = Date.now();
        const recent = now - lastHistoryAt < debounce;
        lastHistoryAt = now;
        if (!recent) {
            past.push(prev);
            if (past.length > historyLimit) past.shift();
        }
        future.length = 0;
    }

    return {
        getState: () => state,
        setState(updater, opts) {
            const next = updater(state);
            if (next === state) return;
            if (opts?.history !== false) pushHistory(state);
            state = next;
            emit();
        },
        subscribe(fn) {
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
            };
        },
        undo() {
            const prev = past.pop();
            if (!prev) return;
            future.push(state);
            state = prev;
            lastHistoryAt = 0;
            emit();
        },
        redo() {
            const nxt = future.pop();
            if (!nxt) return;
            past.push(state);
            state = nxt;
            lastHistoryAt = 0;
            emit();
        },
        canUndo: () => past.length > 0,
        canRedo: () => future.length > 0,
    };
}
