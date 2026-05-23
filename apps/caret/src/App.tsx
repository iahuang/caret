import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Code, HelpCircle, Pencil, Settings as SettingsIcon } from "lucide-react";
import { createStore, parseMarkdown, serializeDoc, type FindOptions } from "mdedit/core";
import type { Store } from "mdedit/core";
import { Editor, defaultRenderers, useFind, type EditorHandle, type PopoverRenderer } from "mdedit/react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SettingsPopover, type Settings, defaultSettings, loadSettings, saveSettings } from "./Settings";
import { HelpPopover } from "./Help";
import { caretCodeBlockRenderer } from "./CodeBlockRenderer";
import { caretTableCellRenderer } from "./TableRenderer";
import { CaretMathPopover } from "./CaretMathPopover";
import { FindReplaceBar } from "./FindReplaceBar";
import { basename, dirname, isInside } from "./fileNavigation";
import { Breadcrumb, type BreadcrumbHandle } from "./Breadcrumb";
import { FolderPopover } from "./FolderPopover";
import { CommandPalette } from "./CommandPalette";

const INITIAL = `# A small pendulum

> *I am, you know, somewhat partial to slow things.*
> — Bachelard, *The Poetics of Space*

Last winter I hung a brass nut from the ceiling of my study, on a length of cotton thread fastened to a screw that had been holding up a calendar. It was the simplest experiment I could think of: a thread, a weight at the end, a hand to start it moving, and a clock.

My equipment was modest:

- a brass hex nut, perhaps twenty grams
- about 0.9 m of cotton thread
- the calendar screw, demoted
- a kitchen clock with a second hand

## What I expected

For small angles the period of a simple pendulum depends only on its length:

$$
T = 2\\pi\\sqrt{\\frac{L}{g}}
$$

A result that grows more astonishing the longer you sit with it. The *mass* of the bob does not appear; nor does the *amplitude*, provided it stays small. The thread's length $L$ and the local gravitational acceleration $g \\approx 9.81~\\text{m/s}^2$ are enough. With $L = 0.9~\\text{m}$ the formula gives $T \\approx 1.9~\\text{s}$.

## What I measured

I let the pendulum swing through twenty full periods and divided the total time by twenty. I did this five times.

| Trial | Total time (s) | Period (s) | Deviation |
| :---: | -------------: | ---------: | --------: |
|   1   |          37.92 |      1.896 |    −0.4 % |
|   2   |          38.10 |      1.905 |    +0.0 % |
|   3   |          38.04 |      1.902 |    −0.2 % |
|   4   |          38.16 |      1.908 |    +0.2 % |
|   5   |          38.07 |      1.904 |    −0.1 % |

The agreement, for a kitchen clock and a hex nut, was better than I deserved.

## A numerical check

When the small-angle approximation $\\sin\\theta \\approx \\theta$ **stops holding**, the period grows with amplitude. The exact period is a complete elliptic integral; I find it easier to integrate the equation of motion directly, with a step \`dt = 1e-4\`:

\`\`\`typescript
function periodOf(theta0: number, L = 1, g = 9.81): number {
    const dt = 1e-4;
    let theta = theta0;
    let omega = 0;
    let t = 0;
    while (true) {
        const prev = theta;
        omega += -(g / L) * Math.sin(theta) * dt;
        theta += omega * dt;
        t += dt;
        if (theta < 0 && prev >= 0) return 4 * t;
    }
}
\`\`\`

At $\\theta_0 = 5°$ the function returns the small-angle answer to four places. At $60°$ the period comes out roughly seven percent longer — small enough to miss with a kitchen clock, large enough to matter to a clockmaker.

---

## Notes to myself

Things I'd do again, in order:

1. Twenty periods, not one. The error in starting the clock divides by twenty.
2. Time the swing past the *lowest* point, where the bob is fastest and the start and stop are sharpest.
3. ~~Trust the clock.~~ Trust the *count*.

Things I'd still like to try:

- [x] Time twenty swings instead of one.
- [ ] A heavier bob, in case ~~mass matters~~ I am wrong about it.
- [ ] A longer thread — long enough to see the plane of the swing precess.
- [ ] The whole thing in a stairwell, [Foucault](https://en.wikipedia.org/wiki/Foucault_pendulum)-style, if I can find one tall enough.

I have begun to suspect that all the difficulty in physics is in *measuring well* — that the equations are the easy part.
`;

const MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];

function makeStore(content: string): Store {
    const doc = parseMarkdown(content);
    return createStore({
        initialState: {
            doc,
            selection: doc[0]
                ? {
                      anchor: { blockId: doc[0].id, offset: 0 },
                      focus: { blockId: doc[0].id, offset: 0 },
                  }
                : null,
        },
    });
}

type DiscardAction = "save" | "discard" | "cancel";

// Only the main window seeds the welcome doc; windows spawned via Cmd+N start blank.
const IS_MAIN_WINDOW = getCurrentWindow().label === "main";

// Path passed in via `?path=…` when a window is spawned to open a Finder file.
// Read once at module load — the query string never changes for a given window.
const SEEDED_PATH: string | null = (() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("path");
})();

function openNewWindow(path?: string): void {
    const label = `editor-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const url = path ? `index.html?path=${encodeURIComponent(path)}` : "index.html";
    new WebviewWindow(label, {
        url,
        title: "Caret",
        width: 1100,
        height: 720,
        minWidth: 600,
        minHeight: 400,
        titleBarStyle: "overlay",
        hiddenTitle: true,
        trafficLightPosition: new LogicalPosition(16, 18),
    });
}

export function App() {
    const [store, setStore] = useState<Store>(() => makeStore(IS_MAIN_WINDOW ? INITIAL : ""));
    const [storeKey, setStoreKey] = useState(0);
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [rootFolder, setRootFolder] = useState<string | null>(null);
    const [savedMarkdown, setSavedMarkdown] = useState(() => serializeDoc(store.getState().doc));
    const [markdown, setMarkdown] = useState(savedMarkdown);

    useEffect(() => {
        setMarkdown(serializeDoc(store.getState().doc));
        return store.subscribe(() => {
            setMarkdown(serializeDoc(store.getState().doc));
        });
    }, [store]);

    const isDirty = markdown !== savedMarkdown;

    const [settings, setSettings] = useState<Settings>(loadSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [view, setView] = useState<"rich" | "raw">("rich");
    const settingsButtonRef = useRef<HTMLButtonElement>(null);
    const helpButtonRef = useRef<HTMLButtonElement>(null);

    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQuery] = useState("");
    const [replaceText, setReplaceText] = useState("");
    const [findOptions, setFindOptions] = useState<FindOptions>({});
    const editorRef = useRef<EditorHandle>(null);

    const [paletteOpen, setPaletteOpen] = useState(false);
    const [folderPopover, setFolderPopover] = useState<
        { anchor: HTMLElement; folderPath: string } | null
    >(null);
    const breadcrumbRef = useRef<BreadcrumbHandle>(null);

    const find = useFind({
        store,
        query: findQuery,
        options: findOptions,
        enabled: findOpen && view === "rich",
    });

    const decorations = useMemo(
        () => ({ matches: find.matches, activeIndex: find.activeIndex }),
        [find.matches, find.activeIndex],
    );

    const closeFind = useCallback(() => {
        setFindOpen(false);
        // Hand focus back to the editor so typing resumes immediately.
        editorRef.current?.focus();
    }, []);

    const openFind = useCallback(() => {
        if (view !== "rich") return;
        if (findOpen) return; // already open — don't clobber the user's query
        // Seed the find input with the current single-block selection, if any.
        // Skip selections that cross blocks, are collapsed, contain a newline,
        // or contain an atom placeholder (￼ never appears in a real query).
        const sel = store.getState().selection;
        if (sel && sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset !== sel.focus.offset) {
            const block = store.getState().doc.find((b) => b.id === sel.focus.blockId);
            if (block) {
                const lo = Math.min(sel.anchor.offset, sel.focus.offset);
                const hi = Math.max(sel.anchor.offset, sel.focus.offset);
                const seed = block.content.slice(lo, hi);
                if (seed && !/[\n￼]/.test(seed)) {
                    setFindQuery(seed);
                }
            }
        }
        setFindOpen(true);
    }, [store, view, findOpen]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            const mod = navigator.platform.match(/Mac|iP/) ? e.metaKey : e.ctrlKey;
            if (!mod) return;
            if (e.key.toLowerCase() === "f" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                openFind();
                return;
            }
            if (findOpen && e.key.toLowerCase() === "g") {
                e.preventDefault();
                if (e.shiftKey) find.prev();
                else find.next();
            }
            if (e.key.toLowerCase() === "p" && !e.shiftKey && !e.altKey) {
                // Always swallow Cmd+P so the OS print dialog never appears in
                // an editor window, even before the window has a root.
                e.preventDefault();
                if (rootFolder === null) return;
                setFolderPopover(null);
                setPaletteOpen(true);
            }
            if (e.key.toLowerCase() === "b" && e.shiftKey && !e.altKey) {
                if (rootFolder === null) return;
                e.preventDefault();
                setPaletteOpen(false);
                breadcrumbRef.current?.openInnermost();
            }
        }
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [openFind, findOpen, find, rootFolder]);

    const editorRenderers = useMemo(
        () => ({
            ...defaultRenderers,
            "code-block": caretCodeBlockRenderer,
            "table-cell": caretTableCellRenderer,
        }),
        [],
    );

    const renderPopover = useMemo<PopoverRenderer>(
        () => (ctx) => {
            if (ctx.kind === "block" && ctx.block.type === "math-block") {
                const latex = (ctx.block.metadata?.latex as string | undefined) ?? "";
                return (
                    <CaretMathPopover
                        anchorSelector={`[data-block-id="${ctx.block.id}"]`}
                        value={latex}
                        editing={ctx.editing}
                        onChange={(next) => ctx.onChange({ latex: next })}
                        onStartEditing={ctx.onStartEditing}
                        onDoneEditing={ctx.onDoneEditing}
                        onExitLeft={ctx.onExitLeft}
                        onExitRight={ctx.onExitRight}
                        onDelete={ctx.onDelete}
                        containerRef={ctx.containerRef}
                        anchorAlignment="center"
                    />
                );
            }
            if (ctx.kind === "inline" && ctx.atom.type === "math") {
                const latex = (ctx.atom.data.latex as string | undefined) ?? "";
                return (
                    <CaretMathPopover
                        anchorSelector={`[data-atom-id="${ctx.atom.id}"]`}
                        value={latex}
                        editing={ctx.editing}
                        onChange={(next) => ctx.onChange({ latex: next })}
                        onStartEditing={ctx.onStartEditing}
                        onDoneEditing={ctx.onDoneEditing}
                        onExitLeft={ctx.onExitLeft}
                        onExitRight={ctx.onExitRight}
                        onDelete={ctx.onDelete}
                        containerRef={ctx.containerRef}
                    />
                );
            }
            return undefined;
        },
        [],
    );

    const handleViewChange = useCallback(
        (next: "rich" | "raw") => {
            setView((prev) => {
                if (prev === "raw" && next === "rich") {
                    const fromStore = serializeDoc(store.getState().doc);
                    if (markdown !== fromStore) {
                        const replacement = makeStore(markdown);
                        setStore(replacement);
                        setStoreKey((k) => k + 1);
                    }
                }
                return next;
            });
        },
        [markdown, store],
    );

    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute("data-theme", settings.theme);
        root.setAttribute("data-font", settings.font);
        root.style.setProperty("--caret-font-size", `${settings.fontSize}px`);
        saveSettings(settings);
    }, [settings]);

    const [discardPrompt, setDiscardPrompt] = useState<{
        resolve: (action: DiscardAction) => void;
    } | null>(null);

    // Tracked outside state so a second caller during the same tick still sees
    // the open prompt — `setDiscardPrompt` updates wouldn't be visible yet.
    const discardPromptPending = useRef(false);

    const confirmDiscard = useCallback((): Promise<DiscardAction> => {
        // A prompt is already up; treat the duplicate request as a cancel so
        // the caller bails cleanly instead of clobbering the live resolver.
        if (discardPromptPending.current) return Promise.resolve("cancel");
        discardPromptPending.current = true;
        return new Promise((resolve) => {
            setDiscardPrompt({
                resolve: (action) => {
                    discardPromptPending.current = false;
                    setDiscardPrompt(null);
                    resolve(action);
                },
            });
        });
    }, []);

    const loadDoc = useCallback((content: string, path: string | null) => {
        const next = makeStore(content);
        const baseline = serializeDoc(next.getState().doc);
        setStore(next);
        setCurrentPath(path);
        setSavedMarkdown(baseline);
        setMarkdown(baseline);
        setStoreKey((k) => k + 1);
    }, []);

    // Action refs let the window-level keydown listener and the close-requested
    // handler reach the latest closures without re-binding on every keystroke.
    const actionsRef = useRef<{
        newFile: () => Promise<void>;
        newWindow: () => Promise<void>;
        openFile: () => Promise<void>;
        saveFile: () => Promise<boolean>;
        saveAsFile: () => Promise<boolean>;
        confirmAndClose: () => Promise<void>;
    }>({
        newFile: async () => {},
        newWindow: async () => {},
        openFile: async () => {},
        saveFile: async () => false,
        saveAsFile: async () => false,
        confirmAndClose: async () => {},
    });

    // Gate any action that replaces the current buffer. Returns false if the
    // user cancelled or a save attempt failed.
    const confirmIfDirty = useCallback(async (): Promise<boolean> => {
        if (!isDirty) return true;
        const action = await confirmDiscard();
        if (action === "cancel") return false;
        if (action === "save") {
            const ok = await actionsRef.current.saveFile();
            if (!ok) return false;
        }
        return true;
    }, [isDirty, confirmDiscard]);

    // Single funnel for "load this path into the current window". reroot=true
    // is for Cmd+O (changes the window's root). Breadcrumb / Cmd+P navigation
    // passes reroot=false so the window stays anchored.
    const openPathInWindow = useCallback(
        async (path: string, opts: { reroot: boolean }) => {
            if (!(await confirmIfDirty())) return;
            const content = await readTextFile(path);
            loadDoc(content, path);
            if (opts.reroot) setRootFolder(dirname(path));
        },
        [confirmIfDirty, loadDoc],
    );

    actionsRef.current.saveAsFile = async () => {
        const picked = await saveDialog({
            defaultPath: currentPath ?? "untitled.md",
            filters: MARKDOWN_FILTERS,
        });
        if (!picked) return false;
        await writeTextFile(picked, markdown);
        setCurrentPath(picked);
        setSavedMarkdown(markdown);
        // Reroot only when Save-As escapes the current root, or there is no
        // root yet (first save in a fresh window).
        if (rootFolder === null || !isInside(rootFolder, picked)) {
            setRootFolder(dirname(picked));
        }
        return true;
    };

    actionsRef.current.saveFile = async () => {
        if (!currentPath) return actionsRef.current.saveAsFile();
        await writeTextFile(currentPath, markdown);
        setSavedMarkdown(markdown);
        return true;
    };

    actionsRef.current.newFile = async () => {
        // In-window "New File": clears the buffer but keeps the window's root,
        // so the breadcrumb still reads "<root> / Untitled".
        if (!(await confirmIfDirty())) return;
        loadDoc("", null);
    };

    actionsRef.current.newWindow = async () => {
        openNewWindow();
    };

    actionsRef.current.openFile = async () => {
        // Pre-flight confirm so the user isn't asked to save mid-dialog.
        if (!(await confirmIfDirty())) return;
        const picked = await openDialog({
            multiple: false,
            directory: false,
            filters: MARKDOWN_FILTERS,
        });
        if (typeof picked !== "string") return;
        await openPathInWindow(picked, { reroot: true });
    };

    actionsRef.current.confirmAndClose = async () => {
        if (!(await confirmIfDirty())) return;
        await getCurrentWindow().destroy();
    };

    useEffect(() => {
        // Scope to this webview — `listen()` from @tauri-apps/api/event defaults
        // to target `Any`, which receives events emitted to any label.
        const win = getCurrentWebviewWindow();
        const unlisteners = Promise.all([
            win.listen("menu:new_file", () => void actionsRef.current.newFile()),
            win.listen("menu:new_window", () => void actionsRef.current.newWindow()),
            win.listen("menu:open_file", () => void actionsRef.current.openFile()),
            win.listen("menu:save_file", () => void actionsRef.current.saveFile()),
            win.listen("menu:save_as_file", () => void actionsRef.current.saveAsFile()),
        ]);
        return () => {
            void unlisteners.then((fns) => fns.forEach((fn) => fn()));
        };
    }, []);

    // Drain Finder/Open-with paths queued in Rust. Runs on mount (cold launch
    // with a file) and on every `caret:drain_paths` nudge (warm open).
    useEffect(() => {
        async function drain() {
            const paths = await invoke<string[]>("take_pending_paths");
            if (paths.length === 0) return;
            // Snapshot emptiness once: state updates from the first load don't
            // propagate within this loop, so re-checking per iteration would
            // be misleading. The first path may reuse this window if it's
            // empty+clean; the rest always spawn fresh windows.
            const reuseFirst = currentPath === null && !isDirty;
            for (let i = 0; i < paths.length; i++) {
                const path = paths[i]!;
                if (i === 0 && reuseFirst) {
                    await openPathInWindow(path, { reroot: true });
                } else {
                    openNewWindow(path);
                }
            }
        }
        void drain();
        const win = getCurrentWebviewWindow();
        const unlistenPromise = win.listen("caret:drain_paths", () => void drain());
        return () => {
            void unlistenPromise.then((fn) => fn());
        };
        // Intentionally run once: `drain()` snapshots state itself, and the
        // listener should outlive every dirty/path transition.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Spawned windows (Cmd+N with a path, or a Finder open routed to a new
    // window) carry their target file in `?path=…`. Load it once on mount.
    useEffect(() => {
        if (!SEEDED_PATH) return;
        void openPathInWindow(SEEDED_PATH, { reroot: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const win = getCurrentWindow();
        const unlistenPromise = win.onCloseRequested(async (event) => {
            event.preventDefault();
            void actionsRef.current.confirmAndClose();
        });
        return () => {
            void unlistenPromise.then((fn) => fn());
        };
    }, []);

    const displayName = currentPath ? basename(currentPath) : "Untitled";

    return (
        <div className="flex h-full flex-col bg-caret-bg text-caret-text">
            <header
                data-tauri-drag-region
                className="flex items-center gap-3 bg-caret-surface py-[7px] pl-[92px] pr-3"
            >
                <Breadcrumb
                    ref={breadcrumbRef}
                    rootFolder={rootFolder}
                    currentPath={currentPath}
                    isDirty={isDirty}
                    onSegmentClick={(folderPath, anchor) => {
                        setPaletteOpen(false);
                        setFolderPopover({ folderPath, anchor });
                    }}
                />
                <div data-tauri-drag-region className="ml-auto flex items-center gap-1.5">
                    <ViewToggle value={view} onChange={handleViewChange} />
                    <button
                        ref={helpButtonRef}
                        type="button"
                        aria-label="Help"
                        aria-haspopup="dialog"
                        aria-expanded={helpOpen}
                        onClick={() => {
                            setSettingsOpen(false);
                            setHelpOpen((v) => !v);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-caret-text-faint transition-colors hover:bg-caret-border hover:text-caret-text focus:outline-none focus:ring-1 focus:ring-caret-link"
                    >
                        <HelpCircle size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <button
                        ref={settingsButtonRef}
                        type="button"
                        aria-label="Settings"
                        aria-haspopup="dialog"
                        aria-expanded={settingsOpen}
                        onClick={() => {
                            setHelpOpen(false);
                            setSettingsOpen((v) => !v);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-caret-text-faint transition-colors hover:bg-caret-border hover:text-caret-text focus:outline-none focus:ring-1 focus:ring-caret-link"
                    >
                        <SettingsIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                </div>
            </header>
            <main className="min-h-0 flex-1 overflow-auto bg-caret-surface px-10 py-10">
                {view === "rich" ? (
                    <Editor
                        key={storeKey}
                        ref={editorRef}
                        store={store}
                        renderers={editorRenderers}
                        renderPopover={renderPopover}
                        decorations={findOpen ? decorations : undefined}
                        className="mx-auto max-w-[720px]"
                    />
                ) : (
                    <SourceEditor value={markdown} onChange={setMarkdown} />
                )}
            </main>
            {findOpen && view === "rich" && (
                <div className="fixed right-6 top-12 z-40">
                    <FindReplaceBar
                        query={findQuery}
                        onQueryChange={setFindQuery}
                        replaceText={replaceText}
                        onReplaceTextChange={setReplaceText}
                        options={findOptions}
                        onOptionsChange={setFindOptions}
                        matches={find.matches}
                        activeIndex={find.activeIndex}
                        onNext={find.next}
                        onPrev={find.prev}
                        onReplace={() => find.replaceCurrent(replaceText)}
                        onReplaceAll={() => find.replaceAll(replaceText)}
                        onClose={closeFind}
                    />
                </div>
            )}
            {settingsOpen && (
                <SettingsPopover
                    anchorRef={settingsButtonRef}
                    settings={settings}
                    onChange={setSettings}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
            {helpOpen && (
                <HelpPopover
                    anchorRef={helpButtonRef}
                    onClose={() => setHelpOpen(false)}
                />
            )}
            {discardPrompt && (
                <UnsavedChangesDialog
                    filename={displayName}
                    onAction={discardPrompt.resolve}
                />
            )}
            {folderPopover && rootFolder !== null && (
                <FolderPopover
                    anchor={folderPopover.anchor}
                    rootFolder={rootFolder}
                    initialFolder={folderPopover.folderPath}
                    currentPath={currentPath}
                    onOpenFile={(path) => {
                        void openPathInWindow(path, { reroot: false });
                    }}
                    onClose={() => setFolderPopover(null)}
                />
            )}
            {paletteOpen && rootFolder !== null && (
                <CommandPalette
                    rootFolder={rootFolder}
                    currentPath={currentPath}
                    onOpenFile={(path) => {
                        void openPathInWindow(path, { reroot: false });
                    }}
                    onClose={() => setPaletteOpen(false)}
                />
            )}
        </div>
    );
}

function ViewToggle({ value, onChange }: { value: "rich" | "raw"; onChange: (v: "rich" | "raw") => void }) {
    const baseClass =
        "flex h-6 items-center gap-1.5 px-2 text-[11px] font-medium leading-none transition-colors focus:outline-none focus:ring-1 focus:ring-caret-link";
    const activeClass = "bg-caret-border text-caret-text";
    const inactiveClass = "text-caret-text-faint hover:text-caret-text";
    return (
        <div
            className="flex overflow-hidden rounded-md border border-caret-border"
            role="tablist"
            aria-label="View mode"
        >
            <button
                type="button"
                role="tab"
                aria-selected={value === "rich"}
                onClick={() => onChange("rich")}
                className={`${baseClass} ${value === "rich" ? activeClass : inactiveClass}`}
            >
                <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={value === "raw"}
                onClick={() => onChange("raw")}
                className={`${baseClass} border-l border-caret-border ${value === "raw" ? activeClass : inactiveClass}`}
            >
                <Code size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
        </div>
    );
}

function SourceEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const ref = useRef<HTMLTextAreaElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    return (
        <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="mx-auto block w-full max-w-[720px] resize-none whitespace-pre-wrap break-words border-0 bg-transparent p-0 font-mono text-[13px] leading-[1.55] outline-none focus:outline-none focus:ring-0"
        />
    );
}

function UnsavedChangesDialog({
    filename,
    onAction,
}: {
    filename: string;
    onAction: (action: DiscardAction) => void;
}) {
    const saveBtnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        saveBtnRef.current?.focus();
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") {
                e.preventDefault();
                onAction("cancel");
            } else if (e.key === "Enter") {
                e.preventDefault();
                onAction("save");
            }
        }
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onAction]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-dialog-title"
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onAction("cancel");
            }}
        >
            <div className="w-[360px] rounded-lg border border-caret-border bg-caret-surface p-5 text-caret-text shadow-2xl">
                <div id="unsaved-dialog-title" className="mb-1 text-sm font-semibold">
                    Save changes to {filename}?
                </div>
                <p className="mb-5 text-xs leading-relaxed text-caret-text-muted">
                    Your changes will be lost if you don't save them.
                </p>
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => onAction("discard")}
                        className="rounded-md px-3 py-1.5 text-xs text-caret-text-faint transition-colors hover:bg-caret-border hover:text-caret-text focus:outline-none focus:ring-1 focus:ring-caret-link"
                    >
                        Don't save
                    </button>
                    <button
                        type="button"
                        onClick={() => onAction("cancel")}
                        className="rounded-md border border-caret-border bg-caret-surface-soft px-3 py-1.5 text-xs text-caret-text transition-colors hover:bg-caret-border focus:outline-none focus:ring-1 focus:ring-caret-link"
                    >
                        Cancel
                    </button>
                    <button
                        ref={saveBtnRef}
                        type="button"
                        onClick={() => onAction("save")}
                        className="rounded-md bg-caret-link px-3 py-1.5 text-xs font-medium text-white transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-caret-link focus:ring-offset-1"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

export { defaultSettings };
