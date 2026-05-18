/**
 * Word boundary scans for cursor-by-word movement (Alt+Arrow, Cmd+Backspace).
 */

function isWordChar(c: string | undefined): boolean {
    if (c === undefined) return false;
    return /[\p{L}\p{N}_']/u.test(c);
}

export function findWordBoundaryBackward(content: string, offset: number): number {
    let i = Math.min(Math.max(offset, 0), content.length);
    while (i > 0 && !isWordChar(content[i - 1])) i--;
    while (i > 0 && isWordChar(content[i - 1])) i--;
    return i;
}

export function findWordBoundaryForward(content: string, offset: number): number {
    let i = Math.min(Math.max(offset, 0), content.length);
    while (i < content.length && !isWordChar(content[i])) i++;
    while (i < content.length && isWordChar(content[i])) i++;
    return i;
}
