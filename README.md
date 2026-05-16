# Caret

A native markdown editor built on [mdedit](packages/mdedit), packaged with Tauri.

## Layout

```
caret/
    apps/caret/              # the Tauri app
        src/                 # React frontend
        src-tauri/           # Rust backend / Tauri config
        vite.config.ts
        index.html
        package.json
    packages/mdedit/         # vendored copy of the mdedit toolkit
        src/core/            # pure: types, commands, store, schema, markdown
        src/react/           # React bindings: Editor, useDomMapping, ...
    package.json             # bun workspace root
    tsconfig.json
```

`mdedit` is kept self-contained — it has no awareness of caret. The caret app
consumes it via `import { Editor } from "mdedit/react"` and the `workspace:*`
dep declared in `apps/caret/package.json`. To pull in updates from the upstream
mdedit repo, copy `packages/mdedit/src/` over and re-run `bun install`.

## Develop

```bash
bun install
bun run tauri:dev      # launches Tauri + Vite
```

Vite alone (no native window) for quick iteration:

```bash
bun run dev            # http://localhost:1420
```

## Build

```bash
bun run tauri:build
```

## Type-check

```bash
bunx --bun tsc --noEmit -p tsconfig.json
```
