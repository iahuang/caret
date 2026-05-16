/**
 * Minimal context that lets custom block renderers dispatch state changes
 * without each renderer needing a direct store reference. The Editor provides
 * it; renderers consume it via `useEditorActions()`.
 *
 * `dispatch` is the generic escape hatch — pass any `(state) => state`
 * transform from core/commands (e.g. `deleteCol`, `insertRowAbove`) and it
 * runs through the store's history-aware setState. `updateBlockMetadata` is
 * kept as a convenience for the common "patch this block's metadata" case.
 */

import { createContext, useContext } from "react";
import type { DocState } from "../core/types";

export interface EditorActions {
    updateBlockMetadata: (blockId: string, patch: Record<string, unknown>) => void;
    dispatch: (fn: (state: DocState) => DocState) => void;
    /**
     * Open the popover in edit mode for the given target id. Used by the
     * Cmd-K keybinding to immediately edit the URL of a newly-created link.
     * The id is whatever the popover target uses to identify itself:
     * `atom.id` for inline atoms, `block.id` for atomic blocks,
     * `attrs.linkId` for links.
     */
    requestEditing: (id: string) => void;
}

export const EditorActionsContext = createContext<EditorActions | null>(null);

export function useEditorActions(): EditorActions {
    const ctx = useContext(EditorActionsContext);
    if (!ctx) {
        throw new Error("useEditorActions must be used inside an <Editor>");
    }
    return ctx;
}
