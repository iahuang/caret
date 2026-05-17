import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Code, Pencil, Settings as SettingsIcon } from "lucide-react";
import { createStore, parseMarkdown, serializeDoc } from "mdedit/core";
import type { Store } from "mdedit/core";
import { Editor, defaultRenderers } from "mdedit/react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SettingsPopover, type Settings, defaultSettings, loadSettings, saveSettings } from "./Settings";
import { caretCodeBlockRenderer } from "./CodeBlockRenderer";
import { caretTableCellRenderer } from "./TableRenderer";

const INITIAL = `# Caret

A native markdown editor built on [mdedit](./).

## What works

- Paragraphs, headings, *bullet* and ordered lists, blockquotes
- Inline marks: **bold**, *italic*, \`code\`, ~~strike~~
- Mouse selection (drag), arrow-key navigation across wraps
- Markdown shortcuts: type \`# \`, \`## \`, \`- \`, \`1. \`, or \`> \` at the start of a line

## Keyboard

- **Cmd/Ctrl-B** bold, **-I** italic, **-E** code, **-Shift-X** strike
- **Cmd/Ctrl-Alt-1..6** headings, **-Alt-0** paragraph
- **Cmd/Ctrl-Shift-8** bullet list, **-Shift-7** ordered list
- **Cmd/Ctrl-Z** undo, **-Shift-Z** redo
- **Cmd/Ctrl-N** new window, **-O** open, **-S** save, **-Shift-S** save as

## Math

Inline math like $e^{i\\pi} + 1 = 0$ renders in the paragraph. Type \`$x^2$\` and watch the dollars collapse into an atom. Walk the cursor next to a math atom and a popover appears with the source. Press **Tab** to edit the LaTeX; **Escape** to return to the document.

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

Block math is an atomic block — click into it to anchor the cursor, then press **Tab** to open the popover.

## Code

\`\`\`typescript
function greet(name: string): string {
    return \`Hello, \${name}!\`;
}
\`\`\`

## Tables

| Feature        | Status   | Notes                  |
| :------------- | :------: | ---------------------: |
| Paragraphs     | done     | the default fallback   |
| Lists          | done     | flat with \`indent\`     |
| Inline math    | done     | popover-edited atoms   |
| Tables         | done     | cells-as-blocks        |

## Try it

Click anywhere, type, select text and hit Cmd-B. The pane on the right is the canonical markdown — what would be saved to disk.
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

function basename(path: string): string {
    const m = path.match(/[^\\/]+$/);
    return m ? m[0] : path;
}

type DiscardAction = "save" | "discard" | "cancel";

// Only the main window seeds the welcome doc; windows spawned via Cmd+N start blank.
const IS_MAIN_WINDOW = getCurrentWindow().label === "main";

function openNewWindow(): void {
    const label = `editor-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    new WebviewWindow(label, {
        url: "index.html",
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
    const [view, setView] = useState<"rich" | "raw">("rich");
    const settingsButtonRef = useRef<HTMLButtonElement>(null);

    const editorRenderers = useMemo(
        () => ({
            ...defaultRenderers,
            "code-block": caretCodeBlockRenderer,
            "table-cell": caretTableCellRenderer,
        }),
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

    const confirmDiscard = useCallback((): Promise<DiscardAction> => {
        return new Promise((resolve) => {
            setDiscardPrompt({
                resolve: (action) => {
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
        openFile: () => Promise<void>;
        saveFile: () => Promise<boolean>;
        saveAsFile: () => Promise<boolean>;
        confirmAndClose: () => Promise<void>;
    }>({
        newFile: async () => {},
        openFile: async () => {},
        saveFile: async () => false,
        saveAsFile: async () => false,
        confirmAndClose: async () => {},
    });

    actionsRef.current.saveAsFile = async () => {
        const picked = await saveDialog({
            defaultPath: currentPath ?? "untitled.md",
            filters: MARKDOWN_FILTERS,
        });
        if (!picked) return false;
        await writeTextFile(picked, markdown);
        setCurrentPath(picked);
        setSavedMarkdown(markdown);
        return true;
    };

    actionsRef.current.saveFile = async () => {
        if (!currentPath) return actionsRef.current.saveAsFile();
        await writeTextFile(currentPath, markdown);
        setSavedMarkdown(markdown);
        return true;
    };

    actionsRef.current.newFile = async () => {
        openNewWindow();
    };

    actionsRef.current.openFile = async () => {
        if (isDirty) {
            const action = await confirmDiscard();
            if (action === "cancel") return;
            if (action === "save") {
                const ok = await actionsRef.current.saveFile();
                if (!ok) return;
            }
        }
        const picked = await openDialog({
            multiple: false,
            directory: false,
            filters: MARKDOWN_FILTERS,
        });
        if (typeof picked !== "string") return;
        const content = await readTextFile(picked);
        loadDoc(content, picked);
    };

    actionsRef.current.confirmAndClose = async () => {
        if (isDirty) {
            const action = await confirmDiscard();
            if (action === "cancel") return;
            if (action === "save") {
                const ok = await actionsRef.current.saveFile();
                if (!ok) return;
            }
        }
        await getCurrentWindow().destroy();
    };

    useEffect(() => {
        // Scope to this webview — `listen()` from @tauri-apps/api/event defaults
        // to target `Any`, which receives events emitted to any label.
        const win = getCurrentWebviewWindow();
        const unlisteners = Promise.all([
            win.listen("menu:new_window", () => void actionsRef.current.newFile()),
            win.listen("menu:open_file", () => void actionsRef.current.openFile()),
            win.listen("menu:save_file", () => void actionsRef.current.saveFile()),
            win.listen("menu:save_as_file", () => void actionsRef.current.saveAsFile()),
        ]);
        return () => {
            void unlisteners.then((fns) => fns.forEach((fn) => fn()));
        };
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
                <span
                    data-tauri-drag-region
                    className="flex items-center gap-1 text-xs leading-none text-caret-text-muted"
                    title={currentPath ?? "Unsaved buffer"}
                >
                    {displayName}
                    {isDirty && (
                        <span
                            data-tauri-drag-region
                            aria-label="Unsaved changes"
                            className="bg-caret-text-faint w-1 h-1 rounded-full"
                        >

                        </span>
                    )}
                </span>
                <div data-tauri-drag-region className="ml-auto flex items-center gap-1.5">
                    <ViewToggle value={view} onChange={handleViewChange} />
                    <button
                        ref={settingsButtonRef}
                        type="button"
                        aria-label="Settings"
                        aria-haspopup="dialog"
                        aria-expanded={settingsOpen}
                        onClick={() => setSettingsOpen((v) => !v)}
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
                        store={store}
                        renderers={editorRenderers}
                        className="mx-auto max-w-[720px]"
                    />
                ) : (
                    <SourceEditor value={markdown} onChange={setMarkdown} />
                )}
            </main>
            {settingsOpen && (
                <SettingsPopover
                    anchorRef={settingsButtonRef}
                    settings={settings}
                    onChange={setSettings}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
            {discardPrompt && (
                <UnsavedChangesDialog
                    filename={displayName}
                    onAction={discardPrompt.resolve}
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
