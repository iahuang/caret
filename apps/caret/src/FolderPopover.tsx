import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Folder, File } from "lucide-react";
import { basename, dirname, isInside, listFolder, type FolderEntry } from "./fileNavigation";

interface FolderPopoverProps {
    anchor: HTMLElement;
    rootFolder: string;
    initialFolder: string;
    currentPath: string | null;
    onOpenFile: (path: string) => void;
    onClose: () => void;
}

export function FolderPopover({
    anchor,
    rootFolder,
    initialFolder,
    currentPath,
    onOpenFile,
    onClose,
}: FolderPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const [folder, setFolder] = useState(initialFolder);
    const [entries, setEntries] = useState<FolderEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    const trimmedRoot = useMemo(() => rootFolder.replace(/[\\/]+$/, ""), [rootFolder]);
    const atRoot = folder === trimmedRoot;

    // Load entries whenever the drilled folder changes.
    useEffect(() => {
        let cancelled = false;
        setEntries(null);
        setError(null);
        setSelectedIndex(0);
        listFolder(folder)
            .then((list) => {
                if (!cancelled) setEntries(list);
            })
            .catch((err) => {
                if (!cancelled) setError(String(err));
            });
        return () => {
            cancelled = true;
        };
    }, [folder]);

    // Position below anchor, left-aligned with it.
    useLayoutEffect(() => {
        function reposition() {
            const rect = anchor.getBoundingClientRect();
            const width = popoverRef.current?.offsetWidth ?? 280;
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
            setPos({ top: rect.bottom + 6, left });
        }
        reposition();
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
        };
    }, [anchor]);

    // Outside-click closes; same shape as SettingsPopover so clicks on the
    // anchor itself don't immediately re-trigger.
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            const target = e.target as Node;
            if (popoverRef.current?.contains(target)) return;
            if (anchor.contains(target)) return;
            onClose();
        }
        window.addEventListener("mousedown", onMouseDown);
        return () => window.removeEventListener("mousedown", onMouseDown);
    }, [anchor, onClose]);

    function activate(entry: FolderEntry) {
        if (entry.kind === "dir") {
            setFolder(entry.path);
            return;
        }
        // Decision: clicking the already-open file just closes the popover.
        if (entry.path === currentPath) {
            onClose();
            return;
        }
        onOpenFile(entry.path);
        onClose();
    }

    // Keyboard handling. Captured at window level so the popover doesn't need
    // focus to drive — keeps the editor's caret state untouched.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (!entries) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    onClose();
                }
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, entries.length - 1));
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, 0));
                return;
            }
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                if (atRoot) return; // Can't escape the window's root.
                const parent = dirname(folder);
                // Defensive: only ascend if the parent is still inside (or equal to) the root.
                if (parent === trimmedRoot || isInside(trimmedRoot, parent)) {
                    setFolder(parent);
                }
                return;
            }
            if (e.key === "ArrowRight") {
                // ArrowRight only descends into folders. Files require Enter
                // so the key doesn't double as a navigation+open shortcut.
                e.preventDefault();
                const entry = entries[selectedIndex];
                if (entry?.kind === "dir") activate(entry);
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                const entry = entries[selectedIndex];
                if (entry) activate(entry);
            }
        }
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [entries, selectedIndex, atRoot, folder, trimmedRoot, currentPath, onOpenFile, onClose]);

    const folderLabel = atRoot ? basename(trimmedRoot) : basename(folder);

    return (
        <div
            ref={popoverRef}
            role="dialog"
            aria-label={`Folder ${folderLabel}`}
            className="fixed z-50 w-72 rounded-lg border border-caret-border bg-caret-surface text-caret-text shadow-xl overflow-hidden"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos ? "visible" : "hidden",
            }}
        >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-caret-border text-xs text-caret-text">
                {!atRoot && (
                    <button
                        type="button"
                        aria-label="Up one level"
                        onClick={() => setFolder(dirname(folder))}
                        className="flex w-4 items-center justify-center rounded text-caret-text-muted hover:text-caret-text focus:outline-none focus:ring-1 focus:ring-caret-link"
                    >
                        <ArrowLeft size={13} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                )}
                <span className="truncate font-medium text-caret-text-muted" title={folder}>
                    {folderLabel}
                </span>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
                {entries === null && !error && (
                    <div className="px-3 py-2 text-xs text-caret-text-faint">Loading…</div>
                )}
                {error && (
                    <div className="px-3 py-2 text-xs text-caret-text-faint">
                        Could not read folder.
                    </div>
                )}
                {entries && entries.length === 0 && (
                    <div className="px-3 py-2 text-xs text-caret-text-faint">No files</div>
                )}
                {entries?.map((entry, i) => (
                    <EntryRow
                        key={entry.path}
                        entry={entry}
                        selected={i === selectedIndex}
                        isCurrent={entry.path === currentPath}
                        onClick={() => activate(entry)}
                    />
                ))}
            </div>
        </div>
    );
}

function EntryRow({
    entry,
    selected,
    isCurrent,
    onClick,
}: {
    entry: FolderEntry;
    selected: boolean;
    isCurrent: boolean;
    onClick: () => void;
}) {
    const Icon = entry.kind === "dir" ? Folder : File;
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-caret-border/50 focus:outline-none ${
                selected ? "bg-caret-border/50 text-caret-text" : ""
            }`}
        >
            <Icon size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{entry.name}</span>
            {isCurrent && (
                <span className="ml-auto text-[10px] text-caret-text-faint">open</span>
            )}
        </button>
    );
}
