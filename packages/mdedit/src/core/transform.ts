/**
 * Pure structural transforms over Blocks. Each transform threads three kinds
 * of position-bearing state in lockstep: text content, marks, inline atoms.
 */

import {
    adjustInlineNodesForDelete,
    adjustInlineNodesForInsert,
    shiftInlineNodes,
} from "./inlineNodes";
import { adjustMarksForDelete, adjustMarksForInsert, shiftMarks } from "./marks";
import type { Block, Doc, InlineNode } from "./types";

export function generateId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function findBlockIndex(doc: Doc, blockId: string): number {
    return doc.findIndex((b) => b.id === blockId);
}

export function insertTextInBlock(block: Block, at: number, text: string): Block {
    if (text.length === 0) return block;
    return {
        ...block,
        content: block.content.slice(0, at) + text + block.content.slice(at),
        marks: adjustMarksForInsert(block.marks, at, text.length),
        inlineNodes: adjustInlineNodesForInsert(block.inlineNodes, at, text.length),
    };
}

export function deleteRangeInBlock(block: Block, from: number, to: number): Block {
    if (from === to) return block;
    return {
        ...block,
        content: block.content.slice(0, from) + block.content.slice(to),
        marks: adjustMarksForDelete(block.marks, from, to),
        inlineNodes: adjustInlineNodesForDelete(block.inlineNodes, from, to),
    };
}

export function splitBlock(block: Block, at: number, nextType?: string): [Block, Block] {
    const first: Block = {
        ...block,
        content: block.content.slice(0, at),
        marks: adjustMarksForDelete(block.marks, at, block.content.length),
        inlineNodes: adjustInlineNodesForDelete(block.inlineNodes, at, block.content.length),
    };
    const secondMarks = adjustMarksForDelete(block.marks, 0, at);
    const secondInlineNodes: InlineNode[] | undefined = block.inlineNodes
        ? block.inlineNodes
              .filter((n) => n.position >= at)
              .map((n) => ({ ...n, position: n.position - at }))
        : undefined;
    const second: Block = {
        id: generateId(),
        type: nextType ?? block.type,
        content: block.content.slice(at),
        marks: secondMarks,
        inlineNodes:
            secondInlineNodes && secondInlineNodes.length > 0 ? secondInlineNodes : undefined,
        metadata: nextType === undefined ? (block.metadata ? { ...block.metadata } : undefined) : undefined,
    };
    return [first, second];
}

export function mergeBlocks(first: Block, second: Block): Block {
    const offset = first.content.length;
    const firstNodes = first.inlineNodes ?? [];
    const secondNodes = shiftInlineNodes(second.inlineNodes, offset) ?? [];
    const allNodes = [...firstNodes, ...secondNodes];
    return {
        ...first,
        content: first.content + second.content,
        marks: [...first.marks, ...shiftMarks(second.marks, offset)],
        inlineNodes: allNodes.length > 0 ? allNodes : undefined,
    };
}

export function replaceBlock(doc: Doc, index: number, block: Block): Doc {
    const out = doc.slice();
    out[index] = block;
    return out;
}

export function replaceRange(doc: Doc, from: number, toExclusive: number, replacement: Block[]): Doc {
    return [...doc.slice(0, from), ...replacement, ...doc.slice(toExclusive)];
}
