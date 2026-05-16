import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
                className="flex items-baseline gap-3 border-b border-[var(--caret-border)] bg-[var(--caret-surface)] px-6 py-3 pl-[84px]"
                style={dragStyle}
            >
                <h1 className="m-0 text-sm font-semibold">Caret</h1>
                <span className="text-xs text-[var(--caret-text-muted)]">untitled.md</span>
                <div className="ml-auto flex items-center" style={noDragStyle}>
                    <button
                        ref={settingsButtonRef}
                        type="button"
                        aria-label="Settings"
                        aria-haspopup="dialog"
                        aria-expanded={settingsOpen}
                        onClick={() => setSettingsOpen((v) => !v)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--caret-text-faint)] transition-colors hover:bg-[var(--caret-border)] hover:text-[var(--caret-text)] focus:outline-none focus:ring-1 focus:ring-[var(--caret-link)]"
                    >
                        <GearIcon />
                    </button>
                </div>
            </header>
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[var(--caret-border)] md:grid-cols-2">
                <section className="overflow-auto bg-[var(--caret-surface)] px-8 py-6">
                    <Editor store={store} className="mx-auto max-w-[720px]" />
                </section>
                <section className="overflow-auto bg-[var(--caret-surface-soft)] px-8 py-6">
                    <header className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--caret-text-muted)]">
                        Markdown
                    </header>
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.55] text-[var(--caret-text-faint)]">
                        {markdown}
                    </pre>
                </section>
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

function GearIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
                d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"
                stroke="currentColor"
                strokeWidth="1.25"
            />
            <path
                d="M13.4 9.2l1.1.6-1 1.7-1.2-.4a4.6 4.6 0 01-1.4.8L10.6 13H8.4l-.3-1.1a4.6 4.6 0 01-1.4-.8l-1.2.4-1-1.7 1.1-.6a4.7 4.7 0 010-1.6l-1.1-.6 1-1.7 1.2.4a4.6 4.6 0 011.4-.8L7.4 3h2.2l.3 1.1c.5.2 1 .5 1.4.8l1.2-.4 1 1.7-1.1.6a4.7 4.7 0 010 1.6z"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export { defaultSettings };
