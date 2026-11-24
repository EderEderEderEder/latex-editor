// Tippen (W1-10b): CodeMirror-Anbindung der Tipp-Logik aus `shared/core/textEditing.ts` (Klammern, Enter,
// Kommentar, Einrücken, Zeilen, Formatierung). Die Logik liefert ein `TextEdit`; hier wird es als genau eine
// Transaktion (ein Undo-Schritt) angewendet. Gegenstück in Swift: Typing-Teil von `LatexTextView`.
import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, EditorState, Facet, Prec, StateField } from '@codemirror/state';
import type { Extension, Text, Transaction, TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import {
    DEFAULT_TEXT_EDITING_SETTINGS, FORMAT_COMMANDS, deleteBackward, deleteLines, duplicateLines, indent, insertTab,
    moveLines, newline, outdent, toggleComment, typed, wrap,
} from '../../shared/core/textEditing';
import type { Replacement, Selection as TextSelection, TextEdit, TextEditingSettings } from '../../shared/core/textEditing';
import type { FeatureContext } from './extensions';

// ---------- Einstellungen ----------

/**
 * Einrückungseinheit und „Klammern automatisch schließen“. Standard: Tabulator, Klammern an. Der Settings-Store
 * liefert später `typingSettings.of(...)` (bei Änderung über ein `Compartment`).
 */
export const typingSettings = Facet.define<TextEditingSettings, TextEditingSettings>({
    combine: (values) => values[0] ?? DEFAULT_TEXT_EDITING_SETTINGS,
});

// ---------- Tastenbelegung ----------

/**
 * Windows-Belegung ohne Strg+Alt (AltGr); `Mod` ist Strg (macOS: ⌘). Abweichungen von CodeMirror-Standard:
 * Strg+I (dort „Übergeordnete Syntax wählen“, ohne Syntaxbaum unbrauchbar), Alt+↑/↓, Umschalt+Alt+↑/↓,
 * Umschalt+Strg+K und Strg+/ (dort eigene Zeilenbefehle bzw. `toggleComment` ohne Kommentarsyntax für LaTeX).
 * Strg+B bleibt frei für „Kompilieren“, daher Fett mit Umschalt+Strg+B (wie ⇧⌘B in der Swift-Version).
 */
export const TYPING_KEYS = {
    backspace: 'Backspace',
    shiftBackspace: 'Shift-Backspace',
    enter: 'Enter',
    tab: 'Tab',
    shiftTab: 'Shift-Tab',
    toggleComment: 'Mod-/',
    moveUp: 'Alt-ArrowUp',
    moveDown: 'Alt-ArrowDown',
    duplicateUp: 'Shift-Alt-ArrowUp',
    duplicateDown: 'Shift-Alt-ArrowDown',
    deleteLines: 'Shift-Mod-k',
    bold: 'Shift-Mod-b',
    italic: 'Mod-i',
    monospace: 'Shift-Mod-m',
} as const;

/** `userEvent`-Annotationen je Art; nur Tippen und Rückschritt dürfen sich im Verlauf mit Nachbarn verbinden */
export const TYPING_EVENTS = {
    type: 'input.type',
    backspace: 'delete.backward',
    newline: 'input.newline',
    comment: 'input.comment',
    indent: 'input.indent',
    outdent: 'input.outdent',
    move: 'input.move',
    duplicate: 'input.duplicate',
    deleteLines: 'delete.line',
    format: 'input.format',
} as const;

const JOINABLE_EVENTS: ReadonlySet<string> = new Set([TYPING_EVENTS.type, TYPING_EVENTS.backspace]);
/** Nur diese Zeichen kann `typed` behandeln (öffnende und schließende Klammern, `$`) */
const AUTO_PAIR_TRIGGER = /^[{}[\]()$]$/;

// ---------- Anwenden ----------

/** Was Befehle brauchen; `EditorView` und ein Test-Stand (`{ state, dispatch }`) erfüllen es beide */
export interface CommandTarget {
    readonly state: EditorState;
    dispatch(transaction: Transaction): void;
    readonly composing?: boolean;
    readonly compositionStarted?: boolean;
}

/** Eine laufende IME-Eingabe (Komposition) darf nie verändert werden */
export function isImeActive(target: { readonly composing?: boolean; readonly compositionStarted?: boolean }): boolean {
    return target.composing === true || target.compositionStarted === true;
}

/** Ersetzungen, die den Text nicht ändern (z. B. Ausrücken ohne Einrückung), entfallen */
function effectiveChanges(doc: Text, changes: readonly Replacement[]): Replacement[] {
    return changes.filter((change) => doc.sliceString(change.from, change.to) !== change.insert);
}

/** Die Transaktion zu einer Bearbeitung (rein, ohne View): Änderungen, Auswahl, `userEvent`, Verlauf */
export function textEditTransaction(state: EditorState, edit: TextEdit, userEvent: string): TransactionSpec {
    const changes = state.changes(effectiveChanges(state.doc, edit.changes));
    const clamp = (offset: number): number => Math.min(Math.max(offset, 0), changes.newLength);
    const spec: TransactionSpec = {
        changes,
        selection: EditorSelection.single(clamp(edit.selection.from), clamp(edit.selection.to)),
        userEvent,
        scrollIntoView: true,
    };
    return JOINABLE_EVENTS.has(userEvent) ? spec : { ...spec, annotations: isolateHistory.of('full') };
}

// ---------- Grenzen im Verlauf ----------

type EditKind = 'type' | 'delete';

const TYPE_EVENT_PREFIX = 'input.type';
const DELETE_EVENT_PREFIX = 'delete';

function editKindOf(tr: Transaction): EditKind | null {
    if (!tr.docChanged) return null;
    if (tr.isUserEvent(TYPE_EVENT_PREFIX)) return 'type';
    if (tr.isUserEvent(DELETE_EVENT_PREFIX)) return 'delete';
    return null;
}

/** Art der letzten Textänderung (Tippen, Löschen oder etwas anderes) */
const lastEditKind = StateField.define<EditKind | null>({
    create: () => null,
    update: (kind, tr) => (tr.docChanged ? editKindOf(tr) : kind),
});

/**
 * CodeMirror fasst Tippen und Löschen kurz hintereinander (unter 0,5 s) zu einem Undo-Schritt zusammen. Hier beginnt
 * beim Wechsel zwischen beiden ein neuer Schritt, wie in der Swift-Version (dort registriert `apply` jede Bearbeitung
 * der Tipp-Logik eigens): Rückgängig nach dem paarweisen Löschen bringt nur das Klammerpaar zurück.
 */
export const undoStepOnEditKindChange: Extension = [
    lastEditKind,
    EditorState.transactionExtender.of((tr) => {
        const kind = editKindOf(tr);
        const previous = tr.startState.field(lastEditKind, false) ?? null;
        if (kind === null || previous === null || kind === previous) return null;
        return { annotations: isolateHistory.of('before') };
    }),
];

/** Wendet eine Bearbeitung als EINE Transaktion an (ein Undo-Schritt) */
export function applyTextEdit(target: CommandTarget, edit: TextEdit, userEvent: string): void {
    target.dispatch(target.state.update(textEditTransaction(target.state, edit, userEvent)));
}

// ---------- Logik auf einem Textfenster ----------

/** Wie viel Text um die Auswahl die Logik braucht: ganze Zeilen davor/dahinter und mindestens so viele Zeichen */
interface WindowProfile {
    readonly linesBefore: number;
    readonly linesAfter: number;
    readonly charsAfter: number;
}

/** Klammern, Rückschritt: nur die Zeilen der Auswahl */
const SELECTED_LINES: WindowProfile = { linesBefore: 0, linesAfter: 0, charsAfter: 0 };
/** Zeilenbefehle: eine Zeile davor, zwei dahinter (Nachbarzeile samt ihrem Zeilenumbruch) */
const LINE_BLOCK: WindowProfile = { linesBefore: 1, linesAfter: 2, charsAfter: 0 };
/** Enter sucht ein passendes `\end` so weit voraus (`END_SEARCH_LENGTH` in `textEditing.ts`) */
const NEWLINE_LOOKAHEAD: WindowProfile = { linesBefore: 0, linesAfter: 0, charsAfter: 50_000 };

function windowRange(doc: Text, selection: TextSelection, profile: WindowProfile): TextSelection {
    const first = doc.lineAt(selection.from);
    const last = doc.lineAt(selection.to);
    const start = doc.line(Math.max(1, first.number - profile.linesBefore));
    const end = doc.line(Math.min(doc.lines, last.number + profile.linesAfter));
    return { from: start.from, to: Math.min(doc.length, Math.max(end.to, selection.to + profile.charsAfter)) };
}

function shiftedBy(edit: TextEdit, offset: number): TextEdit {
    return {
        changes: edit.changes.map((change) => ({
            from: change.from + offset, to: change.to + offset, insert: change.insert,
        })),
        selection: { from: edit.selection.from + offset, to: edit.selection.to + offset },
    };
}

type EditLogic = (text: string, selection: TextSelection) => TextEdit | null;

/** Die Logik arbeitet nur auf dem Fenster um die Auswahl (kein `doc.toString()` je Tastendruck) */
export function editInWindow(state: EditorState, profile: WindowProfile, logic: EditLogic): TextEdit | null {
    const { from, to } = state.selection.main;
    const range = windowRange(state.doc, { from, to }, profile);
    const text = state.doc.sliceString(range.from, range.to);
    const edit = logic(text, { from: from - range.from, to: to - range.from });
    return edit === null ? null : shiftedBy(edit, range.from);
}

// ---------- Eingetippte Zeichen ----------

/** Die Bearbeitung für ein eingetipptes Zeichen, oder `null` = CodeMirror tippt normal (Paste, Ersetzen, Mehrfachauswahl …) */
export function typedCharacterEdit(state: EditorState, from: number, to: number, text: string): TextEdit | null {
    if (!AUTO_PAIR_TRIGGER.test(text) || state.readOnly || state.selection.ranges.length !== 1) return null;
    const main = state.selection.main;
    if (main.from !== from || main.to !== to) return null;
    const settings = state.facet(typingSettings);
    return editInWindow(state, SELECTED_LINES, (window, selection) => typed(text, window, selection, settings));
}

function handleTypedInput(view: EditorView, from: number, to: number, text: string): boolean {
    if (isImeActive(view)) return false;
    const edit = typedCharacterEdit(view.state, from, to, text);
    if (edit === null) return false;
    applyTextEdit(view, edit, TYPING_EVENTS.type);
    return true;
}

// ---------- Befehle ----------

export type TypingCommand = (target: CommandTarget) => boolean;
type SettingsLogic = (text: string, selection: TextSelection, settings: TextEditingSettings) => TextEdit | null;

function mayIntervene(target: CommandTarget): boolean {
    return !isImeActive(target) && !target.state.readOnly && target.state.selection.ranges.length === 1;
}

/** `true` nur, wenn die Logik eingegriffen hat; sonst bleibt der Standardbefehl von CodeMirror dran */
function editCommand(userEvent: string, profile: WindowProfile, logic: SettingsLogic): TypingCommand {
    return (target) => {
        if (!mayIntervene(target)) return false;
        const settings = target.state.facet(typingSettings);
        const edit = editInWindow(target.state, profile, (text, selection) => logic(text, selection, settings));
        if (edit === null) return false;
        applyTextEdit(target, edit, userEvent);
        return true;
    };
}

/** Nach oben doppeln: Kopie steht darunter, die Auswahl bleibt auf den oberen Zeilen */
function duplicatedKeepingSelection(text: string, selection: TextSelection): TextEdit {
    return { ...duplicateLines(text, selection), selection };
}

const formatCommand = (command: string, userEvent: string = TYPING_EVENTS.format): TypingCommand =>
    editCommand(userEvent, LINE_BLOCK, (text, selection) => wrap(command, text, selection));

export const typingCommands = {
    deleteBackward: editCommand(TYPING_EVENTS.backspace, SELECTED_LINES, deleteBackward),
    newline: editCommand(TYPING_EVENTS.newline, NEWLINE_LOOKAHEAD, newline),
    insertTab: editCommand(TYPING_EVENTS.indent, LINE_BLOCK, insertTab),
    outdent: editCommand(TYPING_EVENTS.outdent, LINE_BLOCK, outdent),
    indent: editCommand(TYPING_EVENTS.indent, LINE_BLOCK, indent),
    toggleComment: editCommand(TYPING_EVENTS.comment, LINE_BLOCK, toggleComment),
    moveLinesUp: editCommand(TYPING_EVENTS.move, LINE_BLOCK, (text, selection) => moveLines(true, text, selection)),
    moveLinesDown: editCommand(TYPING_EVENTS.move, LINE_BLOCK, (text, selection) => moveLines(false, text, selection)),
    duplicateLinesUp: editCommand(TYPING_EVENTS.duplicate, LINE_BLOCK, duplicatedKeepingSelection),
    duplicateLinesDown: editCommand(TYPING_EVENTS.duplicate, LINE_BLOCK, duplicateLines),
    deleteLines: editCommand(TYPING_EVENTS.deleteLines, LINE_BLOCK, deleteLines),
    bold: formatCommand(FORMAT_COMMANDS.bold),
    italic: formatCommand(FORMAT_COMMANDS.emphasis),
    monospace: formatCommand(FORMAT_COMMANDS.monospace),
} as const satisfies Record<string, TypingCommand>;

export const typingKeymap: readonly KeyBinding[] = [
    { key: TYPING_KEYS.backspace, run: typingCommands.deleteBackward },
    { key: TYPING_KEYS.shiftBackspace, run: typingCommands.deleteBackward },
    { key: TYPING_KEYS.enter, run: typingCommands.newline },
    { key: TYPING_KEYS.tab, run: typingCommands.insertTab },
    { key: TYPING_KEYS.shiftTab, run: typingCommands.outdent },
    { key: TYPING_KEYS.toggleComment, run: typingCommands.toggleComment, preventDefault: true },
    { key: TYPING_KEYS.moveUp, run: typingCommands.moveLinesUp, preventDefault: true },
    { key: TYPING_KEYS.moveDown, run: typingCommands.moveLinesDown, preventDefault: true },
    { key: TYPING_KEYS.duplicateUp, run: typingCommands.duplicateLinesUp, preventDefault: true },
    { key: TYPING_KEYS.duplicateDown, run: typingCommands.duplicateLinesDown, preventDefault: true },
    { key: TYPING_KEYS.deleteLines, run: typingCommands.deleteLines, preventDefault: true },
    { key: TYPING_KEYS.bold, run: typingCommands.bold, preventDefault: true },
    { key: TYPING_KEYS.italic, run: typingCommands.italic, preventDefault: true },
    { key: TYPING_KEYS.monospace, run: typingCommands.monospace, preventDefault: true },
];

/**
 * Haken aus `extensions.ts`. Die Tasten liegen mit hoher Priorität vor `defaultKeymap` (aus `session.ts`), denn
 * dort gelten für dieselben Tasten die Standardbefehle von CodeMirror.
 */
export function typingExtension(_context: FeatureContext): Extension {
    return [
        EditorView.inputHandler.of(handleTypedInput),
        Prec.high(keymap.of([...typingKeymap])),
        undoStepOnEditKindChange,
    ];
}
