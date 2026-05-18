import { readDir } from "@tauri-apps/plugin-fs";

export type EntryKind = "dir" | "file";

export interface FolderEntry {
    name: string;
    path: string;
    kind: EntryKind;
}

export function basename(path: string): string {
    const m = path.match(/[^\\/]+$/);
    return m ? m[0] : path;
}

export function dirname(path: string): string {
    const m = path.match(/^(.*)[\\/][^\\/]+$/);
    return m?.[1] ?? "";
}

export function isInside(parent: string, child: string): boolean {
    if (!parent) return false;
    const trimmed = parent.replace(/[\\/]+$/, "");
    return child.startsWith(trimmed + "/") || child.startsWith(trimmed + "\\");
}

// Pick the separator that the parent path is already using so children we
// produce stay consistent. Falls back to "/" on macOS/linux.
function sepFor(path: string): string {
    if (path.includes("\\") && !path.includes("/")) return "\\";
    return "/";
}

function joinPath(parent: string, child: string): string {
    const sep = sepFor(parent);
    const trimmed = parent.replace(/[\\/]+$/, "");
    return trimmed + sep + child;
}

// Returns the path segments between `root` and `file`, inclusive of `file`
// but exclusive of `root`. Used by the breadcrumb to render folder hops.
// Caller must ensure `file` is inside `root`; for the out-of-root edge case
// the breadcrumb falls back to rendering filename only.
export function segmentsBetween(root: string, file: string): string[] {
    const trimmedRoot = root.replace(/[\\/]+$/, "");
    if (!file.startsWith(trimmedRoot)) return [];
    const tail = file.slice(trimmedRoot.length).replace(/^[\\/]+/, "");
    return tail.split(/[\\/]+/).filter(Boolean);
}

// Single-level listing: subdirectories + .md files. Folders first, then files,
// each group sorted case-insensitively. Hidden entries (".git", ".DS_Store"...)
// are filtered out.
export async function listFolder(path: string): Promise<FolderEntry[]> {
    const entries = await readDir(path);
    const folders: FolderEntry[] = [];
    const files: FolderEntry[] = [];
    for (const e of entries) {
        if (e.isSymlink) continue;
        if (e.name.startsWith(".")) continue;
        if (e.isDirectory) {
            folders.push({ name: e.name, path: joinPath(path, e.name), kind: "dir" });
        } else if (e.isFile && /\.(md|markdown)$/i.test(e.name)) {
            files.push({ name: e.name, path: joinPath(path, e.name), kind: "file" });
        }
    }
    const byName = (a: FolderEntry, b: FolderEntry) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    folders.sort(byName);
    files.sort(byName);
    return [...folders, ...files];
}

const WALK_FILE_CAP = 5000;
const SKIP_DIRS = new Set(["node_modules"]);

export interface WalkResult {
    files: { path: string; relative: string }[];
    truncated: boolean;
}

// Recursive .md walk from `root`. Skips hidden dirs, symlinks, and `node_modules`.
// Hard-capped to WALK_FILE_CAP files — beyond that we return what we have and
// set `truncated`. Caller can decide whether to surface that to the user.
export async function walkMdFiles(root: string): Promise<WalkResult> {
    const files: { path: string; relative: string }[] = [];
    const trimmedRoot = root.replace(/[\\/]+$/, "");
    const sep = sepFor(root);
    const queue: string[] = [trimmedRoot];
    let truncated = false;

    while (queue.length > 0) {
        const dir = queue.shift()!;
        let entries;
        try {
            entries = await readDir(dir);
        } catch {
            // Unreadable directory (permissions, deleted between enumeration
            // and read) — skip silently rather than aborting the whole walk.
            continue;
        }
        for (const e of entries) {
            if (e.isSymlink) continue;
            if (e.name.startsWith(".")) continue;
            if (e.isDirectory) {
                if (SKIP_DIRS.has(e.name)) continue;
                queue.push(joinPath(dir, e.name));
            } else if (e.isFile && /\.(md|markdown)$/i.test(e.name)) {
                if (files.length >= WALK_FILE_CAP) {
                    truncated = true;
                    return { files, truncated };
                }
                const path = joinPath(dir, e.name);
                const relative = path.startsWith(trimmedRoot + sep)
                    ? path.slice(trimmedRoot.length + 1)
                    : path;
                files.push({ path, relative });
            }
        }
    }

    return { files, truncated };
}

export interface FuzzyMatch {
    score: number;
    indices: number[];
}

// Subsequence fuzzy match. Returns null if query chars don't appear in order.
// Score rewards consecutive matches and matches that land on path/word
// boundaries; earlier matches edge out later ones. Tuned for "good enough,"
// not fzf-grade — replace with a real algorithm if it ever bites.
export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
    if (!query) return { score: 0, indices: [] };
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    const indices: number[] = [];
    let qi = 0;
    let lastMatchTi = -2;
    let score = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] !== q[qi]) continue;
        indices.push(ti);
        if (ti === lastMatchTi + 1) score += 5;
        const prev = ti === 0 ? "/" : target[ti - 1]!;
        if (/[/\\\-_. ]/.test(prev)) score += 3;
        lastMatchTi = ti;
        qi++;
    }
    if (qi < q.length) return null;
    if (indices.length > 0) score -= indices[0]! / 20;
    return { score, indices };
}
