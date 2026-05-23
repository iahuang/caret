import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface HelpPopoverProps {
    anchorRef: RefObject<HTMLElement | null>;
    onClose: () => void;
}

const isMac =
    typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const MOD = isMac ? "⌘" : "Ctrl";
const ALT = isMac ? "⌥" : "Alt";
const SHIFT = "⇧";

interface Shortcut {
    keys: string[];
    label: string;
}

interface ShortcutGroup {
    title: string;
    items: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        title: "Formatting",
        items: [
            { keys: [MOD, "B"], label: "Bold" },
            { keys: [MOD, "I"], label: "Italic" },
            { keys: [MOD, "E"], label: "Inline code" },
            { keys: [MOD, SHIFT, "X"], label: "Strikethrough" },
            { keys: [MOD, "K"], label: "Link" },
            { keys: [MOD, SHIFT, "M"], label: "Inline math" },
        ],
    },
    {
        title: "Block type",
        items: [
            { keys: [MOD, ALT, "1–6"], label: "Heading 1–6" },
            { keys: [MOD, ALT, "0"], label: "Paragraph" },
            { keys: [MOD, SHIFT, "8"], label: "Bullet list" },
            { keys: [MOD, SHIFT, "7"], label: "Numbered list" },
            { keys: ["Tab"], label: "Indent / next cell" },
            { keys: [SHIFT, "Tab"], label: "Outdent / prev cell" },
        ],
    },
    {
        title: "Editing",
        items: [
            { keys: [MOD, "Z"], label: "Undo" },
            { keys: [MOD, SHIFT, "Z"], label: "Redo" },
            { keys: [MOD, "A"], label: "Select all" },
            { keys: [MOD, "F"], label: "Find" },
            { keys: [MOD, "G"], label: "Next match" },
            { keys: [MOD, SHIFT, "G"], label: "Previous match" },
        ],
    },
    {
        title: "Files",
        items: [
            { keys: [MOD, "P"], label: "Quick open" },
            { keys: [MOD, SHIFT, "B"], label: "Open breadcrumb" },
        ],
    },
];

interface SyntaxRule {
    syntax: string;
    label: string;
}

const INLINE_SYNTAX: SyntaxRule[] = [
    { syntax: "**text**", label: "Bold" },
    { syntax: "*text*", label: "Italic" },
    { syntax: "`code`", label: "Inline code" },
    { syntax: "~~text~~", label: "Strikethrough" },
    { syntax: "[label](url)", label: "Link" },
    { syntax: "![alt](src)", label: "Image" },
    { syntax: "$x^2$", label: "Inline math" },
];

const BLOCK_SYNTAX: SyntaxRule[] = [
    { syntax: "# … ###### ", label: "Heading 1–6" },
    { syntax: "- ", label: "Bullet item" },
    { syntax: "1. ", label: "Numbered item" },
    { syntax: "- [ ] ", label: "Task item" },
    { syntax: "> ", label: "Blockquote" },
    { syntax: "---", label: "Horizontal rule" },
    { syntax: "$$", label: "Math block" },
    { syntax: "||| ", label: "Table (extra | per column)" },
];

/**
 * Help popover. Mirrors SettingsPopover positioning and dismiss logic so the
 * two siblings behave identically.
 */
export function HelpPopover({ anchorRef, onClose }: HelpPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
        function reposition() {
            const anchor = anchorRef.current;
            if (!anchor) return;
            const rect = anchor.getBoundingClientRect();
            const popoverWidth = popoverRef.current?.offsetWidth ?? 360;
            const left = Math.max(
                8,
                Math.min(
                    rect.right - popoverWidth,
                    window.innerWidth - popoverWidth - 8,
                ),
            );
            setPos({ top: rect.bottom + 8, left });
        }
        reposition();
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
        };
    }, [anchorRef]);

    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            const target = e.target as Node;
            if (popoverRef.current?.contains(target)) return;
            if (anchorRef.current?.contains(target)) return;
            onClose();
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        window.addEventListener("mousedown", onMouseDown);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("keydown", onKey);
        };
    }, [anchorRef, onClose]);

    return (
        <div
            ref={popoverRef}
            role="dialog"
            aria-label="Help"
            className="fixed z-50 max-h-[80vh] w-[360px] overflow-y-auto rounded-lg border border-caret-border bg-caret-surface p-4 text-caret-text shadow-xl"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos ? "visible" : "hidden",
            }}
        >
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-caret-text-muted">
                Keyboard
            </div>
            {SHORTCUT_GROUPS.map((group) => (
                <Group key={group.title} title={group.title}>
                    {group.items.map((s) => (
                        <Row key={s.label} label={s.label}>
                            <KeyCombo keys={s.keys} />
                        </Row>
                    ))}
                </Group>
            ))}

            <div className="mb-3 mt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-caret-text-muted">
                Inline syntax
            </div>
            <Group>
                {INLINE_SYNTAX.map((r) => (
                    <Row key={r.label} label={r.label}>
                        <Mono>{r.syntax}</Mono>
                    </Row>
                ))}
            </Group>

            <div className="mb-3 mt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-caret-text-muted">
                Block syntax
            </div>
            <Group>
                {BLOCK_SYNTAX.map((r) => (
                    <Row key={r.label} label={r.label}>
                        <Mono>{r.syntax}</Mono>
                    </Row>
                ))}
            </Group>
        </div>
    );
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
    return (
        <div className="mb-3 last:mb-0">
            {title && (
                <div className="mb-1.5 text-xs text-caret-text-faint">{title}</div>
            )}
            <div className="flex flex-col gap-1">{children}</div>
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-caret-text">{label}</span>
            <span className="flex shrink-0 items-center gap-1">{children}</span>
        </div>
    );
}

function KeyCombo({ keys }: { keys: string[] }) {
    return (
        <>
            {keys.map((k, i) => (
                <kbd
                    key={i}
                    className="inline-flex min-w-[22px] items-center justify-center rounded border border-caret-border bg-caret-surface-soft px-1.5 py-0.5 font-sans text-[11px] leading-none text-caret-text"
                >
                    {k}
                </kbd>
            ))}
        </>
    );
}

function Mono({ children }: { children: React.ReactNode }) {
    return (
        <span className="rounded border border-caret-border bg-caret-surface-soft px-1.5 py-0.5 font-mono text-[11px] leading-none text-caret-text">
            {children}
        </span>
    );
}
