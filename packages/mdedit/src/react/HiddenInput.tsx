/**
 * Offscreen textarea that captures all keyboard input.
 *
 * `pointer-events: none` so it never intercepts mouse clicks (the editor
 * container catches those and programmatically focuses this element).
 *
 * `position: fixed` (not absolute) so the textarea is anchored to the
 * viewport rather than to the editor's scrollable content. If we leave it
 * at `top: 0` inside a tall, scrolled editor, the browser scrolls the
 * nearest scrollable ancestor on every keystroke to keep the textarea's
 * caret in view — yanking the user back to the top of the document while
 * they're typing. Fixed positioning keeps the textarea "already visible"
 * so no scroll-into-view ever fires.
 *
 * IME composition is not handled here — extending this component with
 * onCompositionStart/Update/End would route composition text through the
 * editor's command pipeline.
 */

import { forwardRef, type TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const HiddenInput = forwardRef<HTMLTextAreaElement, Props>(function HiddenInput(props, ref) {
    return (
        <textarea
            ref={ref}
            {...props}
            tabIndex={-1}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: 1,
                height: 1,
                padding: 0,
                margin: 0,
                border: 0,
                outline: "none",
                resize: "none",
                overflow: "hidden",
                opacity: 0,
                pointerEvents: "none",
                ...props.style,
            }}
        />
    );
});
