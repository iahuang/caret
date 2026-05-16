// Ambient declarations.
// As of late 2024 caretPositionFromPoint is Baseline and present in
// lib.dom.d.ts; this is a safety net for older TS lib targets. No `export {}`
// — keeping this file a script makes the declarations globally ambient.

interface CaretPosition {
    readonly offsetNode: Node;
    readonly offset: number;
    getClientRect(): DOMRect | null;
}

interface Document {
    caretPositionFromPoint(x: number, y: number): CaretPosition | null;
}
