import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, Ellipsis, Languages } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import hljs from "highlight.js";
import {
    DEFAULT_CODE_LANGUAGES,
    useEditorActions,
    type BlockRenderer,
} from "mdedit/react";

function highlightToHtml(source: string, language: string): string {
    if (source.length === 0) return "";
    if (language && hljs.getLanguage(language)) {
        try {
            return hljs.highlight(source, { language, ignoreIllegals: true }).value;
        } catch {
            // Fall through to plain rendering.
        }
    }
    return source
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// The editor swallows mousedown anywhere inside [data-no-content], so the
// trigger button is safe from selection-drag. Radix portals the menu surface
// to document.body — clicks land outside the editor container entirely.
function stopMouseDown(e: { stopPropagation: () => void }) {
    e.stopPropagation();
}

const menuItemClass =
    "flex items-center gap-1.5 rounded px-2 py-1 text-xs text-caret-text cursor-pointer select-none outline-none data-[highlighted]:bg-caret-border data-[disabled]:cursor-default data-[disabled]:text-caret-text-faint";

const menuIconClass =
    "inline-flex w-3.5 items-center justify-center text-caret-text-faint";

function LanguageMenu({
    current,
    onPick,
}: {
    current: string;
    onPick: (id: string) => void;
}) {
    const known = DEFAULT_CODE_LANGUAGES.some((l) => l.id === current);
    return (
        <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className={menuItemClass}>
                <span className={menuIconClass}>
                    <Languages size={12} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span>Language</span>
                <span className="ml-auto pl-3 tabular-nums text-caret-text-faint">
                    {known
                        ? DEFAULT_CODE_LANGUAGES.find((l) => l.id === current)?.label
                        : current || "plain text"}
                </span>
                <span className="inline-flex w-3 items-center justify-center text-caret-text-faint">
                    <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />
                </span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                    className="z-[70] max-h-80 min-w-[160px] overflow-y-auto rounded-md border border-caret-border bg-caret-surface p-1 font-sans text-xs text-caret-text shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
                    sideOffset={4}
                    onMouseDown={stopMouseDown}
                >
                    <DropdownMenu.RadioGroup value={current} onValueChange={onPick}>
                        {!known && current ? (
                            <DropdownMenu.RadioItem value={current} className={menuItemClass}>
                                <span className="inline-flex w-3.5 items-center justify-center text-caret-text">
                                    <Check size={12} strokeWidth={2.25} aria-hidden="true" />
                                </span>
                                {current}
                            </DropdownMenu.RadioItem>
                        ) : null}
                        {DEFAULT_CODE_LANGUAGES.map((l) => (
                            <DropdownMenu.RadioItem
                                key={l.id || "__plain"}
                                value={l.id}
                                className={menuItemClass}
                            >
                                <span className="inline-flex w-3.5 items-center justify-center text-caret-text">
                                    <DropdownMenu.ItemIndicator>
                                        <Check size={12} strokeWidth={2.25} aria-hidden="true" />
                                    </DropdownMenu.ItemIndicator>
                                </span>
                                {l.label}
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
        </DropdownMenu.Sub>
    );
}

function CopyItem({ source }: { source: string }): ReactNode {
    const [copied, setCopied] = useState(false);
    const onCopy = () => {
        void navigator.clipboard.writeText(source).then(
            () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
            },
            () => {},
        );
    };
    return (
        <DropdownMenu.Item
            className={menuItemClass}
            onSelect={(e) => {
                e.preventDefault();
                onCopy();
            }}
        >
            <span className={menuIconClass}>
                {copied ? (
                    <Check size={12} strokeWidth={2.25} aria-hidden="true" />
                ) : (
                    <Copy size={12} strokeWidth={1.75} aria-hidden="true" />
                )}
            </span>
            {copied ? "Copied" : "Copy code"}
        </DropdownMenu.Item>
    );
}

export const caretCodeBlockRenderer: BlockRenderer = ({ block }) => {
    const language = ((block.metadata?.language as string | undefined) ?? "").trim();
    const actions = useEditorActions();
    const highlighted = useMemo(
        () => highlightToHtml(block.content, language),
        [block.content, language],
    );
    const onPickLanguage = (id: string) => {
        actions.updateBlockMetadata(block.id, { language: id });
    };
    return (
        <div
            data-block-id={block.id}
            data-block-type={block.type}
            className="mdedit-code-block group"
        >
            <div
                className="absolute right-1.5 top-1.5 z-2"
                data-no-content="true"
                contentEditable={false}
            >
                <DropdownMenu.Root modal={false}>
                    <DropdownMenu.Trigger asChild>
                        <button
                            type="button"
                            aria-label="Code block options"
                            onMouseDown={stopMouseDown}
                            className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-caret-text-faint opacity-0 transition-opacity duration-150 hover:bg-caret-border hover:text-caret-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caret-link group-hover:opacity-100 data-[state=open]:bg-caret-border data-[state=open]:text-caret-text data-[state=open]:opacity-100"
                        >
                            <Ellipsis size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            className="z-[70] min-w-[160px] rounded-md border border-caret-border bg-caret-surface p-1 font-sans text-xs text-caret-text shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
                            align="end"
                            sideOffset={4}
                            onMouseDown={stopMouseDown}
                        >
                            <CopyItem source={block.content} />
                            <LanguageMenu current={language} onPick={onPickLanguage} />
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            </div>
            <pre className="mdedit-code-block-pre">
                {block.content.length === 0 ? (
                    <code
                        data-block-content
                        className={`mdedit-code-block-code hljs language-${language || "plaintext"}`}
                    >
                        <br />
                    </code>
                ) : (
                    <code
                        data-block-content
                        className={`mdedit-code-block-code hljs language-${language || "plaintext"}`}
                        dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                )}
            </pre>
        </div>
    );
};
