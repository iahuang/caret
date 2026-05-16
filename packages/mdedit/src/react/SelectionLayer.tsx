/**
 * Drawn selection.
 *
 * Selection rectangles come from `Range.getClientRects()` — the browser
 * returns one rect per visual line a range spans, including correctly handling
 * line wraps. We then translate them into container-local coordinates.
 */

import { useEffect, useState, type RefObject } from "react";
import type { Doc, Selection } from "../core/types";
import { isCollapsed } from "../core/types";
import type { DomMapping } from "./useDomMapping";

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Props {
    selection: Selection | null;
    doc: Doc;
    containerRef: RefObject<HTMLElement | null>;
    mapping: DomMapping;
}

function textLengthOfBlock(blockEl: HTMLElement): number {
    const content = blockEl.querySelector("[data-block-content]") ?? blockEl;
    return (content.textContent ?? "").length;
}

export function SelectionLayer({ selection, doc, containerRef, mapping }: Props) {
    const [rects, setRects] = useState<Rect[]>([]);

    useEffect(() => {
        if (!selection || isCollapsed(selection)) {
            setRects([]);
            return;
        }

        function update() {
            const container = containerRef.current;
            if (!container || !selection) {
                setRects([]);
                return;
            }

            const blocks = Array.from(
                container.querySelectorAll("[data-block-id]"),
            ) as HTMLElement[];
            const anchorIdx = blocks.findIndex((b) => b.dataset.blockId === selection.anchor.blockId);
            const focusIdx = blocks.findIndex((b) => b.dataset.blockId === selection.focus.blockId);
            if (anchorIdx < 0 || focusIdx < 0) {
                setRects([]);
                return;
            }

            const isBackward =
                focusIdx < anchorIdx ||
                (focusIdx === anchorIdx && selection.focus.offset < selection.anchor.offset);
            const fromPos = isBackward ? selection.focus : selection.anchor;
            const toPos = isBackward ? selection.anchor : selection.focus;
            const fromIdx = isBackward ? focusIdx : anchorIdx;
            const toIdx = isBackward ? anchorIdx : focusIdx;

            const cRect = container.getBoundingClientRect();
            const all: Rect[] = [];

            for (let i = fromIdx; i <= toIdx; i++) {
                const blockEl = blocks[i]!;
                const blockId = blockEl.dataset.blockId!;
                const len = textLengthOfBlock(blockEl);
                const start = i === fromIdx ? fromPos.offset : 0;
                const end = i === toIdx ? toPos.offset : len;
                if (start === end) continue;

                const range = mapping.rangeForSpan(blockId, start, end);
                if (!range) continue;

                for (const r of Array.from(range.getClientRects())) {
                    if (r.width === 0 && r.height === 0) continue;
                    all.push({
                        x: r.left - cRect.left + container.scrollLeft,
                        y: r.top - cRect.top + container.scrollTop,
                        width: r.width,
                        height: r.height,
                    });
                }
            }
            setRects(all);
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

    return (
        <>
            {rects.map((r, i) => (
                <div
                    key={i}
                    className="mdedit-selection-rect"
                    style={{
                        position: "absolute",
                        left: r.x,
                        top: r.y,
                        width: r.width,
                        height: r.height,
                    }}
                    aria-hidden="true"
                />
            ))}
        </>
    );
}
