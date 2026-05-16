/**
 * Inline node helpers — the offset-shifting math for atoms, analogous to
 * `marks.ts` for marks. Atoms occupy one character each at `position`, so
 * insert/delete/split/merge need to track and shift their positions.
 */

import type { InlineNode } from "./types";

export function adjustInlineNodesForInsert(
    nodes: InlineNode[] | undefined,
    at: number,
    length: number,
): InlineNode[] | undefined {
    if (!nodes || nodes.length === 0 || length === 0) return nodes;
    return nodes.map((n) => (n.position < at ? n : { ...n, position: n.position + length }));
}

export function adjustInlineNodesForDelete(
    nodes: InlineNode[] | undefined,
    from: number,
    to: number,
): InlineNode[] | undefined {
    if (!nodes || nodes.length === 0 || from === to) return nodes;
    const len = to - from;
    const out = nodes
        .filter((n) => n.position < from || n.position >= to)
        .map((n) => (n.position < from ? n : { ...n, position: n.position - len }));
    return out.length > 0 ? out : undefined;
}

export function shiftInlineNodes(
    nodes: InlineNode[] | undefined,
    delta: number,
): InlineNode[] | undefined {
    if (!nodes || nodes.length === 0) return nodes;
    return nodes.map((n) => ({ ...n, position: n.position + delta }));
}

export function findInlineNode(
    nodes: InlineNode[] | undefined,
    id: string,
): InlineNode | undefined {
    return nodes?.find((n) => n.id === id);
}
