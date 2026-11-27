import { describe, expect, it } from 'vitest';
import type { ProjectFiles } from '../../src/renderer/app/completionIndexLogic';
import { followJumpTarget, JUMP_TEXTS, resolveProjectFile } from '../../src/renderer/app/referenceCheckJump';
import type { JumpFlowDeps } from '../../src/renderer/app/referenceCheckJump';
import { EMPTY_REFERENCES, type ReferenceSnapshot } from '../../src/renderer/app/referenceCheckLogic';
import type { StatusMessage } from '../../src/renderer/stores/status';

// W4-13: Strg-Klick-Ziele öffnen (Label, Quelle, Abkürzung aus dem Prüfergebnis; Dateien aus dem Projektbaum)
const ROOT = '/p';
const MAIN = `${ROOT}/main.tex`;
const INTRO = `${ROOT}/chapters/einleitung.tex`;
const BIB = `${ROOT}/hgbreferences.bib`;
const IMAGE = `${ROOT}/images/verlauf.png`;
const PROJECT: ProjectFiles = { root: ROOT, mainFile: MAIN, files: [MAIN, INTRO, BIB, IMAGE] };
const REFERENCES: ReferenceSnapshot = {
    ...EMPTY_REFERENCES,
    loaded: true,
    labels: [{ label: 'chap:einleitung', file: INTRO, line: 3 }, { label: 'sec:code', file: MAIN, line: 9 }],
    sources: [{ key: 'knuth1984', file: BIB, line: 7, title: 'TeX' }],
    acronyms: [{ key: 'api', file: MAIN, line: 4, summary: 'API' }],
    graphicsDirectories: ['images/'],
};

function setup(project: ProjectFiles | null = PROJECT, references: ReferenceSnapshot = REFERENCES) {
    const revealed: [string, number][] = [];
    const reports: StatusMessage[] = [];
    const deps: JumpFlowDeps = {
        references: () => references,
        project: () => project,
        reveal: (path, line) => {
            revealed.push([path, line]);
            return Promise.resolve();
        },
        report: (message) => reports.push(message),
    };
    return { deps, revealed, reports };
}

describe('Strg-Klick: Ziel öffnen', () => {
    it('Label: Datei und Zeile der Definition', async () => {
        const { deps, revealed } = setup();
        expect(await followJumpTarget(deps, { kind: 'label', key: 'chap:einleitung' }, MAIN)).toBe('opened');
        expect(revealed).toEqual([[INTRO, 3]]);
    });

    it('Zitat: Eintrag in der .bib; Abkürzung: Definition', async () => {
        const { deps, revealed } = setup();
        await followJumpTarget(deps, { kind: 'citation', key: 'knuth1984' }, MAIN);
        await followJumpTarget(deps, { kind: 'acronym', key: 'api' }, MAIN);
        expect(revealed).toEqual([[BIB, 7], [MAIN, 4]]);
    });

    it('unbekannter Schlüssel: Meldung statt Sprung', async () => {
        const { deps, revealed, reports } = setup();
        expect(await followJumpTarget(deps, { kind: 'label', key: 'fig:fehlt' }, MAIN)).toBe('notFound');
        expect(revealed).toEqual([]);
        expect(reports[0]?.text).toContain('fig:fehlt');
        expect(reports[0]?.kind).toBe('info');
    });

    it('ohne Projekt oder vor dem ersten Lesen: Hinweis, kein Sprung', async () => {
        const unloaded = setup(PROJECT, EMPTY_REFERENCES);
        expect(await followJumpTarget(unloaded.deps, { kind: 'label', key: 'a' }, MAIN)).toBe('noProject');
        const noProject = setup(null);
        const target = { kind: 'file', path: 'x', command: 'input' } as const;
        expect(await followJumpTarget(noProject.deps, target, MAIN)).toBe('noProject');
        expect(noProject.reports[0]?.text).toBe(JUMP_TEXTS.noProject);
    });

    it('\\input: Datei relativ zur Hauptdatei, ohne .tex; Zeile 1', async () => {
        const { deps, revealed } = setup();
        const target = { kind: 'file', path: 'chapters/einleitung', command: 'input' } as const;
        expect(await followJumpTarget(deps, target, MAIN)).toBe('opened');
        expect(revealed).toEqual([[INTRO, 1]]);
    });

    it('\\input aus einem Kapitel: auch relativ zur Datei selbst; fehlende Datei: Meldung', async () => {
        const { deps, revealed, reports } = setup();
        await followJumpTarget(deps, { kind: 'file', path: 'einleitung.tex', command: 'input' }, INTRO);
        expect(revealed).toEqual([[INTRO, 1]]);
        expect(await followJumpTarget(deps, { kind: 'file', path: 'gibtesnicht', command: 'input' }, INTRO)).toBe('notFound');
        expect(reports[0]?.text).toBe(JUMP_TEXTS.fileNotFound('gibtesnicht'));
    });
});

describe('Dateien im Projekt finden', () => {
    it('\\bibliography ergänzt .bib; \\includegraphics probiert Endungen und \\graphicspath', () => {
        expect(resolveProjectFile({ kind: 'file', path: 'hgbreferences', command: 'bibliography' }, PROJECT, MAIN, [])).toBe(BIB);
        expect(resolveProjectFile({ kind: 'file', path: 'verlauf', command: 'includegraphics' }, PROJECT, INTRO, ['images/'])).toBe(IMAGE);
        expect(resolveProjectFile({ kind: 'file', path: 'verlauf', command: 'includegraphics' }, PROJECT, INTRO, [])).toBeNull();
    });

    it('vergleicht Pfade mit Windows-Trennern und Laufwerk ohne Rücksicht auf Groß-/Kleinschreibung', () => {
        const project: ProjectFiles = { root: 'C:\\Proj', mainFile: 'C:\\Proj\\main.tex', files: ['C:\\Proj\\main.tex', 'C:\\Proj\\chapters\\Eins.tex'] };
        const target = { kind: 'file', path: 'chapters/eins', command: 'input' } as const;
        expect(resolveProjectFile(target, project, 'C:\\Proj\\main.tex', [])).toBe('C:\\Proj\\chapters\\Eins.tex');
    });
});
