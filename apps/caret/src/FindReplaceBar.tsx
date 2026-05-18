import { useCallback, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import type { FindOptions, Match } from "mdedit/core";

export interface FindReplaceBarProps {
    query: string;
    onQueryChange: (q: string) => void;
    replaceText: string;
    onReplaceTextChange: (t: string) => void;
    options: FindOptions;
    onOptionsChange: (o: FindOptions) => void;
    matches: Match[];
    activeIndex: number;
    onNext: () => void;
    onPrev: () => void;
    onReplace: () => void;
    onReplaceAll: () => void;
    onClose: () => void;
}

const INPUT_CLASS =
    "min-w-0 flex-1 h-[22px] rounded border border-caret-border bg-transparent px-1.5 text-[12px] leading-none text-caret-text outline-none focus:border-caret-link";

const ICON_BTN_CLASS =
    "flex h-5 w-5 rounded flex-none items-center justify-center bg-transparent text-[14px] leading-none text-caret-text transition-colors hover:bg-caret-surface-soft disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent";

const ACTION_BTN_CLASS =
    "flex h-[22px] flex-none items-center justify-center rounded border border-caret-border bg-transparent px-1.5 text-[11px] leading-none text-caret-text transition-colors hover:bg-caret-surface-soft disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent";

function toggleClass(active: boolean): string {
    const base =
        "flex h-[22px] w-[22px] flex-none items-center justify-center rounded border text-[10px] leading-none transition-colors font-mono";
    return active
        ? `${base} border-caret-link bg-caret-surface-soft text-caret-text`
        : `${base} border-transparent bg-transparent text-caret-text-muted hover:bg-caret-surface-soft hover:text-caret-text`;
}

export function FindReplaceBar({
    query,
    onQueryChange,
    replaceText,
    onReplaceTextChange,
    options,
    onOptionsChange,
    matches,
    activeIndex,
    onNext,
    onPrev,
    onReplace,
    onReplaceAll,
    onClose,
}: FindReplaceBarProps) {
    const findRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        findRef.current?.focus();
        findRef.current?.select();
        // Once-on-mount: re-selecting on prop changes would clobber the user.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onFindKey = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) onPrev();
                else onNext();
            }
        },
        [onClose, onNext, onPrev],
    );

    const onReplaceKey = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey || e.metaKey || e.ctrlKey) onReplaceAll();
                else onReplace();
            }
        },
        [onClose, onReplace, onReplaceAll],
    );

    const toggle = useCallback(
        (key: keyof FindOptions) => () => {
            onOptionsChange({ ...options, [key]: !options[key] });
        },
        [options, onOptionsChange],
    );

    const status =
        query.length === 0
            ? ""
            : matches.length === 0
              ? "No results"
              : `${activeIndex + 1} of ${matches.length}`;

    return (
        <div
            role="search"
            aria-label="Find and replace"
            className="flex w-[300px] flex-col gap-1 rounded-md border border-caret-border bg-caret-surface p-1.5 text-caret-text shadow-lg"
        >
            <div className="flex items-center gap-1">
                <input
                    ref={findRef}
                    type="text"
                    className={INPUT_CLASS}
                    value={query}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
                    onKeyDown={onFindKey}
                    placeholder="Find"
                    aria-label="Find"
                    spellCheck={false}
                />
                <div className="flex gap-0.5" role="group" aria-label="Search options">
                    <button
                        type="button"
                        className={toggleClass(!!options.caseSensitive)}
                        aria-pressed={!!options.caseSensitive}
                        title="Match case"
                        onClick={toggle("caseSensitive")}
                    >
                        Aa
                    </button>
                    <button
                        type="button"
                        className={toggleClass(!!options.wholeWord)}
                        aria-pressed={!!options.wholeWord}
                        title="Whole word"
                        onClick={toggle("wholeWord")}
                    >
                        W
                    </button>
                    <button
                        type="button"
                        className={toggleClass(!!options.regex)}
                        aria-pressed={!!options.regex}
                        title="Regular expression"
                        onClick={toggle("regex")}
                    >
                        .*
                    </button>
                </div>
                <span
                    className="flex-none text-right text-[11px] tabular-nums text-caret-text-muted whitespace-nowrap"
                    aria-live="polite"
                >
                    {status}
                </span>
                <div className="flex flex-row">
                    <button
                        type="button"
                        className={ICON_BTN_CLASS}
                        aria-label="Previous match"
                        onClick={onPrev}
                        disabled={matches.length === 0}
                    >
                        ‹
                    </button>
                    <button
                        type="button"
                        className={ICON_BTN_CLASS}
                        aria-label="Next match"
                        onClick={onNext}
                        disabled={matches.length === 0}
                    >
                        ›
                    </button>
                    <button
                        type="button"
                        className={ICON_BTN_CLASS}
                        aria-label="Close"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </div>
            </div>
            <div className="flex items-center gap-1">
                <input
                    type="text"
                    className={INPUT_CLASS}
                    value={replaceText}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => onReplaceTextChange(e.target.value)}
                    onKeyDown={onReplaceKey}
                    placeholder="Replace"
                    aria-label="Replace"
                    spellCheck={false}
                />
                <button
                    type="button"
                    className={ACTION_BTN_CLASS}
                    onClick={onReplace}
                    disabled={matches.length === 0}
                >
                    Replace
                </button>
                <button
                    type="button"
                    className={ACTION_BTN_CLASS}
                    onClick={onReplaceAll}
                    disabled={matches.length === 0}
                >
                    Replace all
                </button>
            </div>
        </div>
    );
}
