/**
 * Decoration layer for find/replace matches.
 *
 * Mirrors `SelectionLayer`: turn each `Match` into one or more rects via
 * `Range.getClientRects()`, translate into container-local coordinates, and
 * paint absolutely-positioned divs. The "active" match gets a distinct class
 * so consumers can style it as the current focus.
 */

import { useEffect, useState, type RefObject } from "react";
import type { Doc, Match } from "../core/types";
import type { DomMapping } from "./useDomMapping";

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
    active: boolean;
    key: string;
}

interface Props {
    matches: Match[];
    activeIndex: number;
    doc: Doc;
    containerRef: RefObject<HTMLElement | null>;
    mapping: DomMapping;
}

export function MatchHighlightLayer({
    matches,
    activeIndex,
    doc,
    containerRef,
    mapping,
}: Props) {
    const [rects, setRects] = useState<Rect[]>([]);

    useEffect(() => {
        if (matches.length === 0) {
            setRects([]);
            return;
        }

        function update() {
            const container = containerRef.current;
            if (!container) {
                setRects([]);
                return;
            }
            const cRect = container.getBoundingClientRect();
            const all: Rect[] = [];
            for (let i = 0; i < matches.length; i++) {
                const m = matches[i]!;
                const range = mapping.rangeForSpan(m.blockId, m.start, m.end);
                if (!range) continue;
                const isActive = i === activeIndex;
                let sub = 0;
                for (const r of Array.from(range.getClientRects())) {
                    if (r.width === 0 && r.height === 0) continue;
                    all.push({
                        x: r.left - cRect.left + container.scrollLeft,
                        y: r.top - cRect.top + container.scrollTop,
                        width: r.width,
                        height: r.height,
                        active: isActive,
                        key: `${m.blockId}:${m.start}-${m.end}:${sub++}`,
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
    }, [matches, activeIndex, doc, mapping, containerRef]);

    return (
        <>
            {rects.map((r) => (
                <div
                    key={r.key}
                    className={
                        r.active
                            ? "mdedit-match-rect mdedit-match-rect-active"
                            : "mdedit-match-rect"
                    }
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
