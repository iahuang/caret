/**
 * Mark operations.
 *
 * Marks are stored as half-open offset ranges. When text is inserted or
 * deleted, marks need to be shifted/trimmed so their ranges still refer to
 * the same characters. These helpers are intentionally simple — no merging
 * or compaction beyond what's needed for `toggleMark`.
 */

import type { Mark, MarkType } from "./types";

export function adjustMarksForInsert(marks: Mark[], at: number, length: number): Mark[] {
    if (length === 0) return marks;
    return marks.map((m) => {
        if (m.end <= at) return m;
        if (m.start >= at) return { ...m, start: m.start + length, end: m.end + length };
        return { ...m, end: m.end + length };
    });
}

export function adjustMarksForDelete(marks: Mark[], from: number, to: number): Mark[] {
    if (from === to) return marks;
    const len = to - from;
    const out: Mark[] = [];
    for (const m of marks) {
        // entirely before
        if (m.end <= from) {
            out.push(m);
            continue;
        }
        // entirely after
        if (m.start >= to) {
            out.push({ ...m, start: m.start - len, end: m.end - len });
            continue;
        }
        // overlap
        const newStart = m.start < from ? m.start : from;
        const newEnd = m.end > to ? m.end - len : from;
        if (newEnd > newStart) {
            out.push({ ...m, start: newStart, end: newEnd });
        }
    }
    return out;
}

export function shiftMarks(marks: Mark[], delta: number): Mark[] {
    return marks.map((m) => ({ ...m, start: m.start + delta, end: m.end + delta }));
}

export function hasMarkInRange(marks: Mark[], type: MarkType, from: number, to: number): boolean {
    if (from === to) {
        return marks.some((m) => m.type === type && m.start <= from && m.end >= from);
    }
    const sorted = marks.filter((m) => m.type === type).sort((a, b) => a.start - b.start);
    let covered = from;
    for (const m of sorted) {
        if (m.start > covered) return false;
        covered = Math.max(covered, m.end);
        if (covered >= to) return true;
    }
    return false;
}

export function toggleMark(marks: Mark[], type: MarkType, from: number, to: number): Mark[] {
    if (from === to) return marks;
    if (hasMarkInRange(marks, type, from, to)) {
        // Remove the mark in this range — split marks that straddle the boundaries.
        const out: Mark[] = [];
        for (const m of marks) {
            if (m.type !== type || m.end <= from || m.start >= to) {
                out.push(m);
                continue;
            }
            if (m.start < from) out.push({ ...m, end: from });
            if (m.end > to) out.push({ ...m, start: to });
        }
        return out;
    }
    // Add the mark and absorb adjacent/overlapping marks of the same type.
    // Absorbed marks may carry attrs (e.g. a link's href); keep the first
    // ones found so the merge never silently destroys them.
    let newStart = from;
    let newEnd = to;
    let attrs: Record<string, unknown> | undefined;
    const out: Mark[] = [];
    for (const m of marks) {
        if (m.type !== type || m.end < from || m.start > to) {
            out.push(m);
            continue;
        }
        newStart = Math.min(newStart, m.start);
        newEnd = Math.max(newEnd, m.end);
        if (attrs === undefined && m.attrs !== undefined) attrs = m.attrs;
    }
    const added: Mark = { type, start: newStart, end: newEnd };
    if (attrs !== undefined) added.attrs = attrs;
    out.push(added);
    return out.sort((a, b) => a.start - b.start);
}
