import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { Code, Pencil, Settings as SettingsIcon } from "lucide-react";
import { createStore, parseMarkdown, serializeDoc } from "mdedit/core";
import type { Store } from "mdedit/core";
import { Editor } from "mdedit/react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SettingsPopover, type Settings, defaultSettings, loadSettings, saveSettings } from "./Settings";

// Tauri's draggable-region CSS property isn't in React's CSSProperties type;
// build the styles via a small cast helper so we don't litter `as any` calls.
const dragStyle = { WebkitAppRegion: "drag" } as unknown as CSSProperties;
const noDragStyle = { WebkitAppRegion: "no-drag" } as unknown as CSSProperties;

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
- **Cmd/Ctrl-N** new file, **-O** open, **-S** save, **-Shift-S** save as

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

export function App() {
    const [store, setStore] = useState<Store>(() => makeStore(INITIAL));
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
    const [view, setView] = useState<"edit" | "source">("edit");
    const settingsButtonRef = useRef<HTMLButtonElement>(null);

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
        if (isDirty) {
            const action = await confirmDiscard();
            if (action === "cancel") return;
            if (action === "save") {
                const ok = await actionsRef.current.saveFile();
                if (!ok) return;
            }
        }
        loadDoc("", null);
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
        function onKey(e: KeyboardEvent) {
            const mod = e.metaKey || e.ctrlKey;
            if (!mod) return;
            const key = e.key.toLowerCase();
            if (key === "o" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                void actionsRef.current.openFile();
            } else if (key === "n" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                void actionsRef.current.newFile();
            } else if (key === "s" && !e.altKey) {
                e.preventDefault();
                if (e.shiftKey) void actionsRef.current.saveAsFile();
                else void actionsRef.current.saveFile();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
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

    const displayName = currentPath ? basename(currentPath) : "untitled.md";

    return (
        <div className="flex h-full flex-col bg-[var(--caret-bg)] text-[var(--caret-text)]">
            <header
                className="flex items-center gap-3 border-b border-[var(--caret-border)] bg-[var(--caret-surface)] py-[7px] pl-[92px] pr-3"
                style={dragStyle}
            >
                <h1 className="m-0 text-sm font-semibold leading-none">Caret</h1>
                <span
                    className="flex items-center gap-1 text-xs leading-none text-[var(--caret-text-muted)]"
                    title={currentPath ?? "Unsaved buffer"}
                >
                    {displayName}
                    {isDirty && (
                        <span aria-label="Unsaved changes" className="text-[var(--caret-text-faint)]">
                            •
                        </span>
                    )}
                </span>
                <div className="ml-auto flex items-center gap-1.5" style={noDragStyle}>
                    <ViewToggle value={view} onChange={setView} />
                    <button
                        ref={settingsButtonRef}
                        type="button"
                        aria-label="Settings"
                        aria-haspopup="dialog"
                        aria-expanded={settingsOpen}
                        onClick={() => setSettingsOpen((v) => !v)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--caret-text-faint)] transition-colors hover:bg-[var(--caret-border)] hover:text-[var(--caret-text)] focus:outline-none focus:ring-1 focus:ring-[var(--caret-link)]"
                    >
                        <SettingsIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                </div>
            </header>
            <main className="min-h-0 flex-1 overflow-auto bg-[var(--caret-surface)] px-8 py-6">
                {view === "edit" ? (
                    <Editor key={storeKey} store={store} className="mx-auto max-w-[720px]" />
                ) : (
                    <pre className="mx-auto m-0 max-w-[720px] whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.55] text-[var(--caret-text-faint)]">
                        {markdown}
                    </pre>
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

function ViewToggle({ value, onChange }: { value: "edit" | "source"; onChange: (v: "edit" | "source") => void }) {
    const baseClass =
        "flex h-6 items-center gap-1.5 px-2 text-[11px] font-medium leading-none transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--caret-link)]";
    const activeClass = "bg-[var(--caret-border)] text-[var(--caret-text)]";
    const inactiveClass = "text-[var(--caret-text-faint)] hover:text-[var(--caret-text)]";
    return (
        <div
            className="flex overflow-hidden rounded-md border border-[var(--caret-border)]"
            role="tablist"
            aria-label="View mode"
        >
            <button
                type="button"
                role="tab"
                aria-selected={value === "edit"}
                onClick={() => onChange("edit")}
                className={`${baseClass} ${value === "edit" ? activeClass : inactiveClass}`}
            >
                <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                Edit
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={value === "source"}
                onClick={() => onChange("source")}
                className={`${baseClass} border-l border-[var(--caret-border)] ${value === "source" ? activeClass : inactiveClass}`}
            >
                <Code size={12} strokeWidth={1.75} aria-hidden="true" />
                Source
            </button>
        </div>
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
            <div className="w-[360px] rounded-lg border border-[var(--caret-border)] bg-[var(--caret-surface)] p-5 text-[var(--caret-text)] shadow-2xl">
                <div id="unsaved-dialog-title" className="mb-1 text-sm font-semibold">
                    Save changes to {filename}?
                </div>
                <p className="mb-5 text-xs leading-relaxed text-[var(--caret-text-muted)]">
                    Your changes will be lost if you don't save them.
                </p>
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => onAction("discard")}
                        className="rounded-md px-3 py-1.5 text-xs text-[var(--caret-text-faint)] transition-colors hover:bg-[var(--caret-border)] hover:text-[var(--caret-text)] focus:outline-none focus:ring-1 focus:ring-[var(--caret-link)]"
                    >
                        Don't save
                    </button>
                    <button
                        type="button"
                        onClick={() => onAction("cancel")}
                        className="rounded-md border border-[var(--caret-border)] bg-[var(--caret-surface-soft)] px-3 py-1.5 text-xs text-[var(--caret-text)] transition-colors hover:bg-[var(--caret-border)] focus:outline-none focus:ring-1 focus:ring-[var(--caret-link)]"
                    >
                        Cancel
                    </button>
                    <button
                        ref={saveBtnRef}
                        type="button"
                        onClick={() => onAction("save")}
                        className="rounded-md bg-[var(--caret-link)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[var(--caret-link)] focus:ring-offset-1"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

export { defaultSettings };
