/**
 * Default block renderers.
 *
 * A `BlockRenderer` receives the block, the already-rendered inline content,
 * the block's index in the document, and the document. It returns JSX. The
 * only contract is:
 *   - The root element has `data-block-id={block.id}`.
 *   - The element wrapping `content` has `data-block-content`.
 *   - Non-content children (list markers, decorations) have `data-no-content="true"`.
 *
 * Anything else — styling, structure, even using a different inline renderer —
 * is up to the block author.
 */

import hljs from "highlight.js";
import katex from "katex";
import { useMemo, type ChangeEvent, type ReactNode } from "react";
import type { Block, Doc } from "../core/types";
import {
    countOrderedPosition,
    formatOrderedMarker,
    getOrderedStyle,
    getTableCellMeta,
    type ColAlignment,
} from "../core/schema";
import { useEditorActions } from "./editorContext";

export interface BlockRenderProps {
    block: Block;
    content: ReactNode;
    index: number;
    doc: Doc;
}

export type BlockRenderer = (props: BlockRenderProps) => ReactNode;

function Wrap({
    block,
    children,
    className,
    style,
}: {
    block: Block;
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    return (
        <div
            data-block-id={block.id}
            data-block-type={block.type}
            className={`mdedit-block ${className ?? ""}`}
            style={style}
        >
            <div data-block-content>{children}</div>
        </div>
    );
}

export const paragraphRenderer: BlockRenderer = ({ block, content }) => (
    <Wrap block={block} className="mdedit-paragraph">
        {content}
    </Wrap>
);

export const headingRenderer: BlockRenderer = ({ block, content }) => {
    const level = (block.metadata?.level as number | undefined) ?? 1;
    return (
        <Wrap block={block} className={`mdedit-heading mdedit-heading-${level}`}>
            {content}
        </Wrap>
    );
};

const INDENT_PX = 24;

function getIndent(block: Block): number {
    return (block.metadata?.indent as number | undefined) ?? 0;
}

export const bulletItemRenderer: BlockRenderer = ({ block, content }) => {
    const indent = getIndent(block);
    return (
        <div
            data-block-id={block.id}
            data-block-type={block.type}
            className="mdedit-bullet-item mdedit-list-item"
            style={{ marginLeft: indent * INDENT_PX }}
        >
            <span className="mdedit-list-marker" data-no-content="true">
                •
            </span>
            <div data-block-content className="mdedit-list-content">
                {content}
            </div>
        </div>
    );
};

export const taskItemRenderer: BlockRenderer = ({ block, content }) => {
    const indent = getIndent(block);
    const checked = (block.metadata?.checked as boolean | undefined) ?? false;
    const actions = useEditorActions();
    return (
        <div
            data-block-id={block.id}
            data-block-type={block.type}
            className={`mdedit-task-item mdedit-list-item${checked ? " mdedit-task-checked" : ""}`}
            style={{ marginLeft: indent * INDENT_PX }}
        >
            <span className="mdedit-list-marker mdedit-task-marker" data-no-content="true">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                        actions.updateBlockMetadata(block.id, { checked: e.target.checked })
                    }
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label="Toggle task"
                />
            </span>
            <div data-block-content className="mdedit-list-content">
                {content}
            </div>
        </div>
    );
};

/**
 * Horizontal rule: atomic block, no content, no marks. The visible `<hr>` is
 * marked `data-no-content` so the DOM walker treats it as zero characters.
 * The thin anchor below holds a position the caret can land on for navigation,
 * but `insertText` is a no-op (see commands.ts).
 */
export const hrRenderer: BlockRenderer = ({ block }) => (
    <div data-block-id={block.id} data-block-type={block.type} className="mdedit-hr-block">
        <hr className="mdedit-hr" data-no-content="true" />
        <div data-block-content className="mdedit-hr-anchor">
            <br />
        </div>
    </div>
);

export const orderedItemRenderer: BlockRenderer = ({ block, content, index, doc }) => {
    const indent = getIndent(block);
    const style = getOrderedStyle(block);
    const num = countOrderedPosition(doc, index);
    const marker = formatOrderedMarker(num, style);
    return (
        <div
            data-block-id={block.id}
            data-block-type={block.type}
            className="mdedit-ordered-item mdedit-list-item"
            style={{ marginLeft: indent * INDENT_PX }}
        >
            <span className="mdedit-list-marker" data-no-content="true">
                {marker}.
            </span>
            <div data-block-content className="mdedit-list-content">
                {content}
            </div>
        </div>
    );
};

function MathBlockDisplay({ latex }: { latex: string }) {
    const html = useMemo(() => {
        if (!latex.trim()) return "";
        try {
            return katex.renderToString(latex, {
                displayMode: true,
                throwOnError: false,
                output: "html",
            });
        } catch {
            return "";
        }
    }, [latex]);
    if (!html) {
        return <div className="mdedit-math-empty">(empty math block)</div>;
    }
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Block math is atomic: KaTeX renders the display, the LaTeX source lives in
 * `block.metadata.latex`, and editing happens via the popover the editor mounts
 * when the caret is inside this block. The `data-block-content` element is a
 * tiny anchor so the caret can still land in the block for navigation, but
 * `insertText` is a no-op here.
 */
// Languages exposed in the code-block dropdown. Kept small on purpose — the
// full highlight.js bundle ships every language already, but most users only
// reach for a handful, and a 100-item dropdown is worse UX than a curated list.
// Custom renderers can extend or replace this list.
export const DEFAULT_CODE_LANGUAGES: ReadonlyArray<{ id: string; label: string }> = [
    { id: "", label: "plain text" },
    { id: "bash", label: "bash" },
    { id: "c", label: "C" },
    { id: "cpp", label: "C++" },
    { id: "csharp", label: "C#" },
    { id: "css", label: "CSS" },
    { id: "diff", label: "diff" },
    { id: "go", label: "Go" },
    { id: "html", label: "HTML" },
    { id: "java", label: "Java" },
    { id: "javascript", label: "JavaScript" },
    { id: "json", label: "JSON" },
    { id: "kotlin", label: "Kotlin" },
    { id: "markdown", label: "Markdown" },
    { id: "php", label: "PHP" },
    { id: "python", label: "Python" },
    { id: "ruby", label: "Ruby" },
    { id: "rust", label: "Rust" },
    { id: "scss", label: "SCSS" },
    { id: "shell", label: "Shell" },
    { id: "sql", label: "SQL" },
    { id: "swift", label: "Swift" },
    { id: "toml", label: "TOML" },
    { id: "typescript", label: "TypeScript" },
    { id: "xml", label: "XML" },
    { id: "yaml", label: "YAML" },
];

function highlightToHtml(source: string, language: string): string {
    if (source.length === 0) return "";
    if (language && hljs.getLanguage(language)) {
        try {
            return hljs.highlight(source, { language, ignoreIllegals: true }).value;
        } catch {
            // Fall through to plain rendering.
        }
    }
    // Plain text: escape HTML so `<`, `>`, `&` don't break the DOM. The text
    // content must equal `source` exactly for the DOM bridge to map offsets.
    return source
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export const codeBlockRenderer: BlockRenderer = ({ block }) => {
    const language = ((block.metadata?.language as string | undefined) ?? "").trim();
    const actions = useEditorActions();
    const highlighted = useMemo(() => highlightToHtml(block.content, language), [block.content, language]);
    const onLanguageChange = (e: ChangeEvent<HTMLSelectElement>) => {
        actions.updateBlockMetadata(block.id, { language: e.target.value });
    };
    return (
        <div data-block-id={block.id} data-block-type={block.type} className="mdedit-code-block">
            <div className="mdedit-code-block-toolbar" data-no-content="true" contentEditable={false}>
                <select
                    className="mdedit-code-block-lang"
                    value={language}
                    onChange={onLanguageChange}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label="Code block language"
                >
                    {DEFAULT_CODE_LANGUAGES.some((l) => l.id === language) ? null : (
                        <option value={language}>{language || "plain text"}</option>
                    )}
                    {DEFAULT_CODE_LANGUAGES.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.label}
                        </option>
                    ))}
                </select>
            </div>
            <pre className="mdedit-code-block-pre">
                {block.content.length === 0 ? (
                    <code data-block-content className={`mdedit-code-block-code hljs language-${language || "plaintext"}`}>
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

export const blockquoteRenderer: BlockRenderer = ({ block, content }) => {
    const depth = (block.metadata?.depth as number | undefined) ?? 1;
    // Pass depth as a CSS custom property. The stylesheet paints `depth`
    // vertical bars via a single repeating-linear-gradient sized to
    // `depth * step`, so each block of depth N draws bars at every outer
    // level — making the outer bar continuous across nested-block rows
    // (which a per-block border-left can't, since deeper blocks live at
    // a different left offset).
    return (
        <Wrap
            block={block}
            className="mdedit-blockquote"
            style={{ "--mdedit-quote-depth": depth } as React.CSSProperties}
        >
            {content}
        </Wrap>
    );
};

export const mathBlockRenderer: BlockRenderer = ({ block }) => {
    const latex = (block.metadata?.latex as string | undefined) ?? "";
    return (
        <div data-block-id={block.id} data-block-type={block.type} className="mdedit-math-block">
            <div className="mdedit-math-block-display" data-no-content="true">
                <MathBlockDisplay latex={latex} />
            </div>
            <div data-block-content className="mdedit-math-block-anchor">
                <br />
            </div>
        </div>
    );
};

function alignmentStyle(a: ColAlignment): React.CSSProperties | undefined {
    if (a === "left") return { textAlign: "left" };
    if (a === "center") return { textAlign: "center" };
    if (a === "right") return { textAlign: "right" };
    return undefined;
}

/**
 * Table cell. The cell element itself carries `data-block-id` and the inner
 * div carries `data-block-content`, mirroring `paragraphRenderer`. The
 * surrounding <table>/<thead>/<tbody>/<tr> wrappers are emitted by the
 * RenderedBlocks grouping pass (BlockView.tsx) and marked `data-no-content`
 * so the DOM walker steps over them.
 */
export const tableCellRenderer: BlockRenderer = ({ block, content }) => {
    const meta = getTableCellMeta(block);
    const align = meta?.alignment[meta.col] ?? null;
    const style = alignmentStyle(align);
    const Tag = meta?.isHeader ? "th" : "td";
    return (
        <Tag
            data-block-id={block.id}
            data-block-type={block.type}
            className={`mdedit-table-cell${meta?.isHeader ? " mdedit-table-cell-header" : ""}`}
            style={style}
        >
            <div data-block-content className="mdedit-table-cell-content">
                {content}
            </div>
        </Tag>
    );
};

export const defaultRenderers: Record<string, BlockRenderer> = {
    paragraph: paragraphRenderer,
    heading: headingRenderer,
    "bullet-item": bulletItemRenderer,
    "ordered-item": orderedItemRenderer,
    "task-item": taskItemRenderer,
    "math-block": mathBlockRenderer,
    "code-block": codeBlockRenderer,
    blockquote: blockquoteRenderer,
    "table-cell": tableCellRenderer,
    hr: hrRenderer,
};
