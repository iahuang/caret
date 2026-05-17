import { forwardRef, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

// The editor swallows mousedown anywhere inside `[data-no-content]` and on the
// trigger itself, so stopping propagation here keeps a drag-select from
// starting when the user opens the menu. Radix portals the menu surface to
// document.body, so its own clicks land outside the editor entirely.
export function stopMouseDown(e: { stopPropagation: () => void }) {
    e.stopPropagation();
}

export const meatballMenuItemClass =
    "flex items-center gap-1.5 rounded px-2 py-1 text-xs text-caret-text cursor-pointer select-none outline-none data-[highlighted]:bg-caret-border data-[disabled]:cursor-default data-[disabled]:text-caret-text-faint";

export const meatballMenuIconClass =
    "inline-flex w-3.5 items-center justify-center text-caret-text-faint";

export const meatballMenuContentClass =
    "z-[70] min-w-[160px] rounded-md border border-caret-border bg-caret-surface p-1 font-sans text-xs text-caret-text shadow-[0_8px_24px_rgba(0,0,0,0.18)]";

const meatballTriggerBaseClass =
    "inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-caret-text-faint transition-opacity duration-150 hover:bg-caret-border hover:text-caret-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caret-link data-[state=open]:bg-caret-border data-[state=open]:text-caret-text";

interface MeatballTriggerProps {
    "aria-label": string;
    className?: string;
}

export const MeatballTrigger = forwardRef<HTMLButtonElement, MeatballTriggerProps>(
    function MeatballTrigger({ "aria-label": ariaLabel, className, ...rest }, ref) {
        return (
            <button
                ref={ref}
                type="button"
                aria-label={ariaLabel}
                onMouseDown={stopMouseDown}
                className={`${meatballTriggerBaseClass}${className ? ` ${className}` : ""}`}
                {...rest}
            >
                <Ellipsis size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
        );
    },
);

export interface MeatballMenuProps {
    triggerLabel: string;
    triggerClassName?: string;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
}

export function MeatballMenu({
    triggerLabel,
    triggerClassName,
    align = "end",
    side = "bottom",
    sideOffset = 4,
    open,
    onOpenChange,
    children,
}: MeatballMenuProps) {
    return (
        <DropdownMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>
            <DropdownMenu.Trigger asChild>
                <MeatballTrigger aria-label={triggerLabel} className={triggerClassName} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    className={meatballMenuContentClass}
                    align={align}
                    side={side}
                    sideOffset={sideOffset}
                    onMouseDown={stopMouseDown}
                >
                    {children}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
