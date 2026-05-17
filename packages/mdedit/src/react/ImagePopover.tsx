/**
 * Two-field popover for editing an image atom's `alt` and `src`.
 *
 * The shape mirrors NodePopover (preview vs edit, anchor-based positioning,
 * edge-arrow exits), but with two inputs instead of one:
 *   - Editing starts in the `src` field (the part the user usually wants to
 *     change). Tab moves between fields.
 *   - ArrowLeft at offset 0 of the `alt` field exits left.
 *   - ArrowRight at end of the `src` field exits right.
 *   - ArrowRight at end of alt focuses src; ArrowLeft at 0 of src focuses alt.
 *   - Escape returns to the read-only preview state.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useNodePopoverShell } from "./useNodePopoverShell";

export interface ImagePopoverProps {
    anchorSelector: string;
    alt: string;
    src: string;
    editing: boolean;
    onStartEditing: () => void;
    onChange: (patch: { alt?: string; src?: string }) => void;
    onDoneEditing: () => void;
    onExitLeft?: () => void;
    onExitRight?: () => void;
    containerRef: RefObject<HTMLElement | null>;
}

export function ImagePopover({
    anchorSelector,
    alt,
    src,
    editing,
    onStartEditing,
    onChange,
    onDoneEditing,
    onExitLeft,
    onExitRight,
    containerRef,
}: ImagePopoverProps) {
    const altRef = useRef<HTMLInputElement>(null);
    const srcRef = useRef<HTMLInputElement>(null);
    const { pos, editingSessionId } = useNodePopoverShell({
        anchorSelector,
        editing,
        containerRef,
        measureDeps: [alt, src],
    });

    useEffect(() => {
        if (editingSessionId < 0) return;
        const target = srcRef.current;
        if (!target) return;
        target.focus();
        target.select();
    }, [editingSessionId]);

    if (!pos) return null;

    function onKeyDown(
        e: React.KeyboardEvent<HTMLInputElement>,
        field: "alt" | "src",
    ) {
        if (e.key === "Escape") {
            e.preventDefault();
            onDoneEditing();
            return;
        }
        const input = e.currentTarget;
        if (e.key === "Tab") {
            e.preventDefault();
            (field === "alt" ? srcRef : altRef).current?.focus();
            return;
        }
        if (input.selectionStart !== input.selectionEnd) return;
        if (e.key === "ArrowLeft" && input.selectionStart === 0) {
            e.preventDefault();
            if (field === "src") altRef.current?.focus();
            else if (onExitLeft) onExitLeft();
            return;
        }
        if (e.key === "ArrowRight" && input.selectionStart === input.value.length) {
            e.preventDefault();
            if (field === "alt") srcRef.current?.focus();
            else if (onExitRight) onExitRight();
            return;
        }
    }

    return (
        <div
            className={`mdedit-node-popover mdedit-image-popover${editing ? " editing" : ""}`}
            style={{ position: "absolute", left: pos.x, top: pos.y }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="mdedit-image-popover-row">
                <span className="mdedit-node-popover-label">src</span>
                <input
                    ref={srcRef}
                    type="text"
                    className="mdedit-node-popover-input"
                    value={src}
                    onChange={(e) => onChange({ src: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, "src")}
                    onClick={() => {
                        if (!editing) onStartEditing();
                    }}
                    readOnly={!editing}
                    spellCheck={false}
                    placeholder="https://…"
                />
            </div>
            <div className="mdedit-image-popover-row">
                <span className="mdedit-node-popover-label">alt</span>
                <input
                    ref={altRef}
                    type="text"
                    className="mdedit-node-popover-input"
                    value={alt}
                    onChange={(e) => onChange({ alt: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, "alt")}
                    onClick={() => {
                        if (!editing) onStartEditing();
                    }}
                    readOnly={!editing}
                    spellCheck={false}
                    placeholder="alt text"
                />
            </div>
        </div>
    );
}
