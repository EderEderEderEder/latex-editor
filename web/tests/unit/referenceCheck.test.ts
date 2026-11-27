import { describe, expect, it } from 'vitest';
import type { ReadManyItem, TextFile } from '../../src/shared/contract';
import { COMPLETION_INDEX_DEBOUNCE_MS, CompletionIndexClient, type CompletionWorkerLike, type IndexTimer } from '../../src/renderer/app/completionIndex';
import {
    CompletionIndexBuilder,
    handleCompletionIndexRequest,
    type CompletionIndexResponse,
    type CompletionIndexUpdate,
    type ProjectFiles,
    type SourceFile,
} from '../../src/renderer/app/completionIndexLogic';
import { hintGroupsOf } from '../../src/renderer/app/referenceCheckHints';
import { EMPTY_REFERENCES, type ReferenceSnapshot } from '../../src/renderer/app/referenceCheckLogic';
import { referenceProblems } from '../../src/shared/core/latex/referenceCheck';
import { createHintsStore, hintCount } from '../../src/renderer/stores/hints';

// W4-12: Prüfergebnis des Index-Workers (Hinweise, Probleme je Datei) mit einem Projekt nach dem Muster der HgbDemo:
// `fig:fehlt` undefiniert, `sec:ungenutzt` ungenutzt, `ungenutzt2026` nicht zitiert.
const ROOT = '/p';
const MAIN = `${ROOT}/main.tex`;
const INTRO = `${ROOT}/chapters/einleitung.tex`;
const IMPL = `${ROOT}/chapters/umsetzung.tex`;
const BIB = `${ROOT}/hgbreferences.bib`;
const PROJECT: ProjectFiles = { root: ROOT, mainFile: MAIN, files: [MAIN, INTRO, IMPL, BIB] };

const MAIN_TEXT = '\\input{chapters/einleitung}\n\\input{chapters/umsetzung}\n\\bibliography{hgbreferences}\n';
const INTRO_TEXT = [
    '\\chapter{Einleitung}\\label{chap:einleitung}',
    'Zitat \\cite{knuth1984} und Kapitel~\\ref{chap:einleitung}.',
    '% \\ref{kommentar:ignoriert} \\cite{ignoriert}',
    'Abbildung~\\ref{fig:fehlt} und \\gls{api}.',
    '',
].join('\n');
const IMPL_TEXT = '\\section{Code}\\label{sec:code}\n\\label{sec:ungenutzt}\nSiehe \\ref{sec:code}.\n';
const BIB_TEXT = '@book{knuth1984,\n  title = {TeX}\n}\n\n@online{ungenutzt2026,\n  title = {Nie zitiert}\n}\n';
const ACRONYMS_TEXT = '\\newacronym{api}{API}{Schnittstelle}\n\\newacronym{ungenutzt}{UNG}{Nie benutzt}\n';

function file(path: string, text: string): SourceFile {
    return { path, name: path.split('/').at(-1) ?? path, text };
}

function update(version: number, changes: Partial<CompletionIndexUpdate> = {}): CompletionIndexUpdate {
    return { kind: 'update', version, reset: false, changed: [], removed: [], ...changes };
}

function demoBuilder(): { builder: CompletionIndexBuilder; references: ReferenceSnapshot } {
    const builder = new CompletionIndexBuilder();
    builder.apply(update(1, {
        reset: true,
        project: PROJECT,
        changed: [file(MAIN, MAIN_TEXT + ACRONYMS_TEXT), file(INTRO, INTRO_TEXT), file(IMPL, IMPL_TEXT), file(BIB, BIB_TEXT)],
    }));
    const references = builder.takeReferences();
    if (references === null) throw new Error('Prüfergebnis erwartet');
    return { builder, references };
}

const problemKeys = (references: ReferenceSnapshot, path: string): string[] =>
    references.problems.find((entry) => entry.file === path)?.problems.map((problem) => problem.key) ?? [];

describe('Verweisprüfung im Index-Worker (Demo-Fälle)', () => {
    it('meldet den undefinierten Verweis fig:fehlt, aber nicht Kommentare und Definitionen', () => {
        const { references } = demoBuilder();
        expect(references.loaded).toBe(true);
        expect(problemKeys(references, INTRO)).toEqual(['fig:fehlt']);
        expect(references.problems).toHaveLength(1);
        const problem = references.problems[0]?.problems[0];
        expect(INTRO_TEXT.slice(problem?.start, problem?.end)).toBe('fig:fehlt');
        expect(problem?.kind).toBe('unknownLabel');
        expect(problem?.message).toContain('fig:fehlt');
    });

    it('findet das ungenutzte Label sec:ungenutzt und die nicht zitierte Quelle ungenutzt2026 mit Datei und Zeile', () => {
        const { references } = demoBuilder();
        expect(references.unusedLabels).toEqual([{ label: 'sec:ungenutzt', file: IMPL, line: 2 }]);
        expect(references.unusedSources).toEqual([{ key: 'ungenutzt2026', file: BIB, line: 5, title: 'Nie zitiert' }]);
    });

    it('findet ungenutzte Abkürzungen mit Fundstelle; `\\glsaddall` macht alle zu benutzten', () => {
        const { builder, references } = demoBuilder();
        expect(references.unusedAcronyms).toEqual([{ key: 'ungenutzt', file: MAIN, line: 5, summary: 'UNG – Nie benutzt' }]);
        builder.apply(update(2, { changed: [file(MAIN, `${MAIN_TEXT + ACRONYMS_TEXT}\\glsaddall\n`)] }));
        expect(builder.takeReferences()?.unusedAcronyms).toEqual([]);
    });

    it('prüft Zitate nur, wenn das Projekt Quellen hat, und Abkürzungen nur mit Definitionen', () => {
        const builder = new CompletionIndexBuilder();
        builder.apply(update(1, {
            reset: true,
            project: { root: ROOT, mainFile: MAIN, files: [MAIN] },
            changed: [file(MAIN, '\\cite{irgendwer} \\gls{x} \\ref{nirgends}')],
        }));
        expect(problemKeys(builder.takeReferences() ?? EMPTY_REFERENCES, MAIN)).toEqual(['nirgends']);
    });

    it('`\\nocite{*}` zählt alle Quellen als benutzt', () => {
        const { builder } = demoBuilder();
        builder.apply(update(2, { changed: [file(IMPL, `${IMPL_TEXT}\\nocite{*}\n`)] }));
        expect(builder.takeReferences()?.unusedSources).toEqual([]);
    });

    it('doppelte Labels stehen mit allen Stellen in der Liste', () => {
        const { builder } = demoBuilder();
        builder.apply(update(2, { changed: [file(IMPL, `${IMPL_TEXT}\\label{chap:einleitung}\n`)] }));
        const duplicates = builder.takeReferences()?.duplicateLabels ?? [];
        expect(duplicates.map((entry) => `${entry.label}@${entry.file}:${entry.line}`)).toEqual([
            `chap:einleitung@${INTRO}:1`, `chap:einleitung@${IMPL}:4`,
        ]);
    });

    it('stimmt mit der Kernlogik `referenceProblems` überein (Reihenfolge, Bereiche, Text)', () => {
        const { references } = demoBuilder();
        const known = {
            labels: new Set(['chap:einleitung', 'sec:code', 'sec:ungenutzt']),
            citations: new Set(['knuth1984', 'ungenutzt2026']),
            acronyms: new Set(['api', 'ungenutzt']),
        };
        const expected = referenceProblems(INTRO_TEXT, known);
        expect(references.problems.find((entry) => entry.file === INTRO)?.problems).toEqual(expected);
    });

    it('meldet nur bei echter Änderung: gleicher Stand → null, neue Verwendung → neues Ergebnis', () => {
        const { builder } = demoBuilder();
        expect(builder.takeReferences()).toBeNull();
        builder.apply(update(2, { changed: [file(INTRO, INTRO_TEXT)] }));
        expect(builder.takeReferences()).toBeNull();
        builder.apply(update(3, { changed: [file(IMPL, `${IMPL_TEXT}\\ref{sec:ungenutzt}\n`)] }));
        expect(builder.takeReferences()?.unusedLabels).toEqual([]);
    });

    it('ohne Projekt ist nichts geladen (nichts prüfen, nichts melden)', () => {
        const builder = new CompletionIndexBuilder();
        builder.apply(update(1, { reset: true, project: null, changed: [file('/lose/a.tex', '\\ref{x}')] }));
        expect(builder.takeReferences()).toBe(EMPTY_REFERENCES);
        expect(EMPTY_REFERENCES.loaded).toBe(false);
    });

    it('eine entfernte Datei nimmt ihre Labels und Probleme mit', () => {
        const { builder } = demoBuilder();
        builder.apply(update(2, { removed: [INTRO] }));
        const references = builder.takeReferences();
        expect(references?.problems).toEqual([]);
        expect(references?.labels.map((entry) => entry.label)).toEqual(['sec:code', 'sec:ungenutzt']);
    });

    it('Antwort des Workers trägt das Ergebnis, bei unverändertem Stand `null`', () => {
        const builder = new CompletionIndexBuilder();
        const first = handleCompletionIndexRequest(builder, update(1, { reset: true, project: PROJECT, changed: [file(IMPL, IMPL_TEXT)] }));
        expect(first).toMatchObject({ kind: 'index', references: { loaded: true } });
        const second = handleCompletionIndexRequest(builder, update(2, { changed: [file(IMPL, IMPL_TEXT)] }));
        expect(second).toMatchObject({ kind: 'index', index: null, references: null });
    });
});

describe('Hinweise der Fehlerliste (Aufbereitung)', () => {
    it('bildet Gruppen in der Reihenfolge der Swift-Liste, nur nicht leere, mit Datei:Zeile relativ zum Projekt', () => {
        const { builder } = demoBuilder();
        builder.apply(update(2, { changed: [file(IMPL, `${IMPL_TEXT}\\label{chap:einleitung}\n`)] }));
        const groups = hintGroupsOf(builder.takeReferences() ?? EMPTY_REFERENCES, ROOT);
        expect(groups.map((group) => group.id)).toEqual(['duplicates', 'labels', 'acronyms', 'sources']);
        expect(groups[1]?.rows).toEqual([expect.objectContaining({
            title: 'sec:ungenutzt', detail: 'chapters/umsetzung.tex:2', file: IMPL, line: 2,
        })]);
        expect(groups[2]?.rows[0]).toMatchObject({ title: 'ungenutzt', detail: 'UNG – Nie benutzt', file: MAIN, line: 5 });
        expect(groups[3]?.rows[0]).toMatchObject({ title: 'ungenutzt2026', detail: 'Nie zitiert', file: BIB, line: 5 });
    });

    it('ohne Hinweise gibt es keine Gruppen', () => {
        expect(hintGroupsOf(EMPTY_REFERENCES, ROOT)).toEqual([]);
    });

    it('Zeilenschlüssel sind eindeutig, auch bei einem doppelten Label', () => {
        const { builder } = demoBuilder();
        builder.apply(update(2, { changed: [file(IMPL, `${IMPL_TEXT}\\label{sec:ungenutzt}\n`)] }));
        const rows = hintGroupsOf(builder.takeReferences() ?? EMPTY_REFERENCES, ROOT).flatMap((group) => group.rows);
        expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    });
});

describe('Hinweis-Store', () => {
    it('setzt nur bei echter Änderung und zählt alle Hinweise', () => {
        const store = createHintsStore();
        const seen: ReferenceSnapshot[] = [];
        store.subscribe((state) => seen.push(state.references));
        const { references } = demoBuilder();
        store.getState().setReferences(references);
        store.getState().setReferences(references);
        expect(seen).toHaveLength(1);
        expect(hintCount(references)).toBe(3);
        store.getState().setShowsHints(false);
        expect(store.getState().showsHints).toBe(false);
    });
});

// ---------- Client: Ergebnis kommt zusammen mit dem Index an ----------

class FakeTimer implements IndexTimer {
    private readonly scheduled = new Map<number, { at: number; callback: () => void }>();
    private nextHandle = 1;
    now = 0;

    set(callback: () => void, delayMs: number): unknown {
        const handle = this.nextHandle++;
        this.scheduled.set(handle, { at: this.now + delayMs, callback });
        return handle;
    }

    clear(handle: unknown): void {
        this.scheduled.delete(handle as number);
    }

    advance(ms: number): void {
        this.now += ms;
        for (const [handle, entry] of [...this.scheduled]) {
            if (entry.at > this.now) continue;
            this.scheduled.delete(handle);
            entry.callback();
        }
    }
}

class FakeWorker implements CompletionWorkerLike {
    readonly builder = new CompletionIndexBuilder();
    onmessage: CompletionWorkerLike['onmessage'] = null;
    onerror: CompletionWorkerLike['onerror'] = null;
    onmessageerror: CompletionWorkerLike['onmessageerror'] = null;

    postMessage(request: CompletionIndexUpdate): void {
        const data: CompletionIndexResponse = handleCompletionIndexRequest(this.builder, request);
        this.onmessage?.({ data });
    }

    terminate(): void {}
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('Index-Client liefert das Prüfergebnis', () => {
    it('meldet es nach dem Lesen der Projektdateien, nach Tippen in einem offenen Tab und beim Projektwechsel', async () => {
        const disk = new Map<string, string>([[MAIN, MAIN_TEXT], [INTRO, INTRO_TEXT], [IMPL, IMPL_TEXT], [BIB, BIB_TEXT]]);
        const open = new Map<string, { name: string; doc: { toString(): string } }>();
        const timer = new FakeTimer();
        const results: ReferenceSnapshot[] = [];
        const client = new CompletionIndexClient({
            readMany: (paths) => Promise.resolve(paths.map((path): ReadManyItem => {
                const text = disk.get(path) ?? '';
                const value: TextFile = { path, name: path.split('/').at(-1) ?? path, text, encoding: 'utf8', eol: 'lf', hash: `h${text.length}`, mtime: 1 };
                return { path, name: value.name, result: { ok: true, value } };
            })),
            openDocuments: () => open,
            timer,
            createWorker: () => new FakeWorker(),
            onReferencesChanged: (references) => results.push(references),
        });
        client.setProject(PROJECT);
        timer.advance(0);
        await flushPromises();
        expect(results.at(-1)?.unusedLabels.map((entry) => entry.label)).toEqual(['sec:ungenutzt']);
        expect(client.references).toBe(results.at(-1));

        const typed = `${IMPL_TEXT}\\ref{sec:ungenutzt} \\ref{neu:fehlt}\n`;
        open.set(IMPL, { name: 'umsetzung.tex', doc: { toString: () => typed } });
        client.noteDocumentsEdited();
        timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        expect(results.at(-1)?.unusedLabels).toEqual([]);
        expect(problemKeys(results.at(-1) ?? EMPTY_REFERENCES, IMPL)).toEqual(['neu:fehlt']);

        client.setProject({ root: '/q', mainFile: null, files: [] });
        expect(results.at(-1)).toBe(EMPTY_REFERENCES);
    });
});
