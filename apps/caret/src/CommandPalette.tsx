import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { basename, fuzzyScore, walkMdFiles } from "./fileNavigation";

interface CommandPaletteProps {
    rootFolder: string;
    currentPath: string | null;
    onOpenFile: (path: string) => void;
    onClose: () => void;
}

interface FileEntry {
    path: string;
    relative: string;
}

const MAX_VISIBLE = 50;

export function CommandPalette({
    rootFolder,
    currentPath,
    onOpenFile,
    onClose,
}: CommandPaletteProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const paletteRef = useRef<HTMLDivElement>(null);
    const [files, setFiles] = useState<FileEntry[] | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
        let cancelled = false;
        walkMdFiles(rootFolder)
            .then((result) => {
                if (cancelled) return;
                setFiles(result.files);
                setTruncated(result.truncated);
            })
            .catch(() => {
                if (!cancelled) setFiles([]);
            });
        return () => {
            cancelled = true;
        };
    }, [rootFolder]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // No backdrop overlay now — close on any mousedown outside the palette.
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            const target = e.target as Node;
            if (paletteRef.current?.contains(target)) return;
            onClose();
        }
        window.addEventListener("mousedown", onMouseDown);
        return () => window.removeEventListener("mousedown", onMouseDown);
    }, [onClose]);

    // Score + sort + cap, recomputed on every keystroke. Cheap enough at this scale.
    const matches = useMemo(() => {
        if (!files) return [];
        if (!query) {
            // Empty query: show all files, alphabetic by relative path. Cap at MAX_VISIBLE.
            const sorted = [...files].sort((a, b) =>
                a.relative.localeCompare(b.relative, undefined, { sensitivity: "base" }),
            );
            return sorted.slice(0, MAX_VISIBLE).map((f) => ({ file: f, indices: [] as number[] }));
        }
        const scored: { file: FileEntry; score: number; indices: number[] }[] = [];
        for (const f of files) {
            const result = fuzzyScore(query, f.relative);
            if (result) scored.push({ file: f, score: result.score, indices: result.indices });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, MAX_VISIBLE).map(({ file, indices }) => ({ file, indices }));
    }, [files, query]);

    // Clamp selection when results shrink.
    useEffect(() => {
        if (selectedIndex >= matches.length) setSelectedIndex(0);
    }, [matches.length, selectedIndex]);

    // Keep the selected row scrolled into view.
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const row = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
        if (row) row.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    function activate(file: FileEntry) {
        if (file.path === currentPath) {
            onClose();
            return;
        }
        onOpenFile(file.path);
        onClose();
    }

    function onKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, matches.length - 1));
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            const m = matches[selectedIndex];
            if (m) activate(m.file);
        }
    }

    const rootName = basename(rootFolder.replace(/[\\/]+$/, ""));
    const placeholder =
        files === null
            ? `Indexing files in ${rootName}…`
            : `Search files in ${rootName}…`;

    return (
        <div
            ref={paletteRef}
            role="dialog"
            aria-label="Open file by name"
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[520px] max-w-[90vw] overflow-hidden rounded-lg border border-caret-border bg-caret-surface text-caret-text shadow-2xl"
        >
            <div className="relative border-b border-caret-border">
                <Search
                    size={13}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-caret-text-faint"
                />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setSelectedIndex(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    spellCheck={false}
                    className="w-full bg-transparent pl-9 pr-4 py-2 text-sm placeholder-caret-text-faint outline-none"
                />
            </div>
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
                {files === null && (
                    <div className="px-4 py-2 text-xs text-caret-text-faint">Indexing…</div>
                )}
                {files !== null && matches.length === 0 && (
                    <div className="px-4 py-2 text-xs text-caret-text-faint">
                        {files.length === 0 ? "No markdown files in root." : "No matches."}
                    </div>
                )}
                {matches.map((m, i) => (
                    <MatchRow
                        key={m.file.path}
                        relative={m.file.relative}
                        indices={m.indices}
                        selected={i === selectedIndex}
                        isCurrent={m.file.path === currentPath}
                        index={i}
                        onMouseEnter={() => setSelectedIndex(i)}
                        onClick={() => activate(m.file)}
                    />
                ))}
            </div>
            {truncated && (
                <div className="border-t border-caret-border px-4 py-1.5 text-[10px] text-caret-text-faint">
                    Index truncated at 5000 files.
                </div>
            )}
        </div>
    );
}

function MatchRow({
    relative,
    indices,
    selected,
    isCurrent,
    index,
    onMouseEnter,
    onClick,
}: {
    relative: string;
    indices: number[];
    selected: boolean;
    isCurrent: boolean;
    index: number;
    onMouseEnter: () => void;
    onClick: () => void;
}) {
    // Split "src/foo/bar.md" into the parent path ("src/foo/", indices 0..7)
    // and the filename ("bar.md", indices 8..). Files at the root have no path.
    const lastSep = Math.max(relative.lastIndexOf("/"), relative.lastIndexOf("\\"));
    const pathLen = lastSep + 1;
    const filename = relative.slice(pathLen);
    const path = relative.slice(0, pathLen);
    const pathIndices: number[] = [];
    const filenameIndices: number[] = [];
    for (const i of indices) {
        if (i < pathLen) pathIndices.push(i);
        else filenameIndices.push(i - pathLen);
    }

    return (
        <button
            type="button"
            data-index={index}
            onMouseEnter={onMouseEnter}
            // Use mousedown so focus doesn't shift away from the input before click fires.
            onMouseDown={(e) => {
                e.preventDefault();
                onClick();
            }}
            className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-xs text-left focus:outline-none ${
                selected ? "bg-caret-border" : ""
            }`}
        >
            <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
                {/* flex-shrink ratio: path (99) shrinks ~99× faster than the
                    filename (1), so the path truncates first and the filename
                    only loses chars when there's no room left. */}
                <span className="min-w-0 truncate text-caret-text">
                    {renderHighlighted(filename, filenameIndices)}
                </span>
                {path && (
                    <span
                        className="min-w-0 truncate text-[11px] text-caret-text-faint"
                        style={{ flexShrink: 99 }}
                    >
                        {renderHighlighted(path, pathIndices)}
                    </span>
                )}
            </div>
            {isCurrent && (
                <span className="shrink-0 text-[10px] text-caret-text-faint">open</span>
            )}
        </button>
    );
}

function renderHighlighted(text: string, indices: number[]) {
    if (indices.length === 0) return text;
    const set = new Set(indices);
    const out: React.ReactNode[] = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (set.has(i)) {
            out.push(
                <span key={i} className="text-caret-link font-medium">
                    {ch}
                </span>,
            );
        } else {
            out.push(ch);
        }
    }
    return out;
}
