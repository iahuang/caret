/**
 * Composable keymap.
 *
 * A KeyBinding pairs a predicate with a handler. The first binding whose
 * predicate accepts the event runs; if its handler returns true, the event
 * is consumed.
 */

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Store } from "../core/store";
import type { DomMapping } from "./useDomMapping";
import type { EditorActions } from "./editorContext";

export interface KeyContext {
    event: KeyboardEvent;
    store: Store;
    mapping: DomMapping;
    actions: EditorActions;
}

export interface KeyBinding {
    match: (event: KeyboardEvent) => boolean;
    run: (ctx: KeyContext) => boolean;
}

export function useKeymap({
    store,
    mapping,
    keymap,
    actions,
    readOnly = false,
}: {
    store: Store;
    mapping: DomMapping;
    keymap: KeyBinding[];
    actions: EditorActions;
    readOnly?: boolean;
}): (e: ReactKeyboardEvent) => void {
    return useCallback(
        (e: ReactKeyboardEvent) => {
            if (readOnly) return;
            const native = e.nativeEvent as KeyboardEvent;
            for (const binding of keymap) {
                if (
                    binding.match(native) &&
                    binding.run({ event: native, store, mapping, actions })
                ) {
                    e.preventDefault();
                    return;
                }
            }
        },
        [store, mapping, keymap, actions, readOnly],
    );
}
