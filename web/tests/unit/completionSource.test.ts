import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { EMPTY_COMPLETION_INDEX, type CompletionIndexSnapshot } from '../../src/renderer/app/completionIndexLogic';
import {
    completionChange,
    createLatexCompletionSource,
    isInsideVerb,
    PROJECT_COMMAND_DETAIL,
} from '../../src/renderer/editor/completion';
import { commandItem, createCompletionItem } from '../../src/shared/core/completion/matcher';
import type { CompletionItem } from '../../src/shared/core/completion/types';

const INDEX: CompletionIndexSnapshot = {
    ...EMPTY_COMPLETION_INDEX,
    labels: [
        { label: 'cha:einleitung', file: 'a.tex', line: 1 },
        { label: 'fig:ablauf', file: 'a.tex', line: 4 },
        { label: 'tab:werte', file: 'b.tex', line: 2 },
    ],
    citations: [{ key: 'knuth1984', summary: 'Knuth 1984 · The TeXbook', searchText: 'Donald E. Knuth The TeXbook 1984' }],
    acronyms: [{ key: 'api', summary: 'API – Programmierschnittstelle' }],
    commands: ['meinBefehl', 'textbf'],
    inputPaths: ['kapitel/einleitung'],
    graphicsPaths: ['logo.png'],
};

/** Text mit `|` als Cursor */
function stateAt(marked: string): EditorState {
    const cursor = marked.indexOf('|');
    return EditorState.create({
        doc: marked.slice(0, cursor) + marked.slice(cursor + 1),
        selection: { anchor: cursor },
        extensions: indentUnit.of('\t'),
    });
}

interface Query {
    readonly explicit?: boolean;
    readonly automatic?: boolean;
    readonly index?: CompletionIndexSnapshot;
}

function query(marked: string, options: Query = {}): CompletionResult | null {
    const source = createLatexCompletionSource({ index: () => options.index ?? INDEX, isAutomatic: () => options.automatic ?? true });
    const state = stateAt(marked);
    return source(new CompletionContext(state, state.selection.main.head, options.explicit ?? false)) as CompletionResult | null;
}

const labels = (result: CompletionResult | null): string[] => result?.options.map((option) => option.label) ?? [];

function apply(marked: string, item: CompletionItem): { text: string; cursor: number; followUp: boolean } {
    const state = stateAt(marked);
    const change = completionChange(state, item);
    if (change === null) throw new Error('kein Kontext');
    const next = state.update({ changes: { from: change.from, to: change.to, insert: change.insert }, selection: { anchor: change.cursor } }).state;
    return { text: next.doc.toString(), cursor: next.selection.main.head, followUp: change.opensFollowUp };
}

describe('Quelle der Vervollständigung: Kontext → Einträge', () => {
    it('Befehle nach `\\` mit Präfix, `\\` vor dem Namen in der Anzeige, eigene Befehle mit Hinweis', () => {
        const result = query('\\te|');
        expect(result?.from).toBe(1);
        expect(result?.filter).toBe(false);
        expect(labels(result)).toContain('textbf');
        expect(result?.options.find((option) => option.label === 'textbf')?.displayLabel).toBe('\\textbf');
        expect(labels(result).filter((label) => label === 'textbf')).toHaveLength(1);
        expect(query('\\mein|')?.options[0]).toMatchObject({ label: 'meinBefehl', detail: PROJECT_COMMAND_DETAIL });
    });

    it('`\\ref{` listet Labels sortiert mit Datei:Zeile, Weitertippen filtert', () => {
        const result = query('Siehe \\ref{|}');
        expect(labels(result)).toEqual(['cha:einleitung', 'fig:ablauf', 'tab:werte']);
        expect(result?.options[1]?.detail).toBe('a.tex:4');
        expect(labels(query('Siehe \\ref{abl|}'))).toEqual(['fig:ablauf']);
    });

    it('`\\cite{` listet Schlüssel mit Autor/Jahr/Titel und findet auch über den Autor', () => {
        expect(query('\\cite{|}')?.options).toMatchObject([{ label: 'knuth1984', detail: 'Knuth 1984 · The TeXbook' }]);
        expect(labels(query('\\cite{donald|}'))).toEqual(['knuth1984']);
    });

    it('Abkürzungen, Eingabedateien, Bilder, Umgebungen und offene Umgebungen für `\\end{`', () => {
        expect(labels(query('\\ac{|}'))).toEqual(['api']);
        expect(labels(query('\\input{|}'))).toEqual(['kapitel/einleitung']);
        expect(labels(query('\\includegraphics{|}'))).toEqual(['logo.png']);
        expect(labels(query('\\begin{itemi|}'))).toEqual(['itemize']);
        expect(labels(query('\\begin{figure}\n\\begin{center}\n\\end{|}'))).toEqual(['center', 'figure']);
    });

    it('Paketoptionen in `\\usepackage[` und `\\documentclass[`', () => {
        expect(labels(query('\\documentclass[|]{article}')).length).toBeGreaterThan(0);
        expect(labels(query('\\includegraphics[wid|]{bild}'))).toContain('width=');
    });

    it('kein Popup ohne Treffer, in Kommentaren, in Verbatim/Code und in `\\verb`', () => {
        expect(query('\\ref{gibtsnicht|}')).toBeNull();
        expect(query('% Kommentar \\ref{|}')).toBeNull();
        expect(query('\\begin{verbatim}\n\\te|')).toBeNull();
        expect(query('\\begin{lstlisting}\n\\ref{|}')).toBeNull();
        expect(query('\\begin{minted}{python}\n\\te|')).toBeNull();
        expect(query('\\verb+\\te|')).toBeNull();
        expect(query('\\begin{verbatim}\nx\n\\end{verbatim}\n\\te|')).not.toBeNull();
        expect(query('\\verb!x! \\te|')).not.toBeNull();
    });

    it('automatisch nur mit Schalter und Präfix; von Hand (Strg+Leertaste) auch ohne', () => {
        expect(query('\\|')).toBeNull();
        expect(query('\\|', { explicit: true })).not.toBeNull();
        expect(query('\\te|', { automatic: false })).toBeNull();
        expect(labels(query('\\te|', { automatic: false, explicit: true }))).toContain('textbf');
        expect(query('Text|', { explicit: true })).toBeNull();
    });

    it('ein neuer Index ersetzt die zwischengespeicherten Listen', () => {
        let index = INDEX;
        const source = createLatexCompletionSource({ index: () => index, isAutomatic: () => true });
        const state = stateAt('\\ref{|}');
        const first = source(new CompletionContext(state, state.selection.main.head, false)) as CompletionResult;
        expect(labels(first)).toHaveLength(3);
        index = { ...INDEX, labels: [{ label: 'sec:neu', file: 'c.tex', line: 1 }] };
        const second = source(new CompletionContext(state, state.selection.main.head, false)) as CompletionResult;
        expect(labels(second)).toEqual(['sec:neu']);
    });
});

describe('Übernehmen und Folgeliste', () => {
    it('Label: ganzes Argument ersetzt, Cursor hinter `}`', () => {
        const label = createCompletionItem({ kind: 'label', text: 'fig:ablauf' });
        expect(apply('Siehe \\ref{abl|}', label)).toEqual({ text: 'Siehe \\ref{fig:ablauf}', cursor: 22, followUp: false });
    });

    it('Befehl mit Gerüst: Cursor in der Klammer; `\\begin{}` öffnet die Folgeliste', () => {
        expect(apply('\\textb|', commandItem('textbf', '{}'))).toEqual({ text: '\\textbf{}', cursor: 8, followUp: false });
        expect(apply('\\beg|', commandItem('begin', '{}'))).toEqual({ text: '\\begin{}', cursor: 7, followUp: true });
    });

    it('`\\begin{itemize` erzeugt das Gerüst mit `\\end{itemize}`', () => {
        const environment = createCompletionItem({ kind: 'environment', text: 'enumerate' });
        expect(apply('\\begin{enum|}', environment).text).toBe('\\begin{enumerate}\n\t\\item \n\\end{enumerate}');
        const itemize = createCompletionItem({ kind: 'environment', text: 'itemize' });
        const applied = apply('\\begin{itemize|}', itemize);
        expect(applied.text).toBe('\\begin{itemize}\n\t\\item \n\\end{itemize}');
        expect(applied.cursor).toBe('\\begin{itemize}\n\t\\item '.length);
    });

    it('Option `key=`: Folgeliste mit den Werten', () => {
        const option = createCompletionItem({ kind: 'option', text: 'width=' });
        expect(apply('\\includegraphics[wid|]{bild}', option)).toMatchObject({ text: '\\includegraphics[width=]{bild}', followUp: true });
    });

    it('ohne Kontext (z. B. im Kommentar) wird nichts übernommen', () => {
        expect(completionChange(stateAt('% \\te|'), commandItem('textbf', '{}'))).toBeNull();
    });
});

describe('`\\verb` erkennen', () => {
    it('innen bis vor das schließende Trennzeichen, auch wenn es noch fehlt', () => {
        expect(isInsideVerb('\\verb|abc|', 7)).toBe(true);
        expect(isInsideVerb('\\verb|abc|', 10)).toBe(false);
        expect(isInsideVerb('\\verb+abc', 9)).toBe(true);
        expect(isInsideVerb('Text \\verb', 10)).toBe(false);
    });
});
