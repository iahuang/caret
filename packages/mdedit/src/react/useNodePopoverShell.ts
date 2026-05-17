/**
 * Headless shell for the editing popover.
 *
 * Owns the bits every popover surface needs and nothing else:
 *   - Anchor positioning in container-local coords (with ResizeObserver +
 *     window-resize listeners).
 *   - Exit primitives — `exitLeft`, `exitRight`, `dismiss` — that consumers
 *     wire into their own keymap / button handlers.
 *   - `editingSessionId`: a token that bumps once per false→true transition
 *     of `editing`, but only after `pos` has been measured at least once.
 *     Consumers key their initial focus/select effect off this token so it
 *     fires exactly once per edit session, regardless of how many times
 *     `pos` is recomputed mid-session.
 *
 * What it intentionally does NOT own:
 *   - The editing surface (textarea / contentEditable / CodeMirror / etc.).
 *   - The keydown handler: edge-of-buffer detection is surface-specific.
 *     Consumers call the exit primitives from their own keymap.
 *   - Initial focus/select behavior. The token signals when it's safe; the
 *     consumer decides what "focus" and "select" mean for its surface.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

export interface NodePopoverShellOptions {
    /** CSS selector resolved within `containerRef` for the anchor element. */
    anchorSelector: string;
    /** Whether the popover is in editing (vs preview) state. */
    editing: boolean;
    /** Container the popover positions itself within (and scrolls with). */
    containerRef: RefObject<HTMLElement | null>;
    /** Horizontal anchoring relative to the anchor element. */
    anchorAlignment?: "start" | "center";
    /**
     * Extra dependencies that should trigger a re-measure. Pass things that
     * change the anchor's size or position (e.g. the popover's own value,
     * which can cause the anchored element to grow/shrink).
     */
    measureDeps?: ReadonlyArray<unknown>;
}

export interface NodePopoverShell {
    /** Container-local top-left of the popover, or null while measuring. */
    pos: { x: number; y: number } | null;
    /**
     * Increments once per edit session, after `pos` is measured. -1 while no
     * session has been acquired since the last `editing=false`. Use as the
     * sole dep of a `useEffect` that performs first-frame focus/selection on
     * the editing surface.
     */
    editingSessionId: number;
}

export function useNodePopoverShell({
    anchorSelector,
    editing,
    containerRef,
    anchorAlignment = "start",
    measureDeps = [],
}: NodePopoverShellOptions): NodePopoverShell {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const [editingSessionId, setEditingSessionId] = useState(-1);
    // Captures the in-flight session counter outside React state so we don't
    // re-fire the bump effect if `pos` updates within the same session.
    const sessionAcquiredRef = useRef(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const anchorEl = container.querySelector(anchorSelector);
        if (!anchorEl) {
            setPos(null);
            return;
        }
        function update() {
            if (!anchorEl || !container) return;
            const r = anchorEl.getBoundingClientRect();
            const c = container.getBoundingClientRect();
            const x =
                anchorAlignment === "center"
                    ? r.left + r.width / 2 - c.left + container.scrollLeft
                    : r.left - c.left + container.scrollLeft;
            setPos({
                x,
                y: r.bottom - c.top + container.scrollTop + 6,
            });
        }
        update();
        const ro = new ResizeObserver(update);
        ro.observe(container);
        window.addEventListener("resize", update);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", update);
        };
        // measureDeps is intentionally spread so callers can pass arbitrary
        // length arrays. The dependency-array length is part of the hook's
        // contract and must be stable across renders of a given caller.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchorSelector, containerRef, anchorAlignment, ...measureDeps]);

    useEffect(() => {
        if (!editing) {
            sessionAcquiredRef.current = false;
            setEditingSessionId(-1);
            return;
        }
        if (sessionAcquiredRef.current) return;
        if (pos === null) return;
        sessionAcquiredRef.current = true;
        setEditingSessionId((n) => (n < 0 ? 0 : n + 1));
    }, [editing, pos]);

    return { pos, editingSessionId };
}
