# caret

A native Markdown editor written in Tauri. Wraps a lightweight editor implmentation called mdedit.

RULES:

- While caret and mdedit will be developed in parallel, mdedit should be treated as a standalone library that should be shippable independently of caret.
- Prefer to make styling changes to caret rather than mdedit. mdedit intentionally provides very minimal styling defaults.

# mdedit

A small, modular markdown editor toolkit. No `contentEditable`. The DOM is the
layout engine; the data model is a flat array of blocks; markdown is canonical.

## Layout

```
packages/mdedit/
    src/core/         # PURE. No React, no DOM.
        types.ts                  # Block, Mark, InlineNode, Position, Selection, DocState
        marks.ts                  # offset-range mark math
        inlineNodes.ts            # same, but for inline atoms (one ￼ per atom)
        transform.ts              # insert/delete/split/merge — text + marks + atoms in lockstep
        commands.ts               # high-level (DocState) -> DocState
        store.ts                  # observable store + debounced history
        schema.ts                 # BlockSpec / MarkSpec, default schema
        markdown/{inline,parse,serialize}.ts
    src/react/        # React bindings. May import from core/.
        Editor.tsx                # top-level. Owns popover state, mouse, paste.
        useDomMapping.ts          # DOM <-> model bridge. caretPositionFromPoint lives here.
        Caret.tsx                 # drawn caret
        SelectionLayer.tsx        # drawn selection via Range.getClientRects
        BlockView.tsx, renderInline.tsx, defaultRenderer.tsx
        defaultKeymap.ts, useKeymap.ts
        NodePopover.tsx           # generic popover for atoms and atomic blocks
        HiddenInput.tsx           # offscreen textarea capturing keystrokes
apps/demo/                        # side-by-side editor + markdown preview
```

Two entry points: `mdedit/core` (pure) and `mdedit/react`.

## Run / type-check

```bash
bun install
bun run dev           # http://localhost:3000
bunx --bun tsc --noEmit -p tsconfig.json
```

KaTeX CSS is linked from `packages/mdedit/node_modules/katex/dist/katex.min.css`.

## Core design principles

1. **DOM is the layout engine.** No text measurement. Hit-tests via
   `caretPositionFromPoint`; geometry via `Range.getBoundingClientRect`.
2. **Flat array, not tree.** `Block[]`; text is a plain string; marks and atoms
   are offset-indexed metadata. Mutations are array splices.
3. **Strict core/react separation.** `core/` has zero React, zero DOM imports.
4. **Pluggable everywhere.** Block/mark/atom renderers, keymap, schema all
   passed in. Adding a type is a spec + renderer — no edits to `Editor.tsx`.
5. **Markdown is canonical.** Schema decides what round-trips. Stray delimiters
   emit verbatim; inline shortcuts make lossy re-parse rare.

## Key abstractions

```typescript
interface Block {
    id: string;
    type: BlockType;              // "paragraph" | "heading" | "bullet-item" | ...
    content: string;              // plain text with ￼ placeholders for atoms
    marks: Mark[];                // offset-range formatting
    inlineNodes?: InlineNode[];   // atoms positioned at the placeholders
    metadata?: Record<string, unknown>;
}

interface Mark { type: string; start: number; end: number; attrs?: ... }
// Half-open. Same type can merge but never overlap.

interface InlineNode { id: string; type: string; position: number; data: ... }
// Each atom = one ￼ character (INLINE_NODE_PLACEHOLDER). DOM atom elements
// have data-atom-len="1" so the walker treats them as one character.

interface Position {
    blockId: string;
    offset: number;
    affinity?: "upstream" | "downstream";   // for wrap boundaries
}

interface DocState { doc: Doc; selection: Selection | null; storedMarks?: MarkType[] | null }
```

`BlockSpec` = `(type, parse, serialize, tight?)`. `MarkSpec` = `(type, delimiter)`;
tokenizer pairs delimiters greedy-left-to-right.

## Critical mechanisms

### DOM bridge (`useDomMapping.ts`)

Renderer contracts:
- Root block has `data-block-id="<id>"`.
- Editable text container has `data-block-content`.
- Non-content elements (list markers, KaTeX displays) have `data-no-content="true"`.
- Inline atoms wrap in `<span data-atom-id data-atom-len="N">`.

Walker honors all four: `data-no-content` contributes 0 chars; `data-atom-len`
contributes N. Bridge exposes `positionFromPoint`, `rangeForPosition`,
`clientRectForPosition`, `rangeForSpan`, `isWrapBoundary`, `findBlockElement`.

### `charRectAt(blockEl, m)` — the geometry primitive

Finds the text node (or atom element) that owns `content[m]`, probes
`range(local, local + 1)` *inside that single node*. Load-bearing: cross-element
ranges give inconsistent `getClientRects` across browsers. Used by
`clientRectForPosition`, `isWrapBoundary`, `positionFromPoint` affinity.

**If you're tempted to build a cross-element range to measure geometry, use
`charRectAt` instead.**

### Stored marks (`commands.ts`)

`DocState.storedMarks` overrides "marks for the next typed character". When
null, active marks come from the character to the cursor's left
(`marksAtPosition`).

- Cmd-B at a collapsed cursor toggles `bold` in `storedMarks` without touching doc.
- Cursor movement clears `storedMarks` to null (every command that moves caret).
- `insertText` rectifies the inserted range via `ensureMarksOnRange`.
- After `applyInlineShortcuts` fires, `storedMarks` is set to `derived - sc.markType`
  so the cursor steps out of the just-applied mark.

### Wrap affinity

At a soft wrap, same offset has two visual positions. `affinity: "downstream"`
renders at start of continuation line; default `"upstream"` at end of prior line.
Set by `positionFromPoint` (compares click y), `moveByChar`/`moveByWord` via
`withWrapAffinity`, `moveToLineEdge`/`moveVertical` (flow through `positionFromPoint`).

Tradeoff: arrow keys never park at "upstream at a wrap" — that position is
click-only. Intentional.

### Hidden textarea (`HiddenInput.tsx`)

Offscreen, `pointer-events: none`, `opacity: 0`. Focused programmatically on
mousedown. After each `onInput`, value is cleared. IME composition is *not*
handled.

### Block math is atomic

`math-block` blocks have `content: ""` always; LaTeX in `metadata.latex`.
Renderer emits a tiny `data-block-content` anchor for caret navigation only.
`insertText` early-returns for `math-block` — popover is the only edit surface.

Inline math is the inverse: a real atom with `data.latex`.

### Popovers (`NodePopover.tsx`)

Generic: anchor selector + value + callbacks. Editor mounts one at a time via
the `popoverTarget` memo (atom-adjacent or inside math-block). Two states:
preview (read-only) and edit (focused; main caret hides because hidden input
loses focus).

Transitions in `Editor.tsx`:
- **Atom, enter via arrow:** ArrowRight at `offset === atom.position` /
  ArrowLeft at `offset === atom.position + 1` sets `editingId`.
- **Atom, enter via click:** mousedown on `[data-atom-id]` sets `editingId`
  and skips the usual `inputRef.focus`.
- **Math-block, auto-enter:** effect keyed on `popoverTarget.id`. Previous id
  in a ref so Escape doesn't retrigger immediately.
- **Exit via arrow:** `NodePopover` watches for ArrowLeft at offset 0 /
  ArrowRight at value.length. `exitPopover` moves caret past atom, clears
  `editingId`, refocuses hidden input. Select-all initial state requires one
  arrow press to collapse before edge-exit fires — intentional for type-to-replace.
- **Exit via Escape:** clears `editingId` only; caret stays.

### History (`store.ts`)

Debounced 400ms. Undo/redo operate on whole `DocState` (selection + storedMarks).

## Codebase conventions

- 4-space indent.
- `const` over `let`. Mutations confined to transforms.
- `function` declarations at module top-level; `() =>` for inline callbacks.
- No emojis in code, comments, or commit messages.
- No `contentEditable` anywhere.
- `core/` cannot import from `react/` or any DOM globals.
- Don't measure text. Use `charRectAt` or `caretPositionFromPoint`.
- Comments explain *why*, not *what*. Reserve for hidden constraints,
  surprising decisions, or workaround rationales.

## Known limitations

- **IME composition** unhandled (hidden textarea swallows events).
- **No virtualization.** Every block renders every frame.
- **Accessibility** limited — custom-drawn carets/selection/atoms are opaque to AT.
- **Arrow keys never visit upstream at a wrap** — click-only. Intentional.
- **Lossy round-trip** for stray delimiters (rare due to inline shortcuts).
- **No tables, images, code blocks, or task lists.** Each is a `BlockSpec` +
  `BlockRenderer` away. Code blocks would want a separate source edit mode.

## Debugging mental model

Most bugs are DOM-bridge invariants drifting when a new structural pattern
(atoms, mark wrappers, math blocks) shows up. Ask:

- Is `data-block-content` the only editable subtree, with text content matching
  the model (accounting for `data-atom-len`)?
- Does `charRectAt(m)` return the geometry of that exact glyph, with no
  cross-element range games?
- When the cursor moves, are affinity/stored-marks invariants cleared/preserved
  consistently across firing commands?
