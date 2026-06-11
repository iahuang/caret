/**
 * Popover for editing the source of a node (inline atom OR atomic block).
 *
 * Decoupled from what's being edited: it takes a CSS selector for the anchor
 * element, a string value, and a change/done callback. The popover positions
 * itself just below the anchor in container-local coordinates.
 *
 * Two states:
 *   - View: visible, textarea is read-only. Shown when the main caret is
 *     adjacent to an inline atom but the user hasn't stepped into it yet.
 *   - Edit: textarea is focused and editable. Entered by clicking the popover,
 *     by clicking the anchor, or by arrowing into the atom from the main
 *     editor. Exited by arrow-left at offset 0 / arrow-right at end (which
 *     also moves the main caret to the appropriate side of the atom) or by
 *     Escape (which just releases focus without moving the main caret).
 *
 * Positioning + edit-session tracking live in `useNodePopoverShell`; this
 * file owns only the textarea surface and the textarea-specific keymap.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useNodePopoverShell } from "./useNodePopoverShell";

export interface NodePopoverProps {
    /** CSS selector resolved within `containerRef` for the anchor element. */
    anchorSelector: string;
    label: string;
    value: string;
    editing: boolean;
    onStartEditing: () => void;
    onChange: (value: string) => void;
    onDoneEditing: () => void;
    /**
     * Arrow-left (or arrow-up) at offset 0 inside the textarea — exit to the
     * left side of the atom / previous block.
     */
    onExitLeft?: () => void;
    /**
     * Arrow-right (or arrow-down) at end of textarea — exit to the right side
     * of the atom / next block.
     */
    onExitRight?: () => void;
    containerRef: RefObject<HTMLElement | null>;
    placeholder?: string;
    /**
     * Treat the value as single-line (e.g. a URL): Enter commits the edit
     * (`onDoneEditing`) instead of inserting a newline into the value.
     */
    singleLine?: boolean;
    /**
     * When set, render an "open in new tab" affordance in the popover that
     * follows the URL. Plain-click on a link in the editor drops the caret
     * (so you can edit the label), so this is the discoverable way to
     * navigate. Pass the same `value` that's being edited.
     */
    openHref?: string;
    /**
     * Where to anchor the popover horizontally relative to the anchor element.
     * "start" (default) aligns the popover's left edge with the anchor's left.
     * "center" aligns the popover's horizontal center with the anchor's
     * horizontal center — useful when the anchor is a wide, centered block
     * (e.g. a display-math block) and "start" would visually orphan the
     * popover to one side.
     */
    anchorAlignment?: "start" | "center";
}

export function NodePopover({
    anchorSelector,
    label,
    value,
    editing,
    onStartEditing,
    onChange,
    onDoneEditing,
    onExitLeft,
    onExitRight,
    containerRef,
    placeholder = "LaTeX…",
    singleLine = false,
    openHref,
    anchorAlignment = "start",
}: NodePopoverProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const { pos, editingSessionId } = useNodePopoverShell({
        anchorSelector,
        editing,
        containerRef,
        anchorAlignment,
        measureDeps: [value],
    });

    useEffect(() => {
        if (editingSessionId < 0) return;
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.select();
    }, [editingSessionId]);

    // Auto-size the textarea to fit its content. `rows={1}` is the floor; we
    // reset to "auto" before reading scrollHeight so the box can shrink as
    // well as grow. `useLayoutEffect` runs synchronously before paint, so
    // there's no one-frame flash at the rows={1} default. CSS provides the
    // max-height + overflow-y so very long input scrolls instead of pushing
    // the popover off-screen.
    useLayoutEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        // Capture scroll + caret-at-end before the resize. Setting
        // style.height to "auto" briefly collapses the textarea, which
        // clamps scrollTop to 0; once the box re-expands past max-height
        // (14em) the caret at the end of long LaTeX would sit below the
        // visible window. Restore scrollTop afterwards, and snap to the
        // bottom when the caret was at value.length (the typical typing
        // case) so the freshly-typed character stays in view.
        const prevScrollTop = ta.scrollTop;
        const wasAtEnd =
            document.activeElement === ta && ta.selectionStart === ta.value.length;
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
        ta.scrollTop = wasAtEnd ? ta.scrollHeight : prevScrollTop;
    }, [value, pos]);

    if (!pos) return null;

    return (
        <div
            className={`mdedit-node-popover${editing ? " editing" : ""}`}
            data-anchor-alignment={anchorAlignment}
            style={{ position: "absolute", left: pos.x, top: pos.y }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="mdedit-node-popover-header">
                <span className="mdedit-node-popover-label">{label}</span>
                {openHref ? (
                    <a
                        className="mdedit-node-popover-open"
                        href={openHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in new tab"
                    >
                        Open ↗
                    </a>
                ) : null}
            </div>
            <textarea
                ref={textareaRef}
                className="mdedit-node-popover-input"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        e.preventDefault();
                        onDoneEditing();
                        return;
                    }
                    // Single-line values (URLs): Enter means "confirm", and a
                    // literal newline would corrupt the value.
                    if (singleLine && e.key === "Enter") {
                        e.preventDefault();
                        onDoneEditing();
                        return;
                    }
                    const ta = e.currentTarget;
                    // Edge-arrow exits require a *collapsed* caret at the very
                    // edge of the textarea. If the textarea is in a select-all
                    // state (initial entry), the first arrow press just
                    // collapses the selection; a second one at the edge exits.
                    // ArrowUp / ArrowDown mirror Left/Right: they only exit
                    // when the caret is at offset 0 / value.length, so
                    // multi-line content (hard newlines or soft-wraps) is
                    // still navigable inside the textarea — the browser's
                    // default vertical caret move runs first and ArrowUp only
                    // escapes once it would otherwise no-op at the top.
                    if (ta.selectionStart !== ta.selectionEnd) return;
                    if (
                        (e.key === "ArrowLeft" || e.key === "ArrowUp") &&
                        ta.selectionStart === 0 &&
                        onExitLeft
                    ) {
                        e.preventDefault();
                        onExitLeft();
                        return;
                    }
                    if (
                        (e.key === "ArrowRight" || e.key === "ArrowDown") &&
                        ta.selectionStart === value.length &&
                        onExitRight
                    ) {
                        e.preventDefault();
                        onExitRight();
                        return;
                    }
                }}
                onClick={() => {
                    if (!editing) onStartEditing();
                }}
                readOnly={!editing}
                rows={1}
                spellCheck={false}
                placeholder={placeholder}
            />
        </div>
    );
}
