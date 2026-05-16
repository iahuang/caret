/**
 * Drawn caret.
 *
 * Two measurement paths:
 *   - Non-empty block: take `Range.getBoundingClientRect()` at the cursor.
 *   - Empty block: ranges over an element with no text are unreliable across
 *     browsers; measure the content element directly and use its computed
 *     line-height for the height.
 *
 * Style reflects active marks (the marks that will be applied to the next
 * typed character):
 *   - bold   → wider, centered on the logical position
 *   - italic → skewed so it leans like `/`
 *   - code   → thin caret with horizontal `::before`/`::after` serifs (I-beam)
 *
 * `activeMarks` is computed by the Editor from `(storedMarks, position)` and
 * passed in so the caret can re-style without recomputing its geometry.
 */

import { useEffect, useState, type RefObject } from "react";
import type { Doc, MarkType, Selection } from "../core/types";
import { isCollapsed } from "../core/types";
import type { DomMapping } from "./useDomMapping";

interface Rect {
    x: number;
    y: number;
    height: number;
}

interface Props {
    selection: Selection | null;
    doc: Doc;
    containerRef: RefObject<HTMLElement | null>;
    mapping: DomMapping;
    isFocused: boolean;
    activeMarks: MarkType[];
}

function computeLineHeight(el: HTMLElement): number {
    const cs = window.getComputedStyle(el);
    const fs = parseFloat(cs.fontSize) || 16;
    const lhStr = cs.lineHeight;
    if (lhStr === "normal") return fs * 1.2;
    const v = parseFloat(lhStr);
    if (!isFinite(v)) return fs * 1.2;
    return /px$/.test(lhStr) ? v : v * fs;
}

const BASE_WIDTH = 1.5;
const BOLD_WIDTH = 2.5;

export function Caret({ selection, doc, containerRef, mapping, isFocused, activeMarks }: Props) {
    const [rect, setRect] = useState<Rect | null>(null);
    const [isMoving, setIsMoving] = useState(false);

    // Suspend the blink for a short window after the caret moves (click,
    // arrow keys, typing) so users can clearly see where it landed.
    const focusBlockId = selection?.focus.blockId;
    const focusOffset = selection?.focus.offset;
    useEffect(() => {
        if (focusBlockId === undefined) return;
        setIsMoving(true);
        const id = window.setTimeout(() => setIsMoving(false), 500);
        return () => window.clearTimeout(id);
    }, [focusBlockId, focusOffset]);

    useEffect(() => {
        if (!selection || !isCollapsed(selection)) {
            setRect(null);
            return;
        }

        function update() {
            const container = containerRef.current;
            if (!container || !selection) {
                setRect(null);
                return;
            }
            const c = container.getBoundingClientRect();

            const block = doc.find((b) => b.id === selection.focus.blockId);
            if (block && block.content.length === 0) {
                const blockEl = mapping.findBlockElement(selection.focus.blockId);
                if (!blockEl) {
                    setRect(null);
                    return;
                }
                const contentEl =
                    (blockEl.querySelector("[data-block-content]") as HTMLElement | null) ?? blockEl;
                const hr = contentEl.getBoundingClientRect();
                const lh = computeLineHeight(contentEl);
                setRect({
                    x: hr.left - c.left + container.scrollLeft,
                    y: hr.top - c.top + container.scrollTop,
                    height: lh,
                });
                return;
            }

            const r = mapping.clientRectForPosition(selection.focus);
            if (!r) {
                setRect(null);
                return;
            }
            setRect({
                x: r.left - c.left + container.scrollLeft,
                y: r.top - c.top + container.scrollTop,
                height: r.height || 20,
            });
        }

        update();
        const ro = new ResizeObserver(update);
        const c = containerRef.current;
        if (c) ro.observe(c);
        window.addEventListener("resize", update);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [selection, doc, mapping, containerRef]);

    if (!rect || !isFocused || !selection || !isCollapsed(selection)) return null;

    const isBold = activeMarks.includes("bold");
    const isItalic = activeMarks.includes("italic");
    const isCode = activeMarks.includes("code");

    const width = isBold ? BOLD_WIDTH : BASE_WIDTH;
    // Center the (possibly wider) caret on the logical x so it doesn't drift
    // when the user toggles bold on/off.
    const left = rect.x - (width - BASE_WIDTH) / 2;

    const classes = ["mdedit-caret"];
    if (isItalic) classes.push("mdedit-caret-italic");
    if (isCode) classes.push("mdedit-caret-code");
    if (isMoving) classes.push("mdedit-caret-static");

    return (
        <div
            className={classes.join(" ")}
            style={{
                position: "absolute",
                left,
                top: rect.y,
                width,
                height: rect.height,
            }}
            aria-hidden="true"
        />
    );
}
