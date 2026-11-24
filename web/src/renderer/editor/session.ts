// Sitzungen (W1-6): je geöffneter Datei ein `EditorState`. Der Text lebt nur dort, nie im React- oder
// Zustand-Store. Ein einziger sichtbarer `EditorView` zeigt die aktive Sitzung; ein Wechsel tauscht nur den
// Zustand (`view.setState`), die View bleibt. Undo-Verlauf, Auswahl und Scrollposition gehören zur Sitzung.
import { history, defaultKeymap, historyKeymap, invertedEffects, isolateHistory } from '@codemirror/commands';
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Text } from '@codemirror/state';
import type { ChangeSpec, Extension, Transaction, TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import type { SyntaxLanguage } from '../../shared/core/language';
import type {
    AbsolutePath, ContentHash, EpochMillis, LineEnding, TextEncoding, TextFile, WriteResult,
} from '../../shared/contract';
import { appearanceEffects, appearanceExtensions, currentAppearance } from './appearance';
import type { AppearanceValues } from './appearance';
import { syntaxHighlightingForPath } from './language';
import { featureExtensions } from './extensions';

/**
 * Datei-Angaben einer Sitzung ohne Text. `path` ist der Schlüssel (Projektpfad oder `GrantId` einer Dialog-Datei),
 * `name` der Anzeigename mit Endung; Titel und Sprache kommen immer aus `name`.
 */
export interface SessionFileInfo {
    readonly path: AbsolutePath;
    readonly name: string;
    readonly encoding: TextEncoding;
    readonly eol: LineEnding;
    readonly hash: ContentHash;
    readonly mtime: EpochMillis;
}

export interface SelectionSnapshot {
    readonly anchor: number;
    readonly head: number;
}

/** Stand zum Speichern: Text (Zeilenenden LF, der Main setzt `eol`) und die Änderungsnummer beim Lesen */
export interface SaveSnapshot {
    readonly text: string;
    readonly revision: number;
}

export interface SessionOptions {
    /** Gemerkte Auswahl (z. B. aus dem Tab-Gedächtnis); wird auf die Textlänge geklemmt */
    readonly selection?: SelectionSnapshot;
    readonly onDirtyChange?: (session: EditorSession, isDirty: boolean) => void;
}

const LINE_SEPARATOR_BY_EOL: Readonly<Record<LineEnding, string>> = { lf: '\n', crlf: '\r\n' };
/** Der Main liefert Text immer mit LF (`textIo.ts`); daran wird beim Aufbau des Dokuments geteilt. */
const NORMALIZED_LINE_BREAK = '\n';
const FOREIGN_LINE_BREAK = /\r\n|\r|\n/g;
const CARRIAGE_RETURN = '\r';
const PATH_SEPARATOR = /[\\/]/;
const LINE_BREAK_TEXT = Text.of(['', '']);
const EXTERNAL_CHANGE_EVENT = 'input.replace.external';
const FIRST_REVISION = 0;

const languageCompartment = new Compartment();
const lineSeparatorCompartment = new Compartment();

// ---------- Änderungszähler aus dem Verlauf ----------

interface Revision {
    readonly current: number;
    readonly next: number;
}

const setRevision = StateEffect.define<number>();

function revisionFromEffects(tr: Transaction): number | null {
    let revision: number | null = null;
    for (const effect of tr.effects) if (effect.is(setRevision)) revision = effect.value;
    return revision;
}

/**
 * Jede Textänderung bekommt eine neue Nummer; Rückgängig und Wiederholen stellen über `invertedEffects` die Nummer
 * des Zustands wieder her, in den sie zurückkehren. „Geändert“ heißt: Nummer ≠ Nummer beim letzten Speichern.
 * Bei zusammengefassten Schritten liegt die Nummer vor dem ersten Schritt zuletzt im Ereignis und gewinnt.
 */
const revisionField = StateField.define<Revision>({
    create: () => ({ current: FIRST_REVISION, next: FIRST_REVISION + 1 }),
    update(value, tr) {
        const restored = revisionFromEffects(tr);
        if (restored !== null) return { current: restored, next: value.next };
        if (!tr.docChanged) return value;
        return { current: value.next, next: value.next + 1 };
    },
});

const revisionHistory = invertedEffects.of((tr) =>
    tr.docChanged ? [setRevision.of(tr.startState.field(revisionField).current)] : [],
);

export function revisionOf(state: EditorState): number {
    return state.field(revisionField).current;
}

// ---------- Zeilenenden ----------

function lineSeparatorFor(eol: LineEnding): Extension {
    return EditorState.lineSeparator.of(LINE_SEPARATOR_BY_EOL[eol]);
}

/** Dokument aus LF-Text, unabhängig vom eingestellten Zeilentrenner */
function textFromNormalized(text: string): Text {
    return Text.of(text.split(NORMALIZED_LINE_BREAK));
}

/**
 * Mit festem `lineSeparator` erkennt CodeMirror nur diesen Trenner. Eingefügter Text mit anderen Zeilenenden
 * (LF in einer CRLF-Datei, CRLF in einer LF-Datei) wird hier in echte Zeilenumbrüche verwandelt.
 */
function foreignLineBreakFixes(tr: Transaction): ChangeSpec[] {
    const fixes: ChangeSpec[] = [];
    const separatorIsLf = tr.state.lineBreak === NORMALIZED_LINE_BREAK;
    tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
        for (let number = 1; number <= inserted.lines; number++) {
            const line = inserted.line(number);
            for (const match of line.text.matchAll(FOREIGN_LINE_BREAK)) {
                const from = fromB + line.from + match.index;
                const endsLine = match.index + match[0].length === line.length && number < inserted.lines;
                // CR direkt vor einem echten LF-Umbruch ist der Rest eines CRLF: nur entfernen.
                const dropOnly = separatorIsLf && match[0] === CARRIAGE_RETURN && endsLine;
                fixes.push({ from, to: from + match[0].length, insert: dropOnly ? '' : LINE_BREAK_TEXT });
            }
        }
    });
    return fixes;
}

const normalizeInsertedLineBreaks = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const fixes = foreignLineBreakFixes(tr);
    return fixes.length === 0 ? tr : [tr, { changes: fixes, sequential: true }];
});

// ---------- Hilfen ----------

/** Letzter Teil eines Pfads (Anzeigename, wenn ein Projektpfad umzieht) */
export function fileNameOfPath(path: string): string {
    return path.split(PATH_SEPARATOR).at(-1) ?? path;
}

/** Klemmt eine gemerkte Auswahl auf die Textlänge (lange → kurze Datei ohne Fehler). */
export function clampSelection(selection: SelectionSnapshot, length: number): EditorSelection {
    const clamp = (position: number): number => Math.min(Math.max(Math.trunc(position) || 0, 0), length);
    return EditorSelection.single(clamp(selection.anchor), clamp(selection.head));
}

function isLeadSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isTrailSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

/** Bereich zwischen gemeinsamem Anfang und Ende (nie mitten in einem Ersatzpaar); `null` bei gleichem Text */
export function minimalReplacement(oldText: string, newText: string): { from: number; to: number; insert: string } | null {
    if (oldText === newText) return null;
    const shorter = Math.min(oldText.length, newText.length);
    let prefix = 0;
    while (prefix < shorter && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
    let suffix = 0;
    while (
        suffix < shorter - prefix &&
        oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
    ) suffix++;
    if (prefix > 0 && isLeadSurrogate(newText.charCodeAt(prefix - 1))) prefix--;
    if (suffix > 0 && isTrailSurrogate(newText.charCodeAt(newText.length - suffix))) suffix--;
    return { from: prefix, to: oldText.length - suffix, insert: newText.slice(prefix, newText.length - suffix) };
}

/** Einfärbung, die gerade in einem Zustand steckt (für Tests des Sprachwechsels) */
export function highlightingOf(state: EditorState): Extension | undefined {
    return languageCompartment.get(state);
}

/** Leerer, schreibgeschützter Zustand, wenn keine Sitzung sichtbar ist */
export function emptyEditorState(): EditorState {
    return EditorState.create({ extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)] });
}

const RELEASED_STATE = EditorState.create();

// ---------- Sitzung ----------

export class EditorSession {
    private stored: EditorState;
    private view: EditorView | null = null;
    private scroll: StateEffect<unknown> | null = null;
    private savedRevision = FIRST_REVISION;
    private lastDirty = false;
    private disposed = false;
    private appliedAppearance: AppearanceValues = currentAppearance();
    private info: SessionFileInfo;
    private onDirtyChange: SessionOptions['onDirtyChange'];

    constructor(file: TextFile, options: SessionOptions = {}) {
        const { text: _text, ...info } = file;
        this.info = info;
        this.onDirtyChange = options.onDirtyChange;
        const doc = textFromNormalized(file.text);
        const selection = options.selection === undefined ? undefined : clampSelection(options.selection, doc.length);
        this.stored = EditorState.create({ doc, selection, extensions: this.extensions() });
    }

    get path(): AbsolutePath {
        return this.info.path;
    }

    get file(): SessionFileInfo {
        return this.info;
    }

    get language(): SyntaxLanguage {
        return languageFromPath(this.info.name);
    }

    /** Aktueller Zustand: im sichtbaren View dessen Zustand, sonst der gemerkte */
    get state(): EditorState {
        return this.view?.state ?? this.stored;
    }

    get isDirty(): boolean {
        return revisionOf(this.state) !== this.savedRevision;
    }

    get isAttached(): boolean {
        return this.view !== null;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    get selection(): SelectionSnapshot {
        const { anchor, head } = this.state.selection.main;
        return { anchor, head };
    }

    /** Wendet eine Änderung an, sichtbar über den View, sonst direkt auf den gemerkten Zustand */
    dispatch(...specs: TransactionSpec[]): void {
        if (this.disposed) return;
        if (this.view !== null) {
            this.view.dispatch(...specs);
            return;
        }
        const tr = this.stored.update(...specs);
        this.stored = tr.state;
        if (this.scroll !== null && tr.docChanged) this.scroll = this.scroll.map(tr.changes) ?? null;
        if (tr.docChanged) this.notifyDirty();
    }

    /** Setzt die Auswahl, geklemmt auf die Textlänge */
    select(selection: SelectionSnapshot): void {
        this.dispatch({ selection: clampSelection(selection, this.state.doc.length) });
    }

    /** Text zum Speichern lesen; nur hier entsteht der ganze Text als Zeichenkette */
    snapshotForSave(): SaveSnapshot {
        return { text: this.state.doc.toString(), revision: revisionOf(this.state) };
    }

    /** Nach erfolgreichem Speichern: Stand von `snapshot` gilt als gespeichert, neues Tippen beginnt einen Undo-Schritt */
    markSaved(snapshot: SaveSnapshot, result: WriteResult): void {
        this.markRevisionSaved(snapshot.revision, result);
    }

    /**
     * Ersetzt den Text durch `newText` (LF), aber nur zwischen gemeinsamem Anfang und Ende, als ein eigener
     * Undo-Schritt. Auswahl und Scrollposition davor bleiben.
     */
    replaceText(newText: string): void {
        const change = minimalReplacement(this.state.doc.toString(), newText);
        if (change === null) return;
        this.dispatch({
            changes: { from: change.from, to: change.to, insert: textFromNormalized(change.insert) },
            annotations: isolateHistory.of('full'),
            userEvent: EXTERNAL_CHANGE_EVENT,
        });
    }

    /** Neuer Stand von der Platte (z. B. nach externer Änderung): minimaler Ersatz, danach gilt er als gespeichert */
    reloadFromDisk(file: TextFile): void {
        if (file.eol !== this.info.eol) {
            this.dispatch({ effects: lineSeparatorCompartment.reconfigure(lineSeparatorFor(file.eol)) });
        }
        this.replaceText(file.text);
        this.info = { ...this.info, encoding: file.encoding, eol: file.eol };
        this.markRevisionSaved(revisionOf(this.state), file);
    }

    /** Umbenennen, Verschieben, „Speichern unter“; wechselt die Endung die Sprache, wird die Einfärbung getauscht */
    relocate(newPath: AbsolutePath, newName: string = fileNameOfPath(newPath)): void {
        const languageChanged = languageFromPath(newName) !== this.language;
        this.info = { ...this.info, path: newPath, name: newName };
        if (!languageChanged) return;
        this.dispatch({ effects: languageCompartment.reconfigure(syntaxHighlightingForPath(newName)) });
    }

    /**
     * Zieht Farbschema, Zeilenumbruch, Anzeige und Tippen auf den aktuellen Stand (`currentAppearance`), nur was sich
     * geändert hat und ohne Neuaufbau. Nicht sichtbare Sitzungen holen das beim Anzeigen nach (`attach`).
     */
    syncAppearance(): void {
        const next = currentAppearance();
        if (next === this.appliedAppearance || this.disposed) return;
        const effects = appearanceEffects(this.appliedAppearance, next);
        this.appliedAppearance = next;
        if (effects.length > 0) this.dispatch({ effects });
    }

    /** Nur für `SessionView`: zeigt diese Sitzung im View samt gemerkter Scrollposition */
    attach(view: EditorView): void {
        if (this.disposed) return;
        view.setState(this.stored);
        this.view = view;
        this.syncAppearance();
        if (this.scroll !== null) view.dispatch({ effects: this.scroll });
    }

    /** Nur für `SessionView`: merkt Zustand und Scrollposition und löst die Sitzung vom View */
    detach(): void {
        if (this.view === null) return;
        this.stored = this.view.state;
        this.scroll = this.view.scrollSnapshot();
        this.view = null;
    }

    /** Gibt Text, Verlauf und Rückrufe frei; danach ist die Sitzung wirkungslos */
    dispose(): void {
        this.disposed = true;
        this.view = null;
        this.stored = RELEASED_STATE;
        this.scroll = null;
        this.onDirtyChange = undefined;
    }

    private extensions(): Extension[] {
        return [
            history(),
            revisionField,
            revisionHistory,
            keymap.of([...defaultKeymap, ...historyKeymap]),
            lineSeparatorCompartment.of(lineSeparatorFor(this.info.eol)),
            normalizeInsertedLineBreaks,
            languageCompartment.of(syntaxHighlightingForPath(this.info.name)),
            featureExtensions({ path: this.info.path, name: this.info.name }),
            appearanceExtensions(this.appliedAppearance),
            EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
        ];
    }

    private markRevisionSaved(revision: number, result: WriteResult): void {
        this.info = { ...this.info, hash: result.hash, mtime: result.mtime };
        this.savedRevision = revision;
        this.dispatch({ annotations: isolateHistory.of('full') });
        this.notifyDirty();
    }

    private handleViewUpdate(update: ViewUpdate): void {
        if (update.docChanged) this.notifyDirty();
    }

    private notifyDirty(): void {
        const dirty = this.isDirty;
        if (dirty === this.lastDirty) return;
        this.lastDirty = dirty;
        this.onDirtyChange?.(this, dirty);
    }
}

// ---------- Verwaltung ----------

/** Alle offenen Sitzungen, nach Pfad */
export class SessionRegistry {
    private readonly sessions = new Map<AbsolutePath, EditorSession>();

    create(file: TextFile, options: SessionOptions = {}): EditorSession {
        this.close(file.path);
        const session = new EditorSession(file, options);
        this.sessions.set(file.path, session);
        return session;
    }

    get(path: AbsolutePath): EditorSession | undefined {
        return this.sessions.get(path);
    }

    get size(): number {
        return this.sessions.size;
    }

    close(path: AbsolutePath): void {
        this.sessions.get(path)?.dispose();
        this.sessions.delete(path);
    }

    relocate(from: AbsolutePath, to: AbsolutePath, name?: string): void {
        const session = this.sessions.get(from);
        if (session === undefined || from === to) return;
        this.sessions.delete(from);
        session.relocate(to, name);
        this.sessions.set(to, session);
    }
}

/** Der eine sichtbare `EditorView`: tauscht Sitzungen per `setState`, ohne die View neu aufzubauen */
export class SessionView {
    private current: EditorSession | null = null;

    constructor(readonly view: EditorView) {}

    get session(): EditorSession | null {
        return this.current;
    }

    show(session: EditorSession | null): void {
        const next = session?.isDisposed ? null : session;
        if (next === this.current) return;
        this.current?.detach();
        this.current = next ?? null;
        if (next) next.attach(this.view);
        else this.view.setState(emptyEditorState());
    }
}
