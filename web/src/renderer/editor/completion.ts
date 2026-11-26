/**
 * Vervollständigung im Editor (W4-6, Vorlage: `CompletionController.swift`): eine `CompletionSource` für
 * `@codemirror/autocomplete`. Pro Tastendruck läuft nur die Kontexterkennung auf der Cursorzeile und das Sortieren
 * schon gebauter Listen; die Listen entstehen je Index-Stand einmal (der Index selbst kommt aus dem Worker,
 * `app/completionIndex*.ts`). Nie in Kommentaren, Code-Umgebungen (`verbatim`, `lstlisting`, `minted` …) und `\verb`.
 * Automatisch beim Tippen (Schalter `autoComplete`), von Hand mit Strg+Leertaste (macOS ⌃Leertaste wie Swift);
 * Esc schließt, Enter/Tab übernimmt (ein Undo-Schritt), ↑↓ wählen; nach `\begin{}` oder `key=` folgt die nächste Liste.
 */
import {
    acceptCompletion,
    autocompletion,
    pickedCompletion,
    startCompletion,
    type Completion,
    type CompletionContext as EditorCompletionContext,
    type CompletionResult,
    type CompletionSource,
} from '@codemirror/autocomplete';
import { isolateHistory } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { Prec, type EditorState, type Extension, type Line } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { applyCompletion } from '../../shared/core/completion/applier';
import { COMMANDS, ENVIRONMENTS } from '../../shared/core/completion/catalog';
import { detectContext } from '../../shared/core/completion/context';
import { openEnvironments } from '../../shared/core/completion/definitions';
import { commandItem, createCompletionItem, DEFAULT_RANK_LIMIT, rankItems } from '../../shared/core/completion/matcher';
import { optionItems } from '../../shared/core/completion/options';
import type { ArgumentKind, CompletionContext, CompletionItem, CompletionItemKind } from '../../shared/core/completion/types';
import { isInsideCode } from '../../shared/core/latex/environments';
import { EMPTY_COMPLETION_INDEX, type CompletionIndexSnapshot } from '../app/completionIndexLogic';
import { useSettingsStore } from '../stores/settings';
import type { FeatureContext } from './extensions';
import { completionPopupTheme } from './theme';

/** Kurz warten, bis das Tippen ruht (CodeMirror-Standard 100 ms; Swift zeigt sofort) */
export const AUTO_TRIGGER_DELAY_MS = 50;
/** So lange nach dem Erscheinen übernimmt Enter noch nicht (schnell getipptes Enter bleibt ein Zeilenumbruch) */
export const ACCEPT_GUARD_MS = 75;
/** So weit sucht die Code-Prüfung rückwärts nach `\begin{lstlisting}` & Co. */
export const CODE_LOOK_BEHIND = 200_000;
export const PROJECT_COMMAND_DETAIL = 'aus dem Projekt';
export const OPEN_ENVIRONMENT_DETAIL = 'offen';
export const COMPLETE_USER_EVENT = 'input.complete';
const POPUP_CLASS = 'latex-completion';
const COMMAND_PREFIX = '\\';
const VERB_START = /\\verb\*?([^A-Za-z\s*])/g;

/** Was die Quelle von außen braucht (Tests liefern Fälschungen) */
export interface CompletionSourceDeps {
    readonly index: () => CompletionIndexSnapshot;
    readonly isAutomatic: () => boolean;
}

/** Anschluss an den Projektindex (`app/completionIndexRuntime.ts` meldet ihn an) */
export interface CompletionIndexHooks {
    readonly index: () => CompletionIndexSnapshot;
    /** Ein offener Tab wurde bearbeitet (nur Merker, kein Neuaufbau) */
    readonly documentsEdited: () => void;
}

const NO_INDEX: CompletionIndexHooks = { index: () => EMPTY_COMPLETION_INDEX, documentsEdited: () => undefined };
let indexHooks: CompletionIndexHooks = NO_INDEX;

export function connectCompletionIndex(hooks: CompletionIndexHooks | null): void {
    indexHooks = hooks ?? NO_INDEX;
}

// ---------- Kontext ----------

export interface LocatedContext {
    readonly detected: CompletionContext;
    readonly line: Line;
}

/** Liegt `column` hinter `\verb|` und vor dem schließenden Trennzeichen (oder fehlt es noch)? */
export function isInsideVerb(lineText: string, column: number): boolean {
    for (const match of lineText.matchAll(VERB_START)) {
        const contentStart = match.index + match[0].length;
        if (contentStart > column) return false;
        const close = lineText.indexOf(match[1] ?? '', contentStart);
        if (close === -1 || close >= column) return true;
    }
    return false;
}

function isInCode(state: EditorState, line: Line, cursor: number): boolean {
    if (isInsideVerb(line.text, cursor - line.from)) return true;
    const before = state.doc.sliceString(Math.max(0, cursor - CODE_LOOK_BEHIND), cursor);
    return isInsideCode(before, before.length);
}

/** Kontext am Cursor (nur leere Einzelauswahl), sonst `null`; Kommentare prüft `detectContext` */
export function locateContext(state: EditorState): LocatedContext | null {
    if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
    const cursor = state.selection.main.head;
    const line = state.doc.lineAt(cursor);
    const detected = detectContext(line.text, cursor - line.from, 0);
    if (detected === null || isInCode(state, line, cursor)) return null;
    return { detected, line };
}

// ---------- Kandidaten ----------

let builtInCommands: CompletionItem[] | null = null;

function commandCandidates(index: CompletionIndexSnapshot): CompletionItem[] {
    builtInCommands ??= COMMANDS.map((command) => commandItem(command.name, command.arguments, command.detail));
    const known = new Set(COMMANDS.map((command) => command.name));
    const own = index.commands.filter((name) => !known.has(name)).map((name) => commandItem(name, '', PROJECT_COMMAND_DETAIL));
    return [...builtInCommands, ...own];
}

function simpleItems(kind: CompletionItemKind, texts: readonly string[]): CompletionItem[] {
    return texts.map((text) => createCompletionItem({ kind, text }));
}

function argumentCandidates(argument: ArgumentKind, index: CompletionIndexSnapshot): CompletionItem[] {
    switch (argument) {
        case 'label':
            return index.labels.map((entry) =>
                createCompletionItem({ kind: 'label', text: entry.label, detail: `${entry.file}:${entry.line}` }));
        case 'citation':
            return index.citations.map((entry) =>
                createCompletionItem({ kind: 'citation', text: entry.key, detail: entry.summary, searchableExtra: entry.searchText }));
        case 'acronym':
            return index.acronyms.map((entry) =>
                createCompletionItem({ kind: 'acronym', text: entry.key, detail: entry.summary, searchableExtra: entry.summary }));
        case 'graphics': return simpleItems('image', index.graphicsPaths);
        case 'input': return simpleItems('file', index.inputPaths);
        // `beginEnvironment` (`endEnvironment` kommt nie hierher, siehe `CandidateCache`)
        default: return simpleItems('environment', [...new Set([...ENVIRONMENTS, ...index.environments])]);
    }
}

function candidatesFor(context: CompletionContext, index: CompletionIndexSnapshot): CompletionItem[] {
    if (context.kind === 'command') return commandCandidates(index);
    if (context.kind === 'argument') return argumentCandidates(context.argument, index);
    return optionItems(context.target, new Map(index.packageOptions), context.key)
        .map((option) => createCompletionItem({ kind: 'option', text: option.text, detail: option.detail }));
}

function candidateKey(context: CompletionContext): string {
    if (context.kind === 'command') return context.kind;
    if (context.kind === 'argument') return `${context.kind}:${context.argument}`;
    return `${context.kind}:${context.target.kind}:${context.target.name}:${context.key ?? ''}`;
}

/** `\end{`: die offenen Umgebungen vor dem Cursor, innerste zuerst (hängt vom Text ab, daher nie zwischengespeichert) */
function openEnvironmentItems(state: EditorState): CompletionItem[] {
    const cursor = state.selection.main.head;
    const before = state.doc.sliceString(Math.max(0, cursor - CODE_LOOK_BEHIND), cursor);
    return openEnvironments(before).reverse()
        .map((name) => createCompletionItem({ kind: 'environment', text: name, detail: OPEN_ENVIRONMENT_DETAIL }));
}

/** Listen je Index-Stand und Kontextart; ein neuer Index verwirft alle */
class CandidateCache {
    private index: CompletionIndexSnapshot | null = null;
    private readonly lists = new Map<string, CompletionItem[]>();

    itemsFor(context: CompletionContext, index: CompletionIndexSnapshot, state: EditorState): readonly CompletionItem[] {
        if (context.kind === 'argument' && context.argument === 'endEnvironment') return openEnvironmentItems(state);
        if (index !== this.index) {
            this.index = index;
            this.lists.clear();
        }
        const key = candidateKey(context);
        const cached = this.lists.get(key);
        if (cached !== undefined) return cached;
        const built = candidatesFor(context, index);
        this.lists.set(key, built);
        return built;
    }
}

// ---------- Übernehmen ----------

export interface CompletionChange {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
    /** Cursor danach (absolut, im neuen Text) */
    readonly cursor: number;
    readonly opensFollowUp: boolean;
}

/** Was die Übernahme von `item` im aktuellen Zustand ändert (rein, ohne View); `null` ohne Kontext */
export function completionChange(state: EditorState, item: CompletionItem): CompletionChange | null {
    const located = locateContext(state);
    if (located === null) return null;
    const { line, detected } = located;
    // Das Gerüst für `\begin…\end` braucht die Folgezeile (steht `\end{…}` schon da?)
    const windowEnd = line.number < state.doc.lines ? state.doc.line(line.number + 1).to : line.to;
    const text = state.doc.sliceString(line.from, windowEnd);
    const edit = applyCompletion(item, detected, text, state.facet(indentUnit));
    const from = line.from + edit.range.location;
    return {
        from, to: from + edit.range.length, insert: edit.text, cursor: line.from + edit.selection.location, opensFollowUp: edit.opensFollowUp,
    };
}

/** Eine Transaktion (ein Undo-Schritt, nie mit dem Tippen davor oder danach verbunden); dann ggf. die Folgeliste */
function applyItem(view: EditorView, item: CompletionItem, completion: Completion): void {
    const change = completionChange(view.state, item);
    if (change === null) return;
    view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.cursor },
        scrollIntoView: true,
        userEvent: COMPLETE_USER_EVENT,
        annotations: [pickedCompletion.of(completion), isolateHistory.of('full')],
    });
    if (change.opensFollowUp) startCompletion(view);
}

const completionsByItem = new WeakMap<CompletionItem, Completion>();

function toCompletion(item: CompletionItem): Completion {
    const cached = completionsByItem.get(item);
    if (cached !== undefined) return cached;
    const completion: Completion = {
        label: item.text,
        displayLabel: item.kind === 'command' ? COMMAND_PREFIX + item.text : item.text,
        detail: item.detail === '' ? undefined : item.detail,
        type: item.kind,
        apply: (view, picked) => applyItem(view, item, picked),
    };
    completionsByItem.set(item, completion);
    return completion;
}

// ---------- Quelle ----------

/** Wie Swift: automatisch nur nach einem getippten Zeichen hinter `\x` bzw. in Argument/Option; nie während IME */
function mayOpen(context: EditorCompletionContext, deps: CompletionSourceDeps): boolean {
    if (context.explicit) return true;
    return deps.isAutomatic() && context.view?.composing !== true;
}

export function createLatexCompletionSource(deps: CompletionSourceDeps): CompletionSource {
    const cache = new CandidateCache();
    return (context: EditorCompletionContext): CompletionResult | null => {
        if (!mayOpen(context, deps)) return null;
        const located = locateContext(context.state);
        if (located === null) return null;
        const { detected, line } = located;
        if (!context.explicit && detected.kind === 'command' && detected.prefix === '') return null;
        const ranked = rankItems(cache.itemsFor(detected, deps.index(), context.state), detected.prefix);
        if (ranked.length === 0) return null;
        return { from: line.from + detected.range.location, to: context.pos, options: ranked.map(toCompletion), filter: false };
    };
}

const appSource = createLatexCompletionSource({
    index: () => indexHooks.index(),
    isAutomatic: () => useSettingsStore.getState().values.autoComplete,
});

/** Haken aus `extensions.ts` */
export function completionExtension(_context: FeatureContext): Extension {
    return [
        autocompletion({
            override: [appSource],
            activateOnTyping: true,
            activateOnTypingDelay: AUTO_TRIGGER_DELAY_MS,
            interactionDelay: ACCEPT_GUARD_MS,
            closeOnBlur: true,
            icons: false,
            maxRenderedOptions: DEFAULT_RANK_LIMIT,
            tooltipClass: () => POPUP_CLASS,
        }),
        // Tab übernimmt nur bei offener Liste, sonst gilt das Einrücken aus `typing.ts`
        Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
        completionPopupTheme,
        EditorView.updateListener.of((update) => {
            if (update.docChanged) indexHooks.documentsEdited();
        }),
    ];
}
