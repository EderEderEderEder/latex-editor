import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BuildRunner, defaultBuildDependencies } from '../../src/main/build';
import { detectTools } from '../../src/main/tools';
import { createParseRequestHandler } from '../../src/main/workers/parse.worker';
import { appendix, buildSource } from '../../src/shared/core/bib/sourceBuilder';
import type { SourceSettings } from '../../src/shared/core/bib/sourceBuilder';
import { SOURCE_TYPE_NAMES, sourceFields } from '../../src/shared/core/bib/sourceTypes';
import type { SourceTypeName } from '../../src/shared/core/bib/sourceTypes';
import {
    adjustBlock, CODE_LANGUAGES, createCodeSettings, createEquationSettings, createImageSettings, createListSettings,
    createTableSettings, fillTableFromTabSeparated, generateCitation, generateCode, generateEquation, generateImage,
    generateList, generateReference, generateTable, graphicsReference, labelsInText, uniqueLabel,
} from '../../src/shared/core/insertion';
import type { EquationKind, ListKind } from '../../src/shared/core/insertion';

// W4-11: Kompiliertest aller Bausteine des Einfügen-Fensters. Läuft nur mit LATEXEDITOR_REAL_TEX=1, installiertem TeX
// und `shared/Testdaten/HgbDemo`, und nur auf einer KOPIE im Temp-Ordner (nie auf dem Original): jeden Baustein
// (Tabelle, Bild, Gleichungen, Listen, Verweis, Zitat, Code in allen Sprachumgebungen, Quellen jedes Typs und als
// BibTeX) mit den Generatoren erzeugen, wie das Fenster in eine neue Datei einsetzen, die Hauptdatei mit latexmk
// kompilieren (`BuildRunner`, ohne Shell) und prüfen: Exit 0, keine Fehler im Log (`logParser`), keine unbekannten
// Verweise auf die eingefügten Labels und Schlüssel.

const REAL_TEX_ENV = 'LATEXEDITOR_REAL_TEX';
const DEMO_PROJECT = fileURLToPath(new URL('../../../shared/Testdaten/HgbDemo', import.meta.url));
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;
const REAL_TEX_TIMEOUT_MS = 300_000;
const PDFLATEX = { engine: 'pdflatex' } as const;
const TEST_CHAPTER = 'chapters/einfuegetest';
const BIB_FILE = 'hgbreferences.bib';
const IMAGE_FILE = 'images/verlauf.png';
const TODAY = '2026-11-27';
const LINE_FEED = '\n';
const CODE_SAMPLE = 'int x = 1; // Beispiel\n\tif (x) { y = "text"; }';
const ALIGN_SAMPLE = 'a &= b \\\\\nc &= d';
const FORMULA_SAMPLE = 'E = mc^2';
const EQUATION_KINDS: readonly EquationKind[] = ['equation', 'equationStar', 'align', 'alignStar'];
const LIST_KINDS: readonly ListKind[] = ['itemize', 'enumerate'];
const TABLE_SAMPLE = 'Name\tAnteil\nA\t50 %\nB\t&x_y';
const BIBTEX_SAMPLE = '@article{eingefuegt,\n  author = {Erika Musterfrau},\n  title = {Ein eingefügter Artikel},\n  journaltitle = {Zeitschrift},\n  date = {2020}\n}';
const REQUIRED_VALUES: Readonly<Record<string, string>> = {
    date: '2024', url: 'https://example.com/seite', urldate: '2025-01-02', type: 'Masterarbeit',
};

const enabled = process.env[REAL_TEX_ENV] === '1' && existsSync(DEMO_PROJECT);

interface Chapter {
    text: string;
    readonly labels: Set<string>;
}

function newChapter(existingLabels: Iterable<string>): Chapter {
    return { text: '\\chapter{Einfügetest}\n\\label{chap:einfuegetest}\n', labels: new Set(existingLabels) };
}

/** Label wie das Fenster es vergibt (Vorsatz, Beschriftung, eindeutig im Projekt) */
function labelFor(chapter: Chapter, prefix: string, caption: string): string {
    const label = uniqueLabel(prefix, caption, 'x', chapter.labels);
    chapter.labels.add(label);
    return label;
}

/** Block an das Ende setzen, wie `adjustBlock` es in einer Datei an der Cursorposition täte; davor eine Leerzeile */
function addBlock(chapter: Chapter, block: string): void {
    const base = chapter.text.endsWith('\n\n') ? chapter.text : `${chapter.text}\n`;
    chapter.text = base + adjustBlock(block, base, { location: base.length, length: 0 });
}

function addParagraph(chapter: Chapter, text: string): void {
    addBlock(chapter, `${text}\n`);
}

function addTable(chapter: Chapter): void {
    const settings = fillTableFromTabSeparated(createTableSettings({ caption: 'Messwerte & Anteile' }), TABLE_SAMPLE);
    addBlock(chapter, generateTable({ ...settings, alignments: ['left', 'right'] }, labelFor(chapter, 'tab', settings.caption)));
    const grid = fillTableFromTabSeparated(createTableSettings({ rules: 'grid', caption: 'Mit allen Linien' }), 'a\tb\nc\td');
    addBlock(chapter, generateTable(grid, labelFor(chapter, 'tab', grid.caption)));
}

function addImage(chapter: Chapter): void {
    const reference = graphicsReference(`/p/${IMAGE_FILE}`, '/p', ['images/']);
    const settings = createImageSettings({ caption: 'Ein Bild aus dem Projekt', placement: 'here', widthPercent: 50 });
    addBlock(chapter, generateImage(settings, reference, labelFor(chapter, 'fig', settings.caption)));
}

function addEquationsAndLists(chapter: Chapter): void {
    for (const kind of EQUATION_KINDS) {
        const content = kind.startsWith('align') ? ALIGN_SAMPLE : FORMULA_SAMPLE;
        addBlock(chapter, generateEquation(createEquationSettings({ kind, content }), labelFor(chapter, 'eq', `Gleichung ${kind}`)));
    }
    for (const kind of LIST_KINDS) addBlock(chapter, generateList(createListSettings({ kind, items: ['Erster Punkt', '', 'Dritter Punkt'] })));
}

/** Alle Sprachumgebungen, im Float mit Beschriftung; dazu eine ohne Float und eine ohne Zeilennummern */
function addCode(chapter: Chapter): void {
    for (const language of CODE_LANGUAGES) {
        const settings = createCodeSettings({ language: language.environment, content: CODE_SAMPLE, caption: `Code in ${language.title}` });
        addBlock(chapter, generateCode(settings, labelFor(chapter, 'prog', settings.caption)));
    }
    addBlock(chapter, generateCode(createCodeSettings({ asFloat: false, content: CODE_SAMPLE }), ''));
    addBlock(chapter, generateCode(createCodeSettings({ lineNumbers: false, content: CODE_SAMPLE, caption: 'Ohne Zeilennummern' }), labelFor(chapter, 'prog', 'ohne')));
}

function formValuesFor(type: SourceTypeName): Record<string, string> {
    const values: Record<string, string> = { title: `Titel für ${type}` };
    for (const field of sourceFields(type)) {
        if (field.isRequired && values[field.name] === undefined) values[field.name] = REQUIRED_VALUES[field.name] ?? `Wert ${field.name}`;
    }
    return values;
}

/** Je Quellentyp ein Formular-Eintrag, dazu eingefügtes BibTeX; die Einträge hängen wie im Fenster ans Ende der `.bib` */
function sourceEntries(existingKeys: string[]): { entries: string[]; keys: string[] } {
    const settingsList: Partial<SourceSettings>[] = SOURCE_TYPE_NAMES.map((type): Partial<SourceSettings> => (
        { mode: 'form', type, authors: 'Max Mustermann; Erika Musterfrau', values: formValuesFor(type), language: 'german' }
    ));
    settingsList.push({ mode: 'bibtex', bibtex: BIBTEX_SAMPLE });
    const keys = [...existingKeys];
    const entries: string[] = [];
    for (const settings of settingsList) {
        const result = buildSource(settings, keys, TODAY);
        if (!result.ok) throw new Error(`Quelle ohne Eintrag: ${JSON.stringify(result.problem)}`);
        keys.push(result.key);
        entries.push(result.entry);
    }
    return { entries, keys: keys.slice(existingKeys.length) };
}

async function existingLabelsOf(project: string): Promise<string[]> {
    const names = (await readdir(join(project, 'chapters'))).filter((name) => name.endsWith('.tex')).map((name) => join('chapters', name));
    const files = ['main.tex', ...names];
    const texts = await Promise.all(files.map(async (file) => labelsInText(await readFile(join(project, file), 'utf8'), file)));
    return texts.flat().map((entry) => entry.label);
}

function bibKeysOf(text: string): string[] {
    return [...text.matchAll(/^@\w+\{([^,\s]+),/gm)].map((match) => match[1] ?? '');
}

/** Hängt die Einträge wie `bib:append` an und liefert die Schlüssel */
async function appendSources(project: string): Promise<string[]> {
    const path = join(project, BIB_FILE);
    let text = await readFile(path, 'utf8');
    const { entries, keys } = sourceEntries(bibKeysOf(text));
    for (const entry of entries) text += appendix(entry, text);
    await writeFile(path, text);
    return keys;
}

async function writeTestChapter(project: string): Promise<{ labels: string[]; keys: string[] }> {
    const chapter = newChapter(await existingLabelsOf(project));
    const existing = new Set(chapter.labels);
    addTable(chapter);
    addImage(chapter);
    addEquationsAndLists(chapter);
    addCode(chapter);
    const keys = await appendSources(project);
    const figure = [...chapter.labels].find((label) => label.startsWith('fig:') && !existing.has(label)) ?? '';
    addParagraph(chapter, `Siehe ${generateReference({ label: figure, withPrefix: true })} und ${generateCitation({ keys: ['knuth1984', ...keys], note: 'S.~12' })}.`);
    await writeFile(join(project, `${TEST_CHAPTER}.tex`), chapter.text);
    const main = await readFile(join(project, 'main.tex'), 'utf8');
    await writeFile(join(project, 'main.tex'), main.replace('\\appendix', `\\input{${TEST_CHAPTER}}\n\\appendix`));
    return { labels: [...chapter.labels].filter((label) => !existing.has(label)), keys };
}

describe.skipIf(!enabled)('Kompiliertest aller Einfüge-Bausteine auf einer Kopie von HgbDemo', () => {
    it('Tabelle, Bild, Gleichungen, Listen, Verweis, Zitat, Code (alle Sprachen) und Quellen kompilieren ohne Fehler', { timeout: REAL_TEX_TIMEOUT_MS }, async () => {
        const tools = await detectTools();
        expect(tools.latexmk, 'latexmk gefunden (PATH oder /Library/TeX/texbin)').not.toBeNull();
        const copy = await mkdtemp(join(tmpdir(), 'latexeditor-insertcompile-'));
        try {
            await cp(DEMO_PROJECT, copy, { recursive: true, filter: (source) => !BUILD_FILE_PATTERN.test(source) });
            const inserted = await writeTestChapter(copy);
            expect(inserted.labels.length).toBeGreaterThan(CODE_LANGUAGES.length);
            const runner = new BuildRunner(defaultBuildDependencies());
            const outcome = await runner.start({ latexmk: tools.latexmk ?? '', mainFile: join(copy, 'main.tex'), options: PDFLATEX, problems: tools.problems });
            expect(outcome).toMatchObject({ kind: 'finished', ok: true, exitCode: 0 });
            expect((await stat(join(copy, 'main.pdf'))).size).toBeGreaterThan(0);

            const parsed = await createParseRequestHandler()({ id: 1, logPath: join(copy, 'main.log'), biberPath: join(copy, 'main.blg'), baseDirectory: copy });
            if (!parsed.ok) throw new Error(parsed.error.message);
            const errors = parsed.value.filter((issue) => issue.severity === 'error');
            expect(errors.map((issue) => issue.message)).toEqual([]);
            const names = [...inserted.labels, ...inserted.keys, 'knuth1984'];
            const ours = parsed.value.filter((issue) => names.some((name) => issue.message.includes(name)));
            expect(ours.map((issue) => issue.message)).toEqual([]);
            expect((await readFile(join(copy, `${TEST_CHAPTER}.tex`), 'utf8')).split(LINE_FEED).length).toBeGreaterThan(CODE_LANGUAGES.length * 4);
        } finally {
            await rm(copy, { recursive: true, force: true });
        }
    });
});
