import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface Settings {
    theme: "light" | "dark";
    font: "sans" | "serif";
    fontSize: number;
}

export const defaultSettings: Settings = {
    theme: "light",
    font: "sans",
    fontSize: 16,
};

const STORAGE_KEY = "caret.settings.v1";
const MIN_FONT = 12;
const MAX_FONT = 22;

export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultSettings;
        const parsed = JSON.parse(raw) as Partial<Settings>;
        return {
            theme: parsed.theme === "dark" ? "dark" : "light",
            font: parsed.font === "serif" ? "serif" : "sans",
            fontSize: clampFont(
                typeof parsed.fontSize === "number" ? parsed.fontSize : defaultSettings.fontSize,
            ),
        };
    } catch {
        return defaultSettings;
    }
}

export function saveSettings(s: Settings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
        // Storage unavailable (private mode, sandboxed); silently skip.
    }
}

function clampFont(n: number): number {
    if (!Number.isFinite(n)) return defaultSettings.fontSize;
    return Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(n)));
}

export interface SettingsPopoverProps {
    anchorRef: RefObject<HTMLElement | null>;
    settings: Settings;
    onChange: (next: Settings) => void;
    onClose: () => void;
}

/**
 * A small popover anchored beneath the settings gear. Positions itself
 * absolutely on mount and on resize, closes on outside-click or Escape.
 */
export function SettingsPopover({ anchorRef, settings, onChange, onClose }: SettingsPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
        function reposition() {
            const anchor = anchorRef.current;
            if (!anchor) return;
            const rect = anchor.getBoundingClientRect();
            const popoverWidth = popoverRef.current?.offsetWidth ?? 260;
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
            aria-label="Settings"
            className="fixed z-50 w-64 rounded-lg border border-[var(--caret-border)] bg-[var(--caret-surface)] p-4 text-[var(--caret-text)] shadow-xl"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos ? "visible" : "hidden",
            }}
        >
            <div className="mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--caret-text-muted)]">
                Settings
            </div>

            <Row label="Appearance">
                <Segmented
                    value={settings.theme}
                    options={[
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                    ]}
                    onChange={(theme) => onChange({ ...settings, theme })}
                />
            </Row>

            <Row label="Font">
                <Segmented
                    value={settings.font}
                    options={[
                        { value: "sans", label: "Sans" },
                        { value: "serif", label: "Serif" },
                    ]}
                    onChange={(font) => onChange({ ...settings, font })}
                />
            </Row>

            <Row label={`Size · ${settings.fontSize}px`}>
                <input
                    type="range"
                    min={MIN_FONT}
                    max={MAX_FONT}
                    step={1}
                    value={settings.fontSize}
                    onChange={(e) =>
                        onChange({ ...settings, fontSize: clampFont(Number(e.target.value)) })
                    }
                    className="w-full accent-[var(--caret-link)]"
                    aria-label="Base font size"
                />
            </Row>
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="mb-3 last:mb-0">
            <div className="mb-1.5 text-xs text-[var(--caret-text-faint)]">{label}</div>
            {children}
        </div>
    );
}

interface SegmentedProps<T extends string> {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (next: T) => void;
}

function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
    return (
        <div className="inline-flex w-full rounded-md border border-[var(--caret-border)] bg-[var(--caret-surface-soft)] p-0.5">
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        onClick={() => onChange(o.value)}
                        className={
                            "flex-1 rounded px-2 py-1 text-xs transition-colors " +
                            (active
                                ? "bg-[var(--caret-surface)] text-[var(--caret-text)] shadow-sm"
                                : "text-[var(--caret-text-faint)] hover:text-[var(--caret-text)]")
                        }
                        aria-pressed={active}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
