/**
 * Table commands — `(state) => state` transforms over the `table-cell` block
 * subsystem.
 *
 * A "table" is a contiguous run of `table-cell` blocks linked by a shared
 * `metadata.tableId`. These helpers locate the run for a given cell, project
 * it into a 2D grid, mutate the grid (insert/delete row/col, change
 * alignment), and flatten it back into the flat block sequence — keeping
 * every cell's metadata internally consistent (`row`/`col`/`rowCount`/
 * `colCount`/`alignment`/`isHeader`).
 *
 * Every public command takes an optional `cellId`. Omitted = operate on
 * `state.selection.focus` (keyboard-shortcut path). Provided = operate on
 * that cell; the user's selection is preserved when the explicit target
 * differs from their focus (so e.g. "delete this column" from a toolbar
 * attached to col 3 doesn't yank the caret out of col 5).
 *
 * Helpers and `TableLocation` are intentionally private — adding cell-aware
 * functionality should go through these so the metadata invariants stay in
 * one place.
 */

import { getTableCellMeta, type ColAlignment } from "./schema";
import { findBlockIndex, generateId, replaceRange } from "./transform";
import type { Block, Doc, DocState, Selection } from "./types";

interface TableLocation {
    tableId: string;
    start: number;
    end: number;
    rowCount: number;
    colCount: number;
    alignment: ColAlignment[];
    row: number;
    col: number;
    cellIdx: number;
}

function findTableAt(doc: Doc, blockId: string): TableLocation | null {
    const idx = findBlockIndex(doc, blockId);
    if (idx < 0) return null;
    const block = doc[idx]!;
    if (block.type !== "table-cell") return null;
    const meta = getTableCellMeta(block);
    if (!meta) return null;
    let start = idx;
    while (start > 0) {
        const b = doc[start - 1]!;
        if (b.type !== "table-cell") break;
        const m = getTableCellMeta(b);
        if (!m || m.tableId !== meta.tableId) break;
        start--;
    }
    let end = idx;
    while (end < doc.length - 1) {
        const b = doc[end + 1]!;
        if (b.type !== "table-cell") break;
        const m = getTableCellMeta(b);
        if (!m || m.tableId !== meta.tableId) break;
        end++;
    }
    return {
        tableId: meta.tableId,
        start,
        end,
        rowCount: meta.rowCount,
        colCount: meta.colCount,
        alignment: meta.alignment.slice(),
        row: meta.row,
        col: meta.col,
        cellIdx: idx,
    };
}

function emptyCell(
    tableId: string,
    row: number,
    col: number,
    rowCount: number,
    colCount: number,
    alignment: ColAlignment[],
): Block {
    return {
        id: generateId(),
        type: "table-cell",
        content: "",
        marks: [],
        metadata: {
            tableId,
            row,
            col,
            rowCount,
            colCount,
            alignment: alignment.slice(),
            isHeader: row === 0,
        },
    };
}

function withCellMeta(
    block: Block,
    patch: { row?: number; col?: number; rowCount?: number; colCount?: number; alignment?: ColAlignment[] },
): Block {
    const meta = getTableCellMeta(block);
    if (!meta) return block;
    const next = {
        ...meta,
        ...patch,
        alignment: (patch.alignment ?? meta.alignment).slice(),
    };
    next.isHeader = next.row === 0;
    return { ...block, metadata: next };
}

/**
 * Cells of a table, indexed `[row][col]`. Caller has already located the
 * table range; this just buckets them by their metadata position.
 */
function gridOf(doc: Doc, loc: TableLocation): Block[][] {
    const grid: Block[][] = Array.from({ length: loc.rowCount }, () =>
        new Array<Block>(loc.colCount),
    );
    for (let i = loc.start; i <= loc.end; i++) {
        const b = doc[i]!;
        const m = getTableCellMeta(b);
        if (!m) continue;
        if (m.row < loc.rowCount && m.col < loc.colCount) {
            grid[m.row]![m.col] = b;
        }
    }
    return grid;
}

/**
 * Re-serialize a 2D grid of cells into the flat block sequence the doc
 * expects, normalizing every cell's metadata (row/col/rowCount/colCount/
 * alignment) so the result is internally consistent.
 */
function flattenGrid(
    grid: Block[][],
    tableId: string,
    alignment: ColAlignment[],
): Block[] {
    const rowCount = grid.length;
    const colCount = alignment.length;
    const out: Block[] = [];
    for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < colCount; c++) {
            const cell = grid[r]?.[c] ?? emptyCell(tableId, r, c, rowCount, colCount, alignment);
            out.push(withCellMeta(cell, { row: r, col: c, rowCount, colCount, alignment }));
        }
    }
    return out;
}

function replaceTable(doc: Doc, loc: TableLocation, replacement: Block[]): Doc {
    return replaceRange(doc, loc.start, loc.end + 1, replacement);
}

function focusCell(blockId: string, offset = 0): Selection {
    return {
        anchor: { blockId, offset },
        focus: { blockId, offset },
    };
}

function withTableAt(
    state: DocState,
    cellId: string | undefined,
    fn: (loc: TableLocation, grid: Block[][]) => { doc: Doc; focusId: string; offset?: number } | null,
): DocState {
    const userFocusId = state.selection?.focus.blockId;
    const targetId = cellId ?? userFocusId;
    if (!targetId) return state;
    const loc = findTableAt(state.doc, targetId);
    if (!loc) return state;
    const grid = gridOf(state.doc, loc);
    const result = fn(loc, grid);
    if (!result) return state;
    // Preserve the user's selection when the command targets a cell other
    // than the one they're typing in (so e.g. "delete column 3" called from
    // a toolbar attached to col 3 doesn't yank the caret out of col 5).
    // Without an explicit cellId — the keyboard-shortcut path — fall through
    // to the operation's natural focus target.
    const userSel = state.selection;
    const isExplicitOther = cellId !== undefined && cellId !== userFocusId;
    const userStillValid =
        userSel != null && result.doc.some((b) => b.id === userSel.focus.blockId);
    const selection: Selection =
        isExplicitOther && userStillValid
            ? userSel!
            : focusCell(result.focusId, result.offset ?? 0);
    return {
        doc: result.doc,
        selection,
        storedMarks: null,
    };
}

/**
 * Build an empty `rows x cols` table block sequence. Used by the inline
 * shortcut and by external callers wanting to insert a fresh table.
 */
export function createEmptyTable(rows: number, cols: number): Block[] {
    const safeRows = Math.max(1, rows);
    const safeCols = Math.max(1, cols);
    const tableId = generateId();
    const alignment: ColAlignment[] = new Array(safeCols).fill(null);
    const out: Block[] = [];
    for (let r = 0; r < safeRows; r++) {
        for (let c = 0; c < safeCols; c++) {
            out.push(emptyCell(tableId, r, c, safeRows, safeCols, alignment));
        }
    }
    return out;
}

export function insertRowAbove(state: DocState, cellId?: string): DocState {
    return withTableAt(state, cellId, (loc, grid) => {
        const newRow: Block[] = new Array(loc.colCount)
            .fill(null)
            .map((_, c) => emptyCell(loc.tableId, 0, c, loc.rowCount + 1, loc.colCount, loc.alignment));
        const newGrid = [...grid.slice(0, loc.row), newRow, ...grid.slice(loc.row)];
        const flat = flattenGrid(newGrid, loc.tableId, loc.alignment);
        const doc = replaceTable(state.doc, loc, flat);
        const focusId = flat[loc.row * loc.colCount + loc.col]!.id;
        return { doc, focusId };
    });
}

export function insertRowBelow(state: DocState, cellId?: string): DocState {
    return withTableAt(state, cellId, (loc, grid) => {
        const insertAt = loc.row + 1;
        const newRow: Block[] = new Array(loc.colCount)
            .fill(null)
            .map((_, c) => emptyCell(loc.tableId, 0, c, loc.rowCount + 1, loc.colCount, loc.alignment));
        const newGrid = [...grid.slice(0, insertAt), newRow, ...grid.slice(insertAt)];
        const flat = flattenGrid(newGrid, loc.tableId, loc.alignment);
        const doc = replaceTable(state.doc, loc, flat);
        const focusId = flat[insertAt * loc.colCount + loc.col]!.id;
        return { doc, focusId };
    });
}

export function insertColLeft(state: DocState, cellId?: string): DocState {
    return withTableAt(state, cellId, (loc, grid) => {
        const insertAt = loc.col;
        const newCols = loc.colCount + 1;
        const newAlignment: ColAlignment[] = [
            ...loc.alignment.slice(0, insertAt),
            null,
            ...loc.alignment.slice(insertAt),
        ];
        const newGrid = grid.map((row) => [
            ...row.slice(0, insertAt),
            // Placeholder; flattenGrid will fill in fresh cells.
            null as unknown as Block,
            ...row.slice(insertAt),
        ]);
        for (let r = 0; r < newGrid.length; r++) {
            newGrid[r]![insertAt] = emptyCell(loc.tableId, r, insertAt, loc.rowCount, newCols, newAlignment);
        }
        const flat = flattenGrid(newGrid, loc.tableId, newAlignment);
        const doc = replaceTable(state.doc, loc, flat);
        const focusId = flat[loc.row * newCols + insertAt]!.id;
        return { doc, focusId };
    });
}

export function insertColRight(state: DocState, cellId?: string): DocState {
    return withTableAt(state, cellId, (loc, grid) => {
        const insertAt = loc.col + 1;
        const newCols = loc.colCount + 1;
        const newAlignment: ColAlignment[] = [
            ...loc.alignment.slice(0, insertAt),
            null,
            ...loc.alignment.slice(insertAt),
        ];
        const newGrid = grid.map((row) => [
            ...row.slice(0, insertAt),
            null as unknown as Block,
            ...row.slice(insertAt),
        ]);
        for (let r = 0; r < newGrid.length; r++) {
            newGrid[r]![insertAt] = emptyCell(loc.tableId, r, insertAt, loc.rowCount, newCols, newAlignment);
        }
        const flat = flattenGrid(newGrid, loc.tableId, newAlignment);
        const doc = replaceTable(state.doc, loc, flat);
        const focusId = flat[loc.row * newCols + insertAt]!.id;
        return { doc, focusId };
    });
}

export function deleteRow(state: DocState, cellId?: string): DocState {
    return withTableAt(state, cellId, (loc, grid) => {
        // Always keep at least the header row.
        if (loc.rowCount <= 1) return null;
        const newGrid = [...grid.slice(0, loc.row), ...grid.slice(loc.row + 1)];
        const flat = flattenGrid(newGrid, loc.tableId, loc.alignment);
        const doc = replaceTable(state.doc, loc, flat);
        const newRow = Math.min(loc.row, newGrid.length - 1);
        const focusId = flat[newRow * loc.colCount + loc.col]!.id;
        return { doc, focusId };
    });
}

export function deleteCol(state: DocState, cellId?: string): DocState {
    return withTableAt(state, cellId, (loc, grid) => {
        if (loc.colCount <= 1) return null;
        const newCols = loc.colCount - 1;
        const newAlignment: ColAlignment[] = [
            ...loc.alignment.slice(0, loc.col),
            ...loc.alignment.slice(loc.col + 1),
        ];
        const newGrid = grid.map((row) => [...row.slice(0, loc.col), ...row.slice(loc.col + 1)]);
        const flat = flattenGrid(newGrid, loc.tableId, newAlignment);
        const doc = replaceTable(state.doc, loc, flat);
        const newCol = Math.min(loc.col, newCols - 1);
        const focusId = flat[loc.row * newCols + newCol]!.id;
        return { doc, focusId };
    });
}

export function deleteTable(state: DocState, cellId?: string): DocState {
    const targetId = cellId ?? state.selection?.focus.blockId;
    if (!targetId) return state;
    const loc = findTableAt(state.doc, targetId);
    if (!loc) return state;
    const replacement: Block[] = [
        { id: generateId(), type: "paragraph", content: "", marks: [] },
    ];
    const doc = replaceTable(state.doc, loc, replacement);
    // Preserve the user's selection if it's outside the table being deleted;
    // otherwise drop the caret into the replacement paragraph.
    const userSel = state.selection;
    const userStillValid =
        userSel != null && doc.some((b) => b.id === userSel.focus.blockId);
    return {
        doc,
        selection: userStillValid ? userSel! : focusCell(replacement[0]!.id, 0),
        storedMarks: null,
    };
}

export function setColAlignment(
    state: DocState,
    alignment: ColAlignment,
    cellId?: string,
): DocState {
    return withTableAt(state, cellId, (loc, grid) => {
        const newAlignment = loc.alignment.slice();
        newAlignment[loc.col] = alignment;
        const flat = flattenGrid(grid, loc.tableId, newAlignment);
        const doc = replaceTable(state.doc, loc, flat);
        const focusId = flat[loc.row * loc.colCount + loc.col]!.id;
        // For alignment changes the natural focus = same cell. Preserve the
        // original caret offset (not 0) so the user doesn't lose their place
        // when invoking via a keyboard shortcut.
        return { doc, focusId, offset: state.selection?.focus.offset ?? 0 };
    });
}

/**
 * Move the caret to the previous / next cell of the same table, if any.
 * Returns the unmodified state when already at the corresponding edge.
 */
export function moveToAdjacentCell(state: DocState, dir: "prev" | "next"): DocState {
    if (!state.selection) return state;
    const loc = findTableAt(state.doc, state.selection.focus.blockId);
    if (!loc) return state;
    let nextRow = loc.row;
    let nextCol = loc.col;
    if (dir === "next") {
        nextCol++;
        if (nextCol >= loc.colCount) {
            nextRow++;
            nextCol = 0;
        }
    } else {
        nextCol--;
        if (nextCol < 0) {
            nextRow--;
            nextCol = loc.colCount - 1;
        }
    }
    if (nextRow < 0 || nextRow >= loc.rowCount) return state;
    const target = state.doc[loc.start + nextRow * loc.colCount + nextCol];
    if (!target) return state;
    const offset = dir === "next" ? 0 : target.content.length;
    return {
        ...state,
        selection: focusCell(target.id, offset),
        storedMarks: null,
    };
}

/**
 * Like `moveToAdjacentCell` but, at the last cell of the table, appends a
 * new empty row and focuses its first cell. Used by Tab.
 */
export function tabToNextCell(state: DocState): DocState {
    if (!state.selection) return state;
    const loc = findTableAt(state.doc, state.selection.focus.blockId);
    if (!loc) return state;
    const atLast = loc.row === loc.rowCount - 1 && loc.col === loc.colCount - 1;
    if (!atLast) return moveToAdjacentCell(state, "next");
    const grid = gridOf(state.doc, loc);
    const newRow: Block[] = new Array(loc.colCount)
        .fill(null)
        .map((_, c) => emptyCell(loc.tableId, 0, c, loc.rowCount + 1, loc.colCount, loc.alignment));
    const flat = flattenGrid([...grid, newRow], loc.tableId, loc.alignment);
    const doc = replaceTable(state.doc, loc, flat);
    const focusId = flat[loc.rowCount * loc.colCount]!.id;
    return {
        doc,
        selection: focusCell(focusId, 0),
        storedMarks: null,
    };
}
