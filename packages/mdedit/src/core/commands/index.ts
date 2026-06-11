/**
 * High-level edit commands. Every command has the same shape:
 * `(state: DocState) => DocState`. They are pure, composable, and easy to test.
 *
 * Stored-marks contract:
 *   - `insertText` and the inline-mark `toggleMark` (collapsed branch) preserve
 *     or update `storedMarks`.
 *   - Every other command (delete, break, indent, set-block-type, range
 *     mark-toggle, block-level markdown shortcut) clears it.
 *   - Cursor movement (in the React keymap) also clears it.
 *
 * This module is organized as a barrel over the focused sub-modules under
 * `commands/`. New commands belong in the sub-module that matches their
 * concern; private helpers shared across sub-modules live in `./helpers`.
 */

export { activeMarks, isMarkActive, marksAtPosition, toggleMark } from "./marks";
export {
    deleteBackward,
    deleteForward,
    deleteSelection,
    insertBlocks,
    insertBreak,
    insertInlineNode,
    insertText,
    replaceTextRange,
    sliceDocBySelection,
} from "./editing";
export {
    indentBlock,
    setBlockType,
    updateBlockMetadata,
    updateInlineNode,
} from "./blockType";
export { findWordBoundaryBackward, findWordBoundaryForward } from "./wordBoundary";
export { nextCharOffset, prevCharOffset } from "./charBoundary";
export { applyMarkdownShortcuts } from "./blockShortcuts";
export { applyInlineShortcuts } from "./inlineShortcuts";
export { updateLinkHref, wrapSelectionInLink } from "./link";
