import { Fragment, useMemo } from "react";
import type { Block, Doc } from "../core/types";
import { getTableCellMeta } from "../core/schema";
import { renderInline, type InlineNodeRenderer, type MarkRenderer } from "./renderInline";
import type { BlockRenderer } from "./defaultRenderer";

export interface BlockViewProps {
    block: Block;
    index: number;
    doc: Doc;
    renderer: BlockRenderer;
    markRenderers: MarkRenderer[];
    inlineRenderers: InlineNodeRenderer[];
}

export function BlockView({ block, index, doc, renderer, markRenderers, inlineRenderers }: BlockViewProps) {
    const content = renderInline(
        block.content,
        block.marks,
        block.inlineNodes,
        markRenderers,
        inlineRenderers,
    );
    return <>{renderer({ block, content, index, doc })}</>;
}

export interface RenderedBlocksProps {
    doc: Doc;
    renderers: Record<string, BlockRenderer>;
    markRenderers: MarkRenderer[];
    inlineRenderers: InlineNodeRenderer[];
}

type RenderItem =
    | { kind: "block"; block: Block; index: number }
    | { kind: "table"; tableId: string; cells: Block[][]; indices: number[][] };

/**
 * Walk the doc, grouping runs of `table-cell` blocks that share a `tableId`
 * into a single `table` item. Cells without complete metadata fall back to
 * rendering as standalone blocks.
 */
function groupForRendering(doc: Doc): RenderItem[] {
    const out: RenderItem[] = [];
    let i = 0;
    while (i < doc.length) {
        const b = doc[i]!;
        if (b.type === "table-cell") {
            const meta = getTableCellMeta(b);
            if (meta && meta.row === 0 && meta.col === 0) {
                const { tableId, rowCount, colCount } = meta;
                const cells: Block[][] = Array.from({ length: rowCount }, () =>
                    new Array<Block>(colCount),
                );
                const indices: number[][] = Array.from({ length: rowCount }, () =>
                    new Array<number>(colCount).fill(-1),
                );
                let scanned = 0;
                for (let j = i; j < doc.length; j++) {
                    const cb = doc[j]!;
                    if (cb.type !== "table-cell") break;
                    const cm = getTableCellMeta(cb);
                    if (!cm || cm.tableId !== tableId) break;
                    if (cm.row < rowCount && cm.col < colCount) {
                        cells[cm.row]![cm.col] = cb;
                        indices[cm.row]![cm.col] = j;
                    }
                    scanned = j - i + 1;
                }
                out.push({ kind: "table", tableId, cells, indices });
                i += scanned;
                continue;
            }
            // Cell with bad/partial metadata: render standalone so the user
            // at least sees it instead of dropping it silently.
            out.push({ kind: "block", block: b, index: i });
            i++;
            continue;
        }
        out.push({ kind: "block", block: b, index: i });
        i++;
    }
    return out;
}

export function RenderedBlocks({ doc, renderers, markRenderers, inlineRenderers }: RenderedBlocksProps) {
    const items = useMemo(() => groupForRendering(doc), [doc]);
    return (
        <>
            {items.map((item) => {
                if (item.kind === "block") {
                    const { block, index } = item;
                    return (
                        <BlockView
                            key={block.id}
                            block={block}
                            index={index}
                            doc={doc}
                            renderer={renderers[block.type] ?? renderers.paragraph!}
                            markRenderers={markRenderers}
                            inlineRenderers={inlineRenderers}
                        />
                    );
                }
                return (
                    <TableGroup
                        key={item.tableId}
                        cells={item.cells}
                        indices={item.indices}
                        doc={doc}
                        renderers={renderers}
                        markRenderers={markRenderers}
                        inlineRenderers={inlineRenderers}
                    />
                );
            })}
        </>
    );
}

interface TableGroupProps {
    cells: Block[][];
    indices: number[][];
    doc: Doc;
    renderers: Record<string, BlockRenderer>;
    markRenderers: MarkRenderer[];
    inlineRenderers: InlineNodeRenderer[];
}

/**
 * Real <table>/<thead>/<tbody>/<tr> wrappers so the browser does the 2D
 * layout. Wrappers are `data-no-content` so the DOM walker skips them; only
 * the cells' inner `data-block-content` divs are walked.
 */
function TableGroup({ cells, indices, doc, renderers, markRenderers, inlineRenderers }: TableGroupProps) {
    const rowCount = cells.length;
    const renderRow = (row: Block[], indexRow: number[], rowKey: string) => (
        <tr key={rowKey} data-no-content="true">
            {row.map((cell, c) => {
                if (!cell) {
                    return <td key={c} data-no-content="true" className="mdedit-table-cell mdedit-table-cell-missing" />;
                }
                return (
                    <BlockView
                        key={cell.id}
                        block={cell}
                        index={indexRow[c]!}
                        doc={doc}
                        renderer={renderers[cell.type] ?? renderers.paragraph!}
                        markRenderers={markRenderers}
                        inlineRenderers={inlineRenderers}
                    />
                );
            })}
        </tr>
    );
    return (
        <table className="mdedit-table" data-no-content="true">
            {rowCount > 0 ? (
                <thead data-no-content="true">{renderRow(cells[0]!, indices[0]!, "head")}</thead>
            ) : null}
            {rowCount > 1 ? (
                <tbody data-no-content="true">
                    {cells.slice(1).map((row, r) => (
                        <Fragment key={r}>{renderRow(row, indices[r + 1]!, `body-${r}`)}</Fragment>
                    ))}
                </tbody>
            ) : null}
        </table>
    );
}
