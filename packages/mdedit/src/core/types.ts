/**
 * Core types for the mdedit data model.
 *
 * A document is a flat array of blocks. Each block has plain-text `content`
 * and a list of `marks` that decorate ranges of that content. Cursors and
 * selections are expressed in logical (blockId, offset) coordinates — never
 * in DOM Ranges. The DOM bridge in the React layer converts to/from DOM.
 */

export type MarkType = string;

export interface Mark {
    type: MarkType;
    /** Inclusive start offset within block.content */
    start: number;
    /** Exclusive end offset within block.content */
    end: number;
    attrs?: Record<string, unknown>;
}

export type BlockType = string;

/**
 * An inline atom embedded in a block's content. Each atom occupies exactly
 * one character (`INLINE_NODE_PLACEHOLDER`) at `position` in `content`, so
 * cursor offsets, marks, and the rest of the model treat it as a single
 * indivisible character. `type` selects a renderer; `data` is type-specific.
 */
export interface InlineNode {
    id: string;
    type: string;
    position: number;
    data: Record<string, unknown>;
}

/** The single-character placeholder that stands in for an inline atom. */
export const INLINE_NODE_PLACEHOLDER = "￼";

export interface Block {
    id: string;
    type: BlockType;
    content: string;
    marks: Mark[];
    inlineNodes?: InlineNode[];
    metadata?: Record<string, unknown>;
}

export type Doc = Block[];

export interface Position {
    blockId: string;
    offset: number;
    /**
     * Visual-line affinity at wrap boundaries. The same model offset can
     * represent two visual positions when text wraps: the end of one visual
     * line (`"upstream"`) and the start of the next (`"downstream"`).
     * Defaults to `"upstream"` when absent — matches the browser's default
     * for collapsed ranges. Set by `positionFromPoint` when a click or
     * line-edge hit-test lands on a wrap continuation line.
     */
    affinity?: "upstream" | "downstream";
}

export interface Selection {
    anchor: Position;
    focus: Position;
}

export interface DocState {
    doc: Doc;
    selection: Selection | null;
    /**
     * Marks to apply to the next typed character.
     *
     *   - `null` (or absent) means "derive from the cursor's position":
     *     inherit the marks of the character to the cursor's left
     *     (right-side fallback at offset 0).
     *   - A `MarkType[]` overrides that default. Toggling a mark at a
     *     collapsed cursor (Cmd-B) sets this; cursor movement clears it.
     *
     * Persists across consecutive typing so a typed word inherits the
     * same style without re-toggling.
     */
    storedMarks?: MarkType[] | null;
}

export function isCollapsed(sel: Selection | null): boolean {
    if (!sel) return true;
    return sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
}

/**
 * A find result. Single-block: `start` and `end` are offsets within the named
 * block's `content`. `end` is exclusive.
 */
export interface Match {
    blockId: string;
    start: number;
    end: number;
}
