// Rechtschreibprüfung im Editor (W7-2, Vorbild Swift `EditorCoordinator.textView(_:didCheckTextIn:…)`, Spike S8).
// Geprüft wird nur der sichtbare Bereich samt Rand, 250 ms nach dem letzten Tippen oder Scrollen, im Worker
// (`app/spellClient.ts`); der Text verlässt den Renderer nicht. Treffer erscheinen rot gepunktet (`cm-spell-error`;
// Syntaxfehler sind rot gestrichelt, Schreibhinweise blau gepunktet). Rechtsklick (oder Umschalt+F10) auf ein
// unterstrichenes Wort öffnet das Kontextmenü mit Vorschlägen, „Ignorieren“ und „Zum Wörterbuch hinzufügen“.
//
// Der Tokenizer-Zustand am Anfang des geprüften Bereichs kommt aus einem eigenen `LineStateCache` (wie die
// Einfärbung, deren Cache privat ist): Der Worker tokenisiert dann nur die geprüften Zeilen. `spellField` hält
// Version und Treffer der Sitzung; Antworten gelten nur für den Stand, dessen Version sie tragen. Der Schalter
// „Rechtschreibung prüfen“ (`checksSpelling`, Standard an wie Swift) wirkt beim Zeichnen.
import { isolateHistory } from '@codemirror/commands';
import { Facet, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { EditorState, Extension, Text } from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { BibLexState } from '../../shared/core/bib/tokenizer';
import { languageFromPath } from '../../shared/core/language';
import type { SyntaxLanguage } from '../../shared/core/language';
import type { LexState } from '../../shared/core/latex/tokenizer';
import type { SpellRange } from '../../shared/core/spelling/spellProtocol';
import type { SpellCheckInput, SpellErrorsListener } from '../app/spellClient';
import { spellMenuItems } from '../app/spellMenuItems';
import type { SpellMenuRequest } from '../app/spellMenuItems';
import { sharedSpellClient, sharedSpellWords } from '../app/spellRuntime';
import type { SpellWordsChange, SpellWordsListener } from '../app/spellWords';
import { useSettingsStore } from '../stores/settings';
import type { AnalysisTimer } from '../workers/analysisClient';
import type { FeatureContext } from './extensions';
import { bibSyntax, LineStateCache, latexSyntax, spliceFromChanges, textLineSource } from './lineStateCache';

export const SPELL_DEBOUNCE_MS = 250;
/** Zeilen über und unter dem Viewport von CodeMirror (der selbst schon etwas über den Bildschirm hinausreicht) */
const MARGIN_LINES = 30;
/** Höchstens so viel Text je Anfrage (sehr lange Zeilen) */
const MAX_CHECK_CHARACTERS = 200_000;
const SPELL_ERROR_CLASS = 'cm-spell-error';
/** `userEvent` beim Ersetzen durch einen Vorschlag (kein `input.type`: löst keine Autokorrektur aus) */
const SPELL_REPLACE_EVENT = 'input.spellcheck';
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;

// ---------- Abhängigkeiten (in der App die geteilten Objekte, im Test Fälschungen) ----------

export interface SpellClientLike {
    readonly isAvailable: boolean;
    check(docId: string, input: SpellCheckInput, listener: SpellErrorsListener): void;
    forget(docId: string): void;
    suggest(word: string): Promise<readonly string[]>;
}

export interface SpellWordsLike {
    ensureLoaded(): Promise<void>;
    subscribe(listener: SpellWordsListener): () => void;
    ignore(word: string): void;
    add(word: string): Promise<boolean>;
}

/** Schalter „Rechtschreibung prüfen“; im Test eine Fälschung, in der App der Einstellungs-Store */
export interface SpellSettings {
    isEnabled(): boolean;
    subscribe(listener: () => void): () => void;
}

const appSpellSettings: SpellSettings = {
    isEnabled: () => useSettingsStore.getState().values.checksSpelling,
    subscribe: (listener) => useSettingsStore.subscribe(() => listener()),
};

const spellSettings = Facet.define<SpellSettings, SpellSettings>({
    combine: (values) => values[0] ?? appSpellSettings,
});

interface SpellDeps {
    readonly docId: string;
    readonly language: SyntaxLanguage;
    readonly client: SpellClientLike;
    readonly words: SpellWordsLike;
    readonly timer: AnalysisTimer;
    readonly debounceMs: number;
}

const browserTimer: AnalysisTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// ---------- Zustand ----------

interface SpellFieldValue {
    /** Zähler der Textstände; steht für den Text, nicht der Text selbst */
    readonly version: number;
    readonly decorations: DecorationSet;
}

interface SpellResult {
    readonly version: number;
    /** Geprüfter Bereich; Treffer darin werden ersetzt, außerhalb bleiben sie */
    readonly from: number;
    readonly to: number;
    readonly errors: readonly SpellRange[];
}

const setSpellResult = StateEffect.define<SpellResult>();
/** Diese Wörter gelten jetzt als richtig (ignoriert oder ins Wörterbuch aufgenommen) */
const acceptSpellWords = StateEffect.define<readonly string[]>();
/** Zwingt den View, die Dekorationen neu zu bewerten (nach dem Umschalten der Einstellung) */
const refreshSpell = StateEffect.define<null>();

const spellMark = Decoration.mark({ class: SPELL_ERROR_CLASS });

let lastIssuedVersion = 0;

function issueVersion(): number {
    lastIssuedVersion += 1;
    return lastIssuedVersion;
}

function applyResult(decorations: DecorationSet, result: SpellResult, docLength: number): DecorationSet {
    const marks = result.errors
        .filter(([from, to]) => from < to && to <= docLength)
        .map(([from, to]) => spellMark.range(from, to));
    return decorations.update({
        filterFrom: result.from,
        filterTo: result.to,
        filter: (from, to) => from < result.from || to > result.to,
        add: marks,
        sort: true,
    });
}

function decapitalize(word: string): string {
    return word.charAt(0).toLowerCase() + word.slice(1);
}

function withoutWords(decorations: DecorationSet, doc: Text, words: readonly string[]): DecorationSet {
    const accepted = new Set(words);
    return decorations.update({
        filter: (from, to) => {
            const text = doc.sliceString(from, to);
            return !accepted.has(text) && !accepted.has(decapitalize(text));
        },
    });
}

/** Treffer, in denen (oder direkt an denen) ein Buchstabe getippt oder gelöscht wurde, fallen bis zur nächsten Prüfung weg */
function withoutEditedWords(decorations: DecorationSet, tr: Transaction): DecorationSet {
    const edits: { from: number; to: number; wordy: boolean }[] = [];
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        const changedText = inserted.toString() + tr.startState.doc.sliceString(fromA, toA);
        edits.push({ from: fromB, to: toB, wordy: WORD_CHARACTER.test(changedText) });
    });
    return decorations.update({
        filter: (from, to) => !edits.some((edit) =>
            (from < edit.to && to > edit.from) || (edit.wordy && (to === edit.from || from === edit.to))),
    });
}

const spellField = StateField.define<SpellFieldValue>({
    create: () => ({ version: issueVersion(), decorations: Decoration.none }),
    update(value, tr) {
        let { version, decorations } = value;
        if (tr.docChanged) {
            version = issueVersion();
            decorations = withoutEditedWords(decorations.map(tr.changes), tr);
        }
        for (const effect of tr.effects) {
            if (effect.is(setSpellResult) && effect.value.version === version) {
                decorations = applyResult(decorations, effect.value, tr.newDoc.length);
            } else if (effect.is(acceptSpellWords)) {
                decorations = withoutWords(decorations, tr.newDoc, effect.value);
            }
        }
        if (version === value.version && decorations === value.decorations) return value;
        return { version, decorations };
    },
});

function versionOf(state: EditorState): number | null {
    return state.field(spellField, false)?.version ?? null;
}

/** Unterstrichenes Wort an `pos` (auch direkt davor oder dahinter) oder `null` */
export function spellErrorAt(state: EditorState, pos: number): { from: number; to: number } | null {
    const value = state.field(spellField, false);
    if (value === undefined) return null;
    let found: { from: number; to: number } | null = null;
    value.decorations.between(pos, pos, (from, to) => {
        found = { from, to };
        return false;
    });
    return found;
}

/** Aktuelle Treffer der Sitzung (Positionen wie im aktuellen Text), nach Position sortiert */
export function spellErrorsOf(state: EditorState): SpellRange[] {
    const ranges: SpellRange[] = [];
    const value = state.field(spellField, false);
    if (value === undefined) return ranges;
    for (const cursor = value.decorations.iter(); cursor.value !== null; cursor.next()) ranges.push([cursor.from, cursor.to]);
    return ranges;
}

// ---------- Prüfen: sichtbarer Bereich, entprellt ----------

type SpellLineCache = LineStateCache<LexState> | LineStateCache<BibLexState>;

function createLineCache(language: SyntaxLanguage, lineCount: number): SpellLineCache {
    return language === 'bibtex' ? new LineStateCache(bibSyntax, lineCount) : new LineStateCache(latexSyntax, lineCount);
}

interface CheckWindow {
    readonly input: SpellCheckInput;
    readonly from: number;
    readonly to: number;
}

class SpellPlugin {
    private readonly cache: SpellLineCache;
    private timerHandle: unknown = undefined;
    private destroyed = false;
    private lastEnabled: boolean;
    private readonly stopSettings: () => void;
    private readonly stopWords: () => void;

    constructor(private readonly view: EditorView, private readonly deps: SpellDeps) {
        this.cache = createLineCache(deps.language, view.state.doc.lines);
        const settings = view.state.facet(spellSettings);
        this.lastEnabled = settings.isEnabled();
        this.stopSettings = settings.subscribe(() => this.settingsChanged(settings));
        this.stopWords = deps.words.subscribe((change) => this.wordsChanged(change));
        void deps.words.ensureLoaded();
        this.schedule();
    }

    update(update: ViewUpdate): void {
        if (update.docChanged) this.applyEdit(update);
        if (update.docChanged || update.viewportChanged) this.schedule();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelTimer();
        this.stopSettings();
        this.stopWords();
        this.deps.client.forget(this.deps.docId);
    }

    private applyEdit(update: ViewUpdate): void {
        const splice = spliceFromChanges(update.changes, update.startState.doc, update.state.doc);
        if (splice === null) return;
        const lastLine = update.state.doc.lineAt(update.view.viewport.to).number - 1 + MARGIN_LINES;
        this.cache.highlightEdit(textLineSource(update.state.doc), splice, lastLine);
    }

    private settingsChanged(settings: SpellSettings): void {
        const enabled = settings.isEnabled();
        if (this.destroyed || enabled === this.lastEnabled) return;
        this.lastEnabled = enabled;
        this.view.dispatch({ effects: refreshSpell.of(null) });
        if (enabled) this.schedule();
        else this.cancelTimer();
    }

    private wordsChanged(change: SpellWordsChange): void {
        if (this.destroyed) return;
        this.view.dispatch({ effects: acceptSpellWords.of(change.accepted), annotations: Transaction.addToHistory.of(false) });
        this.schedule();
    }

    private schedule(): void {
        this.cancelTimer();
        this.timerHandle = this.deps.timer.set(() => {
            this.timerHandle = undefined;
            this.checkNow();
        }, this.deps.debounceMs);
    }

    private cancelTimer(): void {
        if (this.timerHandle === undefined) return;
        this.deps.timer.clear(this.timerHandle);
        this.timerHandle = undefined;
    }

    /** Erst hier entsteht der Text (nur der Ausschnitt); veraltete Antworten verwerfen Client und Version */
    private checkNow(): void {
        const { client, docId } = this.deps;
        if (this.destroyed || !this.view.state.facet(spellSettings).isEnabled() || !client.isAvailable) return;
        const checked = this.checkWindow();
        const version = versionOf(this.view.state);
        client.check(docId, checked.input, (errors) => this.receive(version, checked, errors));
    }

    private checkWindow(): CheckWindow {
        const { doc } = this.view.state;
        const { viewport } = this.view;
        const firstLine = Math.max(1, doc.lineAt(viewport.from).number - MARGIN_LINES);
        const lastLine = Math.min(doc.lines, doc.lineAt(viewport.to).number + MARGIN_LINES);
        // Zeilen 0-basiert im Cache: gültig bis vor die erste geprüfte Zeile, dann deren Anfangszustand
        this.cache.ensureValid(textLineSource(doc), firstLine - 2);
        const startState = this.cache.startStateOf(firstLine - 1);
        const from = doc.line(firstLine).from;
        const to = Math.min(doc.line(lastLine).to, from + MAX_CHECK_CHARACTERS);
        const input = { language: this.deps.language, text: doc.sliceString(from, to), offset: from, startState };
        return { input, from, to };
    }

    private receive(version: number | null, checked: CheckWindow, errors: readonly SpellRange[]): void {
        if (this.destroyed || version === null || versionOf(this.view.state) !== version) return;
        this.view.dispatch({
            effects: setSpellResult.of({ version, from: checked.from, to: checked.to, errors }),
            annotations: Transaction.addToHistory.of(false),
        });
    }
}

// ---------- Kontextmenü ----------

export type SpellMenuOpener = (request: SpellMenuRequest) => void;

/**
 * Zeigt das Menü an (`app/spellMenu.ts` mit `ui/ContextMenu.tsx`); die App meldet es in `commandsRuntime.ts` an.
 * So hängt dieses Modul nicht an React-Komponenten (Vitest und die Node-Typprüfung laden es über `session.ts`).
 */
let menuOpener: SpellMenuOpener | null = null;

export function setSpellMenuOpener(opener: SpellMenuOpener | null): void {
    menuOpener = opener;
}

interface MenuPoint {
    readonly x: number;
    readonly y: number;
}

function replaceWord(view: EditorView, range: { from: number; to: number }, word: string, suggestion: string): void {
    // Der Text kann sich geändert haben, während das Menü offen war
    if (view.state.sliceDoc(range.from, range.to) !== word) return;
    view.dispatch({
        changes: { from: range.from, to: range.to, insert: suggestion },
        selection: { anchor: range.from + suggestion.length },
        userEvent: SPELL_REPLACE_EVENT,
        annotations: isolateHistory.of('full'),
        scrollIntoView: true,
    });
    view.focus();
}

async function openSpellMenu(
    view: EditorView, range: { from: number; to: number }, point: MenuPoint, deps: SpellDeps, open: SpellMenuOpener,
): Promise<void> {
    const word = view.state.sliceDoc(range.from, range.to);
    const suggestions = await deps.client.suggest(word);
    const items = spellMenuItems(word, suggestions, {
        replace: (suggestion) => replaceWord(view, range, word, suggestion),
        ignore: () => deps.words.ignore(word),
        add: () => void deps.words.add(word),
    });
    open({ x: point.x, y: point.y, items, returnFocus: view.contentDOM });
}

function isSpellActive(view: EditorView): boolean {
    return view.state.facet(spellSettings).isEnabled() && view.state.field(spellField, false) !== undefined;
}

function handleContextMenu(event: MouseEvent, view: EditorView, deps: SpellDeps): boolean {
    const open = menuOpener;
    if (open === null || !isSpellActive(view)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const range = pos === null ? null : spellErrorAt(view.state, pos);
    if (range === null) return false;
    event.preventDefault();
    void openSpellMenu(view, range, { x: event.clientX, y: event.clientY }, deps, open);
    return true;
}

/** Umschalt+F10 am Cursor: dasselbe Menü per Tastatur */
function openMenuAtCursor(view: EditorView, deps: SpellDeps): boolean {
    const open = menuOpener;
    if (open === null || !isSpellActive(view)) return false;
    const head = view.state.selection.main.head;
    const range = spellErrorAt(view.state, head);
    const coords = view.coordsAtPos(head);
    if (range === null || coords === null) return false;
    void openSpellMenu(view, range, { x: coords.left, y: coords.bottom }, deps, open);
    return true;
}

// ---------- Darstellung ----------

/** Farbe aus `theme.ts`; der Rückfall hält die Linie sichtbar, solange kein Farbschema gesetzt ist */
const SPELL_COLOR = 'var(--editor-diagnostic-error, #ff3b30)';

const spellBaseTheme = EditorView.baseTheme({
    [`.${SPELL_ERROR_CLASS}`]: {
        textDecoration: `underline dotted ${SPELL_COLOR}`,
        textDecorationThickness: '2px',
        textUnderlineOffset: '3px',
    },
});

function visibleSpellErrors(view: EditorView): DecorationSet {
    if (!view.state.facet(spellSettings).isEnabled()) return Decoration.none;
    return view.state.field(spellField, false)?.decorations ?? Decoration.none;
}

// ---------- Erweiterung ----------

export interface SpellOptions {
    readonly settings?: SpellSettings;
    readonly client?: SpellClientLike;
    readonly words?: SpellWordsLike;
    readonly timer?: AnalysisTimer;
    readonly debounceMs?: number;
}

/** Rechtschreibprüfung für eine Sitzung (`docId` = Pfad); BibTeX prüft nur Feldwerte (Tokenizer wie die Einfärbung) */
export function spellExtension(context: FeatureContext, options: SpellOptions = {}): Extension {
    const deps = (): SpellDeps => ({
        docId: context.path,
        language: languageFromPath(context.name ?? context.path),
        client: options.client ?? sharedSpellClient(),
        words: options.words ?? sharedSpellWords(),
        timer: options.timer ?? browserTimer,
        debounceMs: options.debounceMs ?? SPELL_DEBOUNCE_MS,
    });
    return [
        options.settings === undefined ? [] : spellSettings.of(options.settings),
        spellField,
        spellBaseTheme,
        EditorView.decorations.of(visibleSpellErrors),
        ViewPlugin.define((view) => new SpellPlugin(view, deps())),
        EditorView.domEventHandlers({ contextmenu: (event, view) => handleContextMenu(event, view, deps()) }),
        keymap.of([{ key: 'Shift-F10', run: (view) => openMenuAtCursor(view, deps()) }]),
    ];
}
