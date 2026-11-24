// Zeitbudgets des fertigen Editors (alle Erweiterungen aktiv) bei 10.000 Zeilen, in Millisekunden.
// Gemessen wird der schnellste von fünf Läufen (Kennzahl: p95 bzw. der Einzelwert); die Budgets liegen
// etwa beim Dreifachen des Messwerts (Intel-Mac, 2026-11-24), mindestens aber bei den Zielwerten des Spikes S1.
// Ein überschrittenes Budget ist ein Fehler, kein Anlass, das Budget zu erhöhen: erst die Ursache suchen.

/** Zielwert aus Spike S1 und Plan M1: Tastendruck p95 unter einem Rahmen bei 60 Hz */
export const TARGET_KEYSTROKE_P95_MS = 16;
/** Zielwert aus Spike S1 und Plan M1: Öffnen bei 10.000 Zeilen */
export const TARGET_OPEN_MS = 200;

/** Messwert 42 ms (Mac, kalt, mit allen Erweiterungen); dreifach wären 127 ms, daher gilt der Zielwert */
export const BUDGET_OPEN_MS = TARGET_OPEN_MS;
/** Messwert 4,5 ms; dreifach 14 ms, mindestens der Zielwert */
export const BUDGET_KEYSTROKE_MIDDLE_P95_MS = TARGET_KEYSTROKE_P95_MS;
/** Messwert 3,5 ms; dreifach 11 ms, mindestens der Zielwert */
export const BUDGET_KEYSTROKE_START_P95_MS = TARGET_KEYSTROKE_P95_MS;
/** Messwert 5,4 ms (öffnet Mathe bis zum Absatzende); dreifach 16 ms */
export const BUDGET_KEYSTROKE_DOLLAR_P95_MS = TARGET_KEYSTROKE_P95_MS;
/** Messwert 7,9 ms; dreifach wären 24 ms, aber „Tastendruck p95 < 16 ms“ ist die Vorgabe von M1, deshalb nur zweifacher Puffer */
export const BUDGET_KEYSTROKE_ENTER_P95_MS = TARGET_KEYSTROKE_P95_MS;
/** Messwert 6,8 ms Arbeit je Rahmen; dreifach 20 ms (ein Rahmen bei 60 Hz hat 16,7 ms) */
export const BUDGET_SCROLL_FRAME_P95_MS = 20;
/** Messwert 80 ms für einen Treffer ganz am Ende der Datei (Worst Case); dreifach 240 ms */
export const BUDGET_SEARCH_FIRST_HIT_MS = 250;
/** Messwert 5,6 ms: Scan aller Bereiche (eine Hauptthread-Aufgabe) bis zum Rahmen mit der neuen Marke; dreifach 17 ms */
export const BUDGET_FOLD_SCAN_FRAME_MS = 20;

export interface NamedBudget {
    readonly name: string;
    readonly milliseconds: number;
}

export const ALL_BUDGETS: readonly NamedBudget[] = [
    { name: 'BUDGET_OPEN_MS', milliseconds: BUDGET_OPEN_MS },
    { name: 'BUDGET_KEYSTROKE_MIDDLE_P95_MS', milliseconds: BUDGET_KEYSTROKE_MIDDLE_P95_MS },
    { name: 'BUDGET_KEYSTROKE_START_P95_MS', milliseconds: BUDGET_KEYSTROKE_START_P95_MS },
    { name: 'BUDGET_KEYSTROKE_DOLLAR_P95_MS', milliseconds: BUDGET_KEYSTROKE_DOLLAR_P95_MS },
    { name: 'BUDGET_KEYSTROKE_ENTER_P95_MS', milliseconds: BUDGET_KEYSTROKE_ENTER_P95_MS },
    { name: 'BUDGET_SCROLL_FRAME_P95_MS', milliseconds: BUDGET_SCROLL_FRAME_P95_MS },
    { name: 'BUDGET_SEARCH_FIRST_HIT_MS', milliseconds: BUDGET_SEARCH_FIRST_HIT_MS },
    { name: 'BUDGET_FOLD_SCAN_FRAME_MS', milliseconds: BUDGET_FOLD_SCAN_FRAME_MS },
];
