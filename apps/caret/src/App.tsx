import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Code, Pencil, Settings as SettingsIcon } from "lucide-react";
import { createStore, parseMarkdown, serializeDoc } from "mdedit/core";
import { Editor } from "mdedit/react";
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

export function App() {
    const store = useMemo(() => {
        const doc = parseMarkdown(INITIAL);
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
    }, []);

    const [markdown, setMarkdown] = useState(() => serializeDoc(store.getState().doc));

    useEffect(() => {
        return store.subscribe(() => {
            setMarkdown(serializeDoc(store.getState().doc));
        });
    }, [store]);

    const [settings, setSettings] = useState<Settings>(loadSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [view, setView] = useState<"edit" | "source">("edit");
    const settingsButtonRef = useRef<HTMLButtonElement>(null);

    // Apply settings to the document root so the body bg, font, and editor
    // theme variables all flip from one source of truth. Persist on change.
    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute("data-theme", settings.theme);
        root.setAttribute("data-font", settings.font);
        root.style.setProperty("--caret-font-size", `${settings.fontSize}px`);
        saveSettings(settings);
    }, [settings]);

    return (
        <div className="flex h-full flex-col bg-[var(--caret-bg)] text-[var(--caret-text)]">
            <header
                className="flex items-center gap-3 border-b border-[var(--caret-border)] bg-[var(--caret-surface)] py-[7px] pl-[92px] pr-3"
                style={dragStyle}
            >
                <h1 className="m-0 text-sm font-semibold leading-none">Caret</h1>
                <span className="text-xs leading-none text-[var(--caret-text-muted)]">untitled.md</span>
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
                    <Editor store={store} className="mx-auto max-w-[720px]" />
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

export { defaultSettings };
