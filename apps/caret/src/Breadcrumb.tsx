import { Fragment, forwardRef, useImperativeHandle, useRef } from "react";
import { Folder } from "lucide-react";
import { basename, isInside, segmentsBetween } from "./fileNavigation";

interface BreadcrumbProps {
    rootFolder: string | null;
    currentPath: string | null;
    isDirty: boolean;
    // Fires with the folder path the user clicked plus the DOM element to anchor
    // a popover against. Parent owns popover state.
    onSegmentClick: (folderPath: string, anchor: HTMLElement) => void;
}

export interface BreadcrumbHandle {
    // Opens the popover for the innermost folder — the parent of the current
    // file. Falls back to the root segment when the file lives at the root, or
    // does nothing when there's no root.
    openInnermost: () => void;
}

export const Breadcrumb = forwardRef<BreadcrumbHandle, BreadcrumbProps>(function Breadcrumb(
    { rootFolder, currentPath, isDirty, onSegmentClick },
    ref,
) {
    const innermostButtonRef = useRef<HTMLButtonElement>(null);
    const innermostPathRef = useRef<string | null>(null);

    useImperativeHandle(
        ref,
        () => ({
            openInnermost() {
                const btn = innermostButtonRef.current;
                const path = innermostPathRef.current;
                if (btn && path !== null) onSegmentClick(path, btn);
            },
        }),
        [onSegmentClick],
    );

    const displayName = currentPath ? basename(currentPath) : "Untitled";

    // No root at all: bare filename fallback (Cmd+Shift+N windows live here).
    // Also catches the defensive "file outside root" case — Save-As reroots
    // so we shouldn't hit it, but render sensibly if we do.
    const showBreadcrumb =
        rootFolder !== null &&
        (currentPath === null || isInside(rootFolder, currentPath));

    if (!showBreadcrumb) {
        // No innermost folder available — clear the ref so the shortcut is a no-op.
        innermostPathRef.current = null;
        return (
            <span
                data-tauri-drag-region
                className="flex items-center gap-1 text-xs leading-none text-caret-text-muted"
                title={currentPath ?? "Unsaved buffer"}
            >
                {displayName}
                {isDirty && <DirtyDot />}
            </span>
        );
    }

    const rootName = basename(rootFolder!);
    // For a never-saved buffer in a rooted window we have no path to slice;
    // the filename segment becomes "Untitled" with no intermediate folders.
    const segments = currentPath ? segmentsBetween(rootFolder!, currentPath) : [];
    // Final segment is the filename; everything before is an intermediate folder.
    const folderSegments = segments.slice(0, -1);

    // Build cumulative paths for each folder segment so clicks know which dir to open.
    const sep = rootFolder!.includes("\\") && !rootFolder!.includes("/") ? "\\" : "/";
    const trimmedRoot = rootFolder!.replace(/[\\/]+$/, "");
    const folderPaths = folderSegments.map((_, i) =>
        [trimmedRoot, ...folderSegments.slice(0, i + 1)].join(sep),
    );

    // Innermost folder = parent of the current file. The last entry in
    // folderPaths if any, else the root.
    const innermostPath =
        folderPaths.length > 0 ? folderPaths[folderPaths.length - 1]! : trimmedRoot;
    innermostPathRef.current = innermostPath;

    return (
        <span
            data-tauri-drag-region
            className="flex items-center gap-1 text-xs leading-none text-caret-text-muted min-w-0"
            title={currentPath ?? rootFolder!}
        >
            <Folder
                data-tauri-drag-region
                size={12}
                strokeWidth={1.75}
                aria-hidden="true"
                className="shrink-0 text-caret-text-faint"
            />
            <SegmentButton
                label={rootName}
                onClick={(anchor) => onSegmentClick(trimmedRoot, anchor)}
                buttonRef={folderSegments.length === 0 ? innermostButtonRef : undefined}
            />
            {folderSegments.map((name, i) => (
                <Fragment key={folderPaths[i]}>
                    <Separator />
                    <SegmentButton
                        label={name}
                        onClick={(anchor) => onSegmentClick(folderPaths[i]!, anchor)}
                        buttonRef={i === folderSegments.length - 1 ? innermostButtonRef : undefined}
                    />
                </Fragment>
            ))}
            <Separator />
            <span className="truncate text-caret-text">{displayName}</span>
            {isDirty && <DirtyDot />}
        </span>
    );
});

function SegmentButton({
    label,
    onClick,
    buttonRef,
}: {
    label: string;
    onClick: (anchor: HTMLElement) => void;
    buttonRef?: React.Ref<HTMLButtonElement>;
}) {
    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={(e) => onClick(e.currentTarget)}
            className="truncate rounded-sm px-1 -mx-1 py-0.5 leading-none transition-colors hover:bg-caret-border text-caret-text-muted hover:text-caret-text focus:outline-none focus:ring-1 focus:ring-caret-link duration-100"
        >
            {label}
        </button>
    );
}

function Separator() {
    return (
        <span
            data-tauri-drag-region
            aria-hidden="true"
            className="text-caret-text-faint/60 select-none"
        >
            /
        </span>
    );
}

function DirtyDot() {
    return (
        <span
            data-tauri-drag-region
            aria-label="Unsaved changes"
            className="bg-caret-text-faint w-1 h-1 rounded-full ml-0.5"
        />
    );
}
