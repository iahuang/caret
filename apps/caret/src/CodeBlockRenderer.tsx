import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, Languages } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import hljs from "highlight.js";
import {
    DEFAULT_CODE_LANGUAGES,
    useEditorActions,
    type BlockRenderer,
} from "mdedit/react";
import {
    MeatballMenu,
    meatballMenuContentClass,
    meatballMenuIconClass,
    meatballMenuItemClass,
    stopMouseDown,
} from "./MeatballMenu";

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
            <DropdownMenu.SubTrigger className={meatballMenuItemClass}>
                <span className={meatballMenuIconClass}>
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
                    className={`${meatballMenuContentClass} max-h-80 overflow-y-auto`}
                    sideOffset={4}
                    onMouseDown={stopMouseDown}
                >
                    <DropdownMenu.RadioGroup value={current} onValueChange={onPick}>
                        {!known && current ? (
                            <DropdownMenu.RadioItem value={current} className={meatballMenuItemClass}>
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
                                className={meatballMenuItemClass}
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
            className={meatballMenuItemClass}
            onSelect={(e) => {
                e.preventDefault();
                onCopy();
            }}
        >
            <span className={meatballMenuIconClass}>
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

// Hover-only visibility: parent `.group` gives the trigger its visibility
// cue. The shared base class already covers hover/open color states.
const codeBlockTriggerClassName =
    "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100";

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
                <MeatballMenu
                    triggerLabel="Code block options"
                    triggerClassName={codeBlockTriggerClassName}
                >
                    <CopyItem source={block.content} />
                    <LanguageMenu current={language} onPick={onPickLanguage} />
                </MeatballMenu>
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
