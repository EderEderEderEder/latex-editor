// Eingabe von „Gehe zu Zeile“ (Strg+G): „12“ oder „12:5“ (Zeile:Spalte, beides ab 1).

export const LINE_INPUT_TEXTS = {
    empty: 'Zeilennummer eingeben.',
    invalid: 'Keine gültige Eingabe. Erlaubt: „12“ oder „12:5“.',
    outOfRange: (lineCount: number): string => `Zeile außerhalb des Bereichs (1 bis ${lineCount}).`,
    columnInvalid: 'Spalte muss mindestens 1 sein.',
} as const;

export type LineInputResult =
    | { readonly ok: true; readonly line: number; readonly column?: number }
    | { readonly ok: false; readonly error: string };

const LINE_INPUT_PATTERN = /^(\d+)(?::(\d*))?$/;

function fail(error: string): LineInputResult {
    return { ok: false, error };
}

/** Prüft Text gegen Zeilenzahl des Dokuments; die Spalte wird nur als Zahl ≥ 1 geprüft (der Editor kürzt sie) */
export function parseLineInput(text: string, lineCount: number): LineInputResult {
    const trimmed = text.trim();
    if (trimmed === '') return fail(LINE_INPUT_TEXTS.empty);
    const match = LINE_INPUT_PATTERN.exec(trimmed);
    if (match === null || (trimmed.includes(':') && match[2] === '')) return fail(LINE_INPUT_TEXTS.invalid);
    const line = Number(match[1]);
    if (line < 1 || line > lineCount) return fail(LINE_INPUT_TEXTS.outOfRange(lineCount));
    if (match[2] === undefined) return { ok: true, line };
    const column = Number(match[2]);
    if (column < 1) return fail(LINE_INPUT_TEXTS.columnInvalid);
    return { ok: true, line, column };
}
