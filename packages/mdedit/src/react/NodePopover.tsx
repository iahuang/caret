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
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

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
    openHref,
    anchorAlignment = "start",
}: NodePopoverProps) {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // Tracks whether we've already grabbed focus for the current edit session.
    // The popover returns null on the first render while `pos` is still being
    // measured, so we have to defer focus until the textarea actually exists —
    // and once focused, we must NOT re-select on every `pos` recompute (which
    // would clobber the user's caret while they type).
    const focusedForEditingRef = useRef(false);

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
    }, [anchorSelector, value, containerRef, anchorAlignment]);

    useEffect(() => {
        if (!editing) {
            focusedForEditingRef.current = false;
            return;
        }
        if (focusedForEditingRef.current) return;
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.select();
        focusedForEditingRef.current = true;
    }, [editing, pos]);

    // Auto-size the textarea to fit its content. `rows={1}` is the floor; we
    // reset to "auto" before reading scrollHeight so the box can shrink as
    // well as grow. `useLayoutEffect` runs synchronously before paint, so
    // there's no one-frame flash at the rows={1} default. CSS provides the
    // max-height + overflow-y so very long input scrolls instead of pushing
    // the popover off-screen.
    useLayoutEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
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
