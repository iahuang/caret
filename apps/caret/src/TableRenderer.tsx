import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    ArrowDownToLine,
    ArrowUpToLine,
    Check,
    ChevronRight,
    Columns3,
    Trash2,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    deleteCol,
    deleteRow,
    getTableCellMeta,
    insertColLeft,
    insertColRight,
    insertRowAbove,
    insertRowBelow,
    setColAlignment,
    type ColAlignment,
} from "mdedit/core";
import { useEditorActions, type BlockRenderer } from "mdedit/react";
import {
    MeatballMenu,
    meatballMenuContentClass,
    meatballMenuIconClass,
    meatballMenuItemClass,
    stopMouseDown,
} from "./MeatballMenu";

function alignmentStyle(a: ColAlignment): React.CSSProperties | undefined {
    if (a === "left") return { textAlign: "left" };
    if (a === "center") return { textAlign: "center" };
    if (a === "right") return { textAlign: "right" };
    return undefined;
}

/**
 * Caret's table cell renderer. Mirrors the default `tableCellRenderer` but the
 * (0,0) cell also mounts a `<TableMenuOverlay>` — one floating, cursor-tracking
 * meatball menu per table. The overlay finds the surrounding `<table>` element
 * with `closest()` so it doesn't need any structural changes to `TableGroup`.
 */
export const caretTableCellRenderer: BlockRenderer = ({ block, content }) => {
    const meta = getTableCellMeta(block);
    const align = meta?.alignment[meta.col] ?? null;
    const Tag = meta?.isHeader ? "th" : "td";
    const isAnchor = meta && meta.row === 0 && meta.col === 0;
    return (
        <Tag
            data-block-id={block.id}
            data-block-type={block.type}
            className={`mdedit-table-cell${meta?.isHeader ? " mdedit-table-cell-header" : ""}`}
            style={alignmentStyle(align)}
        >
            <div data-block-content className="mdedit-table-cell-content">
                {content}
            </div>
            {isAnchor ? (
                <span data-no-content="true" contentEditable={false}>
                    <TableMenuOverlay />
                </span>
            ) : null}
        </Tag>
    );
};

interface EdgeAnchor {
    x: number;
    y: number;
    cellId: string;
    // Which side of `cellId` the meatball is anchored on. Determines whether
    // "Insert column here" maps to insertColLeft or insertColRight.
    side: "left" | "right";
    isHeaderRow: boolean;
}

interface TopAnchor {
    x: number;
    y: number;
    cellId: string;
    alignment: ColAlignment;
}

// Distance from a vertical cell edge (or header top edge) at which the menu
// becomes visible. Big enough to be discoverable, small enough that two edges
// don't conflict for narrow cells.
const HOVER_THRESHOLD_PX = 24;
// Extra margin around the table bbox for "still considered near the table".
const TABLE_HOVER_MARGIN_PX = 40;

function TableMenuOverlay() {
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [tableEl, setTableEl] = useState<HTMLTableElement | null>(null);
    const [edge, setEdge] = useState<EdgeAnchor | null>(null);
    const [top, setTop] = useState<TopAnchor | null>(null);
    const [edgeOpen, setEdgeOpen] = useState(false);
    const [topOpen, setTopOpen] = useState(false);

    // Look up the nearest <table> ancestor once on mount. The span is the
    // sibling of [data-block-content] inside the (0,0) cell, so `closest`
    // finds the table that wraps this cell group.
    useLayoutEffect(() => {
        const t = anchorRef.current?.closest("table") as HTMLTableElement | null;
        setTableEl(t);
    }, []);

    // Single mousemove listener. While either menu is open, freeze positions
    // so the meatball doesn't jump away from the cursor's click target.
    useEffect(() => {
        if (!tableEl) return;
        let raf = 0;
        function compute(e: MouseEvent) {
            if (edgeOpen || topOpen || !tableEl) return;
            const bbox = tableEl.getBoundingClientRect();
            const cx = e.clientX;
            const cy = e.clientY;
            const farX =
                cx < bbox.left - TABLE_HOVER_MARGIN_PX ||
                cx > bbox.right + TABLE_HOVER_MARGIN_PX;
            const farY =
                cy < bbox.top - TABLE_HOVER_MARGIN_PX ||
                cy > bbox.bottom + TABLE_HOVER_MARGIN_PX;
            if (farX || farY) {
                setEdge(null);
                setTop(null);
                return;
            }
            const cells = Array.from(
                tableEl.querySelectorAll<HTMLElement>(
                    "[data-block-type='table-cell']",
                ),
            );
            // Nearest vertical edge: walk every cell in the row containing
            // the cursor (vertically) and pick whichever of its left / right
            // edges is closest in X.
            let bestEdge: EdgeAnchor | null = null;
            let bestEdgeDist = Infinity;
            for (const cell of cells) {
                const r = cell.getBoundingClientRect();
                if (cy < r.top - 2 || cy > r.bottom + 2) continue;
                const cellId = cell.getAttribute("data-block-id") ?? "";
                if (!cellId) continue;
                const isHeader = readCellMeta(cell).isHeader;
                const dLeft = Math.abs(cx - r.left);
                if (dLeft < bestEdgeDist) {
                    bestEdgeDist = dLeft;
                    bestEdge = {
                        x: r.left,
                        y: r.top + r.height / 2,
                        cellId,
                        side: "left",
                        isHeaderRow: isHeader,
                    };
                }
                const dRight = Math.abs(cx - r.right);
                if (dRight < bestEdgeDist) {
                    bestEdgeDist = dRight;
                    bestEdge = {
                        x: r.right,
                        y: r.top + r.height / 2,
                        cellId,
                        side: "right",
                        isHeaderRow: isHeader,
                    };
                }
            }
            setEdge(bestEdgeDist <= HOVER_THRESHOLD_PX ? bestEdge : null);

            // Top-edge meatball for header cells: same dance but restricted
            // to the row-0 cells and their top edge.
            let bestTop: TopAnchor | null = null;
            let bestTopDist = Infinity;
            for (const cell of cells) {
                if (cell.tagName !== "TH") continue;
                const r = cell.getBoundingClientRect();
                if (cx < r.left - 2 || cx > r.right + 2) continue;
                const cellId = cell.getAttribute("data-block-id") ?? "";
                if (!cellId) continue;
                const dTop = Math.abs(cy - r.top);
                if (dTop < bestTopDist) {
                    bestTopDist = dTop;
                    bestTop = {
                        x: r.left + r.width / 2,
                        y: r.top,
                        cellId,
                        alignment: readCellMeta(cell).alignment,
                    };
                }
            }
            setTop(bestTopDist <= HOVER_THRESHOLD_PX ? bestTop : null);
        }
        function onMove(e: MouseEvent) {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => compute(e));
        }
        window.addEventListener("mousemove", onMove);
        return () => {
            window.removeEventListener("mousemove", onMove);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [tableEl, edgeOpen, topOpen]);

    return (
        <>
            <span ref={anchorRef} aria-hidden="true" style={{ display: "none" }} />
            {edge ? (
                <EdgeMeatball
                    anchor={edge}
                    open={edgeOpen}
                    onOpenChange={setEdgeOpen}
                />
            ) : null}
            {top ? (
                <TopMeatball
                    anchor={top}
                    open={topOpen}
                    onOpenChange={setTopOpen}
                />
            ) : null}
        </>
    );
}

// Cheap DOM-side read of just enough cell state for the menu — saves a
// round-trip into the block model. `isHeader` comes from the tag, alignment
// from the inline style the renderer wrote there.
function readCellMeta(cell: HTMLElement): { isHeader: boolean; alignment: ColAlignment } {
    const styleAlign = cell.style.textAlign;
    const alignment: ColAlignment =
        styleAlign === "left" || styleAlign === "center" || styleAlign === "right"
            ? styleAlign
            : null;
    return { isHeader: cell.tagName === "TH", alignment };
}

interface EdgeMeatballProps {
    anchor: EdgeAnchor;
    open: boolean;
    onOpenChange: (next: boolean) => void;
}

function EdgeMeatball({ anchor, open, onOpenChange }: EdgeMeatballProps) {
    return (
        <div
            style={{
                position: "fixed",
                left: anchor.x,
                top: anchor.y,
                transform: "translate(-50%, -50%)",
                zIndex: 60,
            }}
        >
            <MeatballMenu
                triggerLabel="Row and column actions"
                align="start"
                side="right"
                sideOffset={4}
                open={open}
                onOpenChange={onOpenChange}
            >
                <RowColMenuItems
                    cellId={anchor.cellId}
                    side={anchor.side}
                    isHeaderRow={anchor.isHeaderRow}
                />
            </MeatballMenu>
        </div>
    );
}

interface TopMeatballProps {
    anchor: TopAnchor;
    open: boolean;
    onOpenChange: (next: boolean) => void;
}

function TopMeatball({ anchor, open, onOpenChange }: TopMeatballProps) {
    return (
        <div
            style={{
                position: "fixed",
                left: anchor.x,
                top: anchor.y,
                transform: "translate(-50%, -50%)",
                zIndex: 60,
            }}
        >
            <MeatballMenu
                triggerLabel="Column actions"
                align="center"
                side="bottom"
                sideOffset={4}
                open={open}
                onOpenChange={onOpenChange}
            >
                <ColMenuItems cellId={anchor.cellId} alignment={anchor.alignment} />
            </MeatballMenu>
        </div>
    );
}

function RowColMenuItems({
    cellId,
    side,
    isHeaderRow,
}: {
    cellId: string;
    side: "left" | "right";
    isHeaderRow: boolean;
}) {
    const actions = useEditorActions();
    // Whichever cell edge the meatball is parked on picks the corresponding
    // insert direction — "left edge of cell X" and "right edge of cell X-1"
    // refer to the same gap.
    const insertColHere = side === "left" ? insertColLeft : insertColRight;
    return (
        <>
            <DropdownMenu.Item
                className={meatballMenuItemClass}
                onSelect={() => actions.dispatch((s) => insertColHere(s, cellId))}
            >
                <span className={meatballMenuIconClass}>
                    <Columns3 size={12} strokeWidth={1.75} aria-hidden="true" />
                </span>
                Insert column here
            </DropdownMenu.Item>
            <DropdownMenu.Item
                className={meatballMenuItemClass}
                onSelect={() => actions.dispatch((s) => insertRowBelow(s, cellId))}
            >
                <span className={meatballMenuIconClass}>
                    <ArrowDownToLine size={12} strokeWidth={1.75} aria-hidden="true" />
                </span>
                Insert row below
            </DropdownMenu.Item>
            {isHeaderRow ? null : (
                <DropdownMenu.Item
                    className={meatballMenuItemClass}
                    onSelect={() => actions.dispatch((s) => insertRowAbove(s, cellId))}
                >
                    <span className={meatballMenuIconClass}>
                        <ArrowUpToLine size={12} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    Insert row above
                </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
                className={meatballMenuItemClass}
                onSelect={() => actions.dispatch((s) => deleteRow(s, cellId))}
            >
                <span className={meatballMenuIconClass}>
                    <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                </span>
                Delete row
            </DropdownMenu.Item>
        </>
    );
}

const ALIGNMENT_OPTIONS: ReadonlyArray<{
    id: "left" | "center" | "right";
    label: string;
    Icon: typeof AlignLeft;
}> = [
    { id: "left", label: "Left", Icon: AlignLeft },
    { id: "center", label: "Center", Icon: AlignCenter },
    { id: "right", label: "Right", Icon: AlignRight },
];

function ColMenuItems({
    cellId,
    alignment,
}: {
    cellId: string;
    alignment: ColAlignment;
}) {
    const actions = useEditorActions();
    const currentAlignment = alignment ?? "";
    return (
        <>
            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className={meatballMenuItemClass}>
                    <span className={meatballMenuIconClass}>
                        <AlignLeft size={12} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span>Column alignment</span>
                    <span className="ml-auto inline-flex w-3 items-center justify-center text-caret-text-faint">
                        <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.SubContent
                        className={meatballMenuContentClass}
                        sideOffset={4}
                        onMouseDown={stopMouseDown}
                    >
                        <DropdownMenu.RadioGroup
                            value={currentAlignment}
                            onValueChange={(v) =>
                                actions.dispatch((s) =>
                                    setColAlignment(
                                        s,
                                        v === "" ? null : (v as ColAlignment),
                                        cellId,
                                    ),
                                )
                            }
                        >
                            {ALIGNMENT_OPTIONS.map(({ id, label, Icon }) => (
                                <DropdownMenu.RadioItem
                                    key={id}
                                    value={id}
                                    className={meatballMenuItemClass}
                                >
                                    <span className="inline-flex w-3.5 items-center justify-center text-caret-text">
                                        <DropdownMenu.ItemIndicator>
                                            <Check
                                                size={12}
                                                strokeWidth={2.25}
                                                aria-hidden="true"
                                            />
                                        </DropdownMenu.ItemIndicator>
                                    </span>
                                    <Icon size={12} strokeWidth={1.75} aria-hidden="true" />
                                    {label}
                                </DropdownMenu.RadioItem>
                            ))}
                        </DropdownMenu.RadioGroup>
                    </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Item
                className={meatballMenuItemClass}
                onSelect={() => actions.dispatch((s) => deleteCol(s, cellId))}
            >
                <span className={meatballMenuIconClass}>
                    <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
                </span>
                Delete column
            </DropdownMenu.Item>
        </>
    );
}
