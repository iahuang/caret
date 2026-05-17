/**
 * Caret-side math popover with overlay syntax highlighting and autocomplete.
 *
 * Two layers stacked at the same coordinates:
 *   - A `<pre>` underneath, rendering tokenized LaTeX with per-kind colors.
 *     `aria-hidden` because the textarea is the real editing surface.
 *   - A `<textarea>` on top with transparent text but a visible caret and
 *     selection. The textarea is the source of truth for caret/IME and
 *     drives `onChange`.
 *
 * Both layers must wrap identically — same font, padding, white-space, and
 * width — so glyph positions align column-for-column. The pre lays out in
 * flow as the height authority; the textarea overlays it with
 * position:absolute; inset:0; height:100%, so the popover grows with the
 * tokenized content with no JS measurement.
 *
 * Anchoring + edit-session focus come from `useNodePopoverShell`. Exit
 * semantics mirror mdedit's default NodePopover so the navigation contract
 * is unchanged.
 *
 * Autocomplete:
 *   - Typing `\` opens a sticky suggestion menu. Each subsequent letter
 *     refines the query (the text between the most recent `\` and the
 *     caret). Backspace within the query shortens it; backing past the
 *     `\` invalidates it and the menu closes.
 *   - Up/Down navigates suggestions, Tab accepts the highlighted one,
 *     Escape dismisses the menu (without exiting the popover).
 *   - Any cursor movement (arrow Left/Right, Home/End, click) invalidates
 *     the menu — the user has to type a fresh `\` to reopen.
 */

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react";
import { useNodePopoverShell } from "mdedit/react";
import { tokenizeMath, type MathToken } from "./mathTokenize";
import { KATEX_COMMAND_NAMES, arityOf } from "./mathCommands";
import { rankCommandMatches } from "./mathComplete";

export interface CaretMathPopoverProps {
    anchorSelector: string;
    value: string;
    editing: boolean;
    onChange: (next: string) => void;
    onStartEditing: () => void;
    onDoneEditing: () => void;
    onExitLeft: () => void;
    onExitRight: () => void;
    /** Remove the math node from the doc and return focus to the editor. */
    onDelete: () => void;
    containerRef: RefObject<HTMLElement | null>;
    anchorAlignment?: "start" | "center";
}

const MAX_SUGGESTIONS = 8;
const COMMAND_CHAR = /[a-zA-Z]/;

interface Query {
    /** Index of the `\` that started the command. */
    start: number;
    /** Caret offset — end of the partial command. */
    end: number;
    /** Letters typed after the `\`. May be empty. */
    text: string;
}

export function CaretMathPopover({
    anchorSelector,
    value,
    editing,
    onChange,
    onStartEditing,
    onDoneEditing,
    onExitLeft,
    onExitRight,
    onDelete,
    containerRef,
    anchorAlignment = "start",
}: CaretMathPopoverProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const { pos, editingSessionId } = useNodePopoverShell({
        anchorSelector,
        editing,
        containerRef,
        anchorAlignment,
        measureDeps: [value],
    });

    const [caret, setCaret] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuIndex, setMenuIndex] = useState(0);
    // After an autocomplete accept, the textarea's selection has to be
    // repositioned past the inserted text — but the value prop updates
    // asynchronously, so we stash the target offset and apply it in a
    // post-render effect.
    const [pendingCaret, setPendingCaret] = useState<number | null>(null);

    useEffect(() => {
        if (editingSessionId < 0) return;
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.select();
        setCaret(ta.selectionStart);
    }, [editingSessionId]);

    useLayoutEffect(() => {
        if (pendingCaret === null) return;
        const ta = textareaRef.current;
        if (!ta) return;
        ta.selectionStart = ta.selectionEnd = pendingCaret;
        setCaret(pendingCaret);
        setPendingCaret(null);
    }, [pendingCaret, value]);

    const query = useMemo<Query | null>(() => {
        if (!menuOpen) return null;
        return deriveQuery(value, caret);
    }, [menuOpen, value, caret]);

    // If the query becomes invalid while the menu is "open", auto-close.
    // Covers: cursor moved past the `\`, query now contains a non-letter, etc.
    useEffect(() => {
        if (menuOpen && query === null) {
            setMenuOpen(false);
        }
    }, [menuOpen, query]);

    const suggestions = useMemo(() => {
        if (!query) return [];
        return rankCommandMatches(query.text, KATEX_COMMAND_NAMES).slice(0, MAX_SUGGESTIONS);
    }, [query]);

    // Reset highlight to the top whenever the visible suggestion set changes.
    useEffect(() => {
        setMenuIndex(0);
    }, [query?.text]);

    const tokens = useMemo(() => tokenizeMath(value), [value]);

    const acceptSuggestion = useCallback(
        (cmd: string) => {
            if (!query) return;
            const arity = arityOf(cmd);
            const insertion = arity > 0 ? cmd + "{}".repeat(arity) : cmd;
            // For arity > 0, park the caret inside the first `{}` so the
            // user can immediately type the first argument. For arity 0
            // the caret lands at the end of the command name.
            const caretInside = arity > 0 ? cmd.length + 1 : cmd.length;
            const next = value.slice(0, query.start) + insertion + value.slice(query.end);
            onChange(next);
            setPendingCaret(query.start + caretInside);
            setMenuOpen(false);
        },
        [query, value, onChange],
    );

    if (!pos) return null;

    return (
        <div
            className={`mdedit-node-popover caret-math-popover${editing ? " editing" : ""}`}
            data-anchor-alignment={anchorAlignment}
            style={{ position: "absolute", left: pos.x, top: pos.y }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="caret-math-popover-stack">
                <pre className="caret-math-popover-highlight" aria-hidden="true">
                    {renderTokens(tokens)}
                    {/* CSS Text suppresses a `\n` at the very end of a block,
                        so a trailing newline in `value` wouldn't render an
                        empty line and the textarea's caret would float off
                        the visible pre. Appending a sentinel `\n` pushes the
                        suppression onto the sentinel and lets the user's
                        trailing `\n` render its empty line. */}
                    {value.endsWith("\n") ? "\n" : ""}
                </pre>
                <textarea
                    ref={textareaRef}
                    className="caret-math-popover-input"
                    value={value}
                    onChange={(e) => {
                        const newValue = e.target.value;
                        const newCaret = e.target.selectionStart;
                        // Open the menu when the user just typed `\`. Doing
                        // this here (rather than in onKeyDown) keeps the
                        // menuOpen update in the same handler as the value
                        // and caret updates, so they land in a single render
                        // and the close-on-null-query effect doesn't fire
                        // against a stale intermediate state.
                        if (
                            newValue.length > value.length &&
                            newCaret > 0 &&
                            newValue[newCaret - 1] === "\\"
                        ) {
                            setMenuOpen(true);
                        }
                        onChange(newValue);
                        setCaret(newCaret);
                    }}
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                    onMouseDown={() => {
                        // Mouse clicks change the caret arbitrarily — any open
                        // autocomplete is no longer aligned with the cursor.
                        if (menuOpen) setMenuOpen(false);
                    }}
                    onKeyDown={(e) => {
                        // Backspace/Delete on an empty popover removes the
                        // math node entirely. This is the natural undo for a
                        // node the user just created and left empty.
                        if ((e.key === "Backspace" || e.key === "Delete") && value === "") {
                            e.preventDefault();
                            onDelete();
                            return;
                        }
                        if (menuOpen && suggestions.length > 0) {
                            if (e.key === "Tab" || e.key === "Enter") {
                                e.preventDefault();
                                acceptSuggestion(suggestions[menuIndex]!.cmd);
                                return;
                            }
                            if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setMenuIndex((i) =>
                                    Math.min(i + 1, suggestions.length - 1),
                                );
                                return;
                            }
                            if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setMenuIndex((i) => Math.max(i - 1, 0));
                                return;
                            }
                            if (e.key === "Escape") {
                                // Dismiss only the menu — the popover stays
                                // open. The popover-level Escape (below) is
                                // skipped via the early return.
                                e.preventDefault();
                                setMenuOpen(false);
                                return;
                            }
                        }

                        // Any explicit caret-moving key invalidates an open
                        // menu. We close BEFORE falling through to popover
                        // edge-exit handling so the cursor still moves.
                        if (
                            menuOpen &&
                            (e.key === "ArrowLeft" ||
                                e.key === "ArrowRight" ||
                                e.key === "Home" ||
                                e.key === "End" ||
                                e.key === "PageUp" ||
                                e.key === "PageDown")
                        ) {
                            setMenuOpen(false);
                        }

                        if (e.key === "Escape") {
                            e.preventDefault();
                            onDoneEditing();
                            return;
                        }
                        const ta = e.currentTarget;
                        if (ta.selectionStart !== ta.selectionEnd) return;
                        if (
                            (e.key === "ArrowLeft" || e.key === "ArrowUp") &&
                            ta.selectionStart === 0
                        ) {
                            e.preventDefault();
                            onExitLeft();
                            return;
                        }
                        if (
                            (e.key === "ArrowRight" || e.key === "ArrowDown") &&
                            ta.selectionStart === value.length
                        ) {
                            e.preventDefault();
                            onExitRight();
                            return;
                        }
                    }}
                    onClick={() => {
                        if (!editing) onStartEditing();
                    }}
                    readOnly={!editing}
                    rows={1}
                    spellCheck={false}
                    placeholder="LaTeX…"
                />
            </div>
            {menuOpen && suggestions.length > 0 && (
                <ul
                    className="caret-math-completions"
                    role="listbox"
                    aria-label="LaTeX command suggestions"
                >
                    {suggestions.map((s, i) => (
                        <li
                            key={s.cmd}
                            role="option"
                            aria-selected={i === menuIndex}
                            className={`caret-math-completion${
                                i === menuIndex ? " selected" : ""
                            }${s.tier === 1 ? " fuzzy" : ""}`}
                            onMouseDown={(e) => {
                                // Prevent the textarea from losing focus and
                                // collapsing the selection mid-click.
                                e.preventDefault();
                                acceptSuggestion(s.cmd);
                            }}
                            onMouseEnter={() => setMenuIndex(i)}
                        >
                            {s.cmd}
                            {arityOf(s.cmd) > 0 && (
                                <span className="caret-math-completion-arity">
                                    {"{}".repeat(arityOf(s.cmd))}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function deriveQuery(value: string, caret: number): Query | null {
    // If the next character is a letter, the caret is mid-word — not at the
    // trailing edge of a partial command.
    if (caret < value.length && COMMAND_CHAR.test(value[caret]!)) return null;
    let i = caret - 1;
    while (i >= 0) {
        const ch = value[i]!;
        if (ch === "\\") {
            const text = value.slice(i + 1, caret);
            if (text === "" || /^[a-zA-Z]+$/.test(text)) {
                return { start: i, end: caret, text };
            }
            return null;
        }
        if (!COMMAND_CHAR.test(ch)) return null;
        i--;
    }
    return null;
}

function renderTokens(tokens: MathToken[]) {
    const out: ReactNode[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.kind === "text") {
            out.push(t.value);
        } else {
            out.push(
                <span key={i} className={`caret-math-tok caret-math-tok-${t.kind}`}>
                    {t.value}
                </span>,
            );
        }
    }
    return out;
}
