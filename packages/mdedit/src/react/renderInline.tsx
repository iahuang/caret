/**
 * Render `(content, marks, inlineNodes)` into a tree of mark-wrapped text
 * and inline-atom elements.
 *
 * Atoms render as `<span data-atom-id ... data-atom-len="1" ...>`. Two
 * contracts they have with the DOM mapping:
 *   - `data-atom-len="1"` tells the walker the element is exactly 1 model
 *     character wide (regardless of inner text).
 *   - The element is `user-select: none` so native selection treats it as
 *     a unit; clicks inside the atom resolve to "just before" or "just
 *     after" via x-position.
 *
 * Pluggable: pass `inlineRenderers` to render new atom types. KaTeX is the
 * only one shipped here.
 */

import katex from "katex";
import { useMemo, type ReactNode } from "react";
import { INLINE_NODE_PLACEHOLDER, type InlineNode, type Mark } from "../core/types";

export interface MarkRenderer {
    type: string;
    render: (children: ReactNode, mark: Mark) => ReactNode;
}

export interface InlineNodeRenderer {
    type: string;
    render: (node: InlineNode) => ReactNode;
}

export const defaultMarkRenderers: MarkRenderer[] = [
    { type: "bold", render: (c) => <strong>{c}</strong> },
    { type: "italic", render: (c) => <em>{c}</em> },
    { type: "code", render: (c) => <code className="mdedit-code">{c}</code> },
    { type: "strike", render: (c) => <s>{c}</s> },
    {
        type: "link",
        render: (c, m) => (
            <a
                className="mdedit-link"
                href={String(m.attrs?.href ?? "")}
                data-link-id={String(m.attrs?.linkId ?? "")}
                onClick={(e) => e.preventDefault()}
                onMouseDown={(e) => {
                    // Allow Cmd/Ctrl-click to follow the link in a new tab.
                    if (e.metaKey || e.ctrlKey) {
                        const href = (m.attrs?.href as string | undefined) ?? "";
                        if (href) window.open(href, "_blank", "noopener,noreferrer");
                    }
                }}
            >
                {c}
            </a>
        ),
    },
];

function InlineMath({ latex }: { latex: string }) {
    const html = useMemo(() => {
        if (!latex.trim()) return "";
        try {
            return katex.renderToString(latex, {
                displayMode: false,
                throwOnError: false,
                output: "html",
            });
        } catch {
            return `<span class="mdedit-math-error">${escapeHtml(latex)}</span>`;
        }
    }, [latex]);
    if (!html) {
        return <span className="mdedit-math-empty mdedit-math-empty-inline">(math)</span>;
    }
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
    );
}

export const defaultInlineRenderers: InlineNodeRenderer[] = [
    {
        type: "math",
        render: (node) => <InlineMath latex={(node.data.latex as string | undefined) ?? ""} />,
    },
    {
        type: "image",
        render: (node) => (
            <img
                className="mdedit-inline-image"
                src={(node.data.src as string | undefined) ?? ""}
                alt={(node.data.alt as string | undefined) ?? ""}
                draggable={false}
            />
        ),
    },
];

export function renderInline(
    content: string,
    marks: Mark[],
    inlineNodes?: InlineNode[],
    markRenderers: MarkRenderer[] = defaultMarkRenderers,
    inlineRenderers: InlineNodeRenderer[] = defaultInlineRenderers,
): ReactNode {
    if (content.length === 0) return <br />;

    const markMap = new Map(markRenderers.map((r) => [r.type, r]));
    const inlineMap = new Map(inlineRenderers.map((r) => [r.type, r]));
    const atoms = [...(inlineNodes ?? [])].sort((a, b) => a.position - b.position);
    const atomByPos = new Map<number, InlineNode>();
    for (const a of atoms) atomByPos.set(a.position, a);

    const breakpoints = new Set<number>([0, content.length]);
    for (const m of marks) {
        breakpoints.add(m.start);
        breakpoints.add(m.end);
    }
    for (const a of atoms) {
        breakpoints.add(a.position);
        breakpoints.add(a.position + 1);
    }
    const points = Array.from(breakpoints).sort((a, b) => a - b);

    const out: ReactNode[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]!;
        const end = points[i + 1]!;
        if (start >= end) continue;

        const atom = end === start + 1 ? atomByPos.get(start) : undefined;
        if (atom) {
            const renderer = inlineMap.get(atom.type);
            out.push(
                <span
                    key={atom.id}
                    data-atom-id={atom.id}
                    data-atom-type={atom.type}
                    data-atom-len="1"
                    className="mdedit-inline-atom"
                    style={{ userSelect: "none" }}
                >
                    {renderer ? (
                        renderer.render(atom)
                    ) : (
                        <span className="mdedit-inline-atom-fallback">{INLINE_NODE_PLACEHOLDER}</span>
                    )}
                </span>,
            );
            continue;
        }

        const active = marks.filter((m) => m.start <= start && m.end >= end);
        const text = content.slice(start, end);
        let node: ReactNode = text;
        for (const m of active) {
            const r = markMap.get(m.type);
            if (r) node = r.render(node, m);
        }
        out.push(<span key={`${start}-${end}`}>{node}</span>);
    }
    return <>{out}</>;
}
