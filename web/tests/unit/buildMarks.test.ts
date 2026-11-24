import { EditorState, Text } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { BuildIssue } from '../../src/shared/contract';
import { connectBuildMarks } from '../../src/renderer/app/buildMarksSync';
import {
    applyBuildMarks, buildMarksExtension, buildMarksOf, gutterMarksForBuild, lineRangeOf, marksOfIssues, mergeGutterMarks,
} from '../../src/renderer/editor/buildMarks';
import { gutterExtension, gutterMarksOf, setGutterMarks } from '../../src/renderer/editor/gutter';
import { EditorSession } from '../../src/renderer/editor/session';
import { createBuildStore } from '../../src/renderer/stores/build';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createPreloadStub } from '../support/preloadStub';

const PATH = '/p/a.tex';
const issue = (severity: BuildIssue['severity'], line: number | null, message = 'm', file: string | null = PATH): BuildIssue =>
    ({ severity, message, file, line });

const stateOf = (text: string): EditorState =>
    EditorState.create({ doc: text, extensions: [gutterExtension({ path: PATH }), buildMarksExtension()] });

/** Minimales Ziel für `applyBuildMarks`: hält den Zustand und wendet Transaktionen an */
const holderOf = (state: EditorState) => ({
    state,
    dispatch(...specs: TransactionSpec[]): void {
        this.state = this.state.update(...specs).state;
    },
});

const textFile = (path: string, text: string) =>
    ({ path, name: path.split('/').at(-1) ?? path, text, encoding: 'utf8' as const, eol: 'lf' as const, hash: 'h', mtime: 0 });

describe('Meldung → Zeilenbereich', () => {
    const doc = Text.of(['  \\input{x}  ', '', '   ', 'Ende']);

    it('umfasst die Zeile ohne Randleerzeichen', () => {
        expect(lineRangeOf(doc, 1)).toEqual({ from: 2, to: 11 });
        expect(lineRangeOf(doc, 4)).toEqual({ from: 19, to: 23 });
    });

    it('leere, nur aus Leerzeichen bestehende und ungültige Zeilen haben keinen Bereich', () => {
        for (const line of [2, 3, 0, 5, -1, 1.5, Number.NaN]) expect(lineRangeOf(doc, line)).toBeNull();
    });
});

describe('Marken aus Meldungen', () => {
    it('Fehler, Warnung und Box bekommen Marken, Hinweise und Meldungen ohne Zeile nicht', () => {
        const marks = marksOfIssues([
            issue('error', 3), issue('warning', 4), issue('badBox', 5), issue('info', 6), issue('error', null), issue('error', 0),
        ]);
        expect(marks.map((mark) => [mark.line, mark.severity])).toEqual([[3, 'error'], [4, 'warning'], [5, 'badBox']]);
    });

    it('Zeilenleiste: Kreis, Dreieck, Raute mit Text als Tooltip', () => {
        const gutter = gutterMarksForBuild(marksOfIssues([issue('error', 1, 'E'), issue('warning', 2, 'W'), issue('badBox', 3, 'B')]));
        expect(gutter).toEqual([
            { line: 1, kind: 'error', message: 'E' }, { line: 2, kind: 'warning', message: 'W' }, { line: 3, kind: 'box', message: 'B' },
        ]);
    });

    it('Git-Streifen bleiben beim Ersetzen der Build-Marken erhalten', () => {
        const merged = mergeGutterMarks(
            [{ line: 1, kind: 'gitAdded' }, { line: 2, kind: 'error', message: 'alt' }], [{ line: 3, kind: 'warning', message: 'neu' }],
        );
        expect(merged).toEqual([{ line: 1, kind: 'gitAdded' }, { line: 3, kind: 'warning', message: 'neu' }]);
    });
});

describe('Marken im Zustand', () => {
    const text = 'eins\n  zwei\n\ndrei';
    const marked = (): EditorState => {
        const state = stateOf(text);
        const holder = holderOf(state);
        applyBuildMarks(holder, marksOfIssues([issue('error', 2, 'Fehler 2'), issue('warning', 1, 'Warnung 1'), issue('error', 3)]));
        return holder.state;
    };

    it('unterstreicht die Zeile und setzt die Marke der Zeilenleiste; die leere Zeile bekommt nur die Marke', () => {
        const state = marked();
        expect(buildMarksOf(state)).toEqual([
            { severity: 'warning', from: 0, to: 4, message: 'Warnung 1' },
            { severity: 'error', from: 7, to: 11, message: 'Fehler 2' },
        ]);
        expect(gutterMarksOf(state).map((mark) => [mark.line, mark.kind])).toEqual([[1, 'warning'], [2, 'error'], [3, 'error']]);
    });

    it('Marken wandern beim Tippen mit und fallen weg, wenn der Text gelöscht wird', () => {
        const typed = marked().update({ changes: { from: 0, insert: 'neu\n' } }).state;
        expect(buildMarksOf(typed).map((mark) => mark.from)).toEqual([4, 11]);
        const deleted = typed.update({ changes: { from: 11, to: 15 } }).state;
        expect(buildMarksOf(deleted).map((mark) => mark.severity)).toEqual(['warning']);
    });

    it('der nächste Satz Marken ersetzt die alten', () => {
        const holder = holderOf(marked());
        applyBuildMarks(holder, marksOfIssues([issue('badBox', 4, 'Box')]));
        expect(buildMarksOf(holder.state)).toEqual([{ severity: 'badBox', from: 13, to: 17, message: 'Box' }]);
        expect(gutterMarksOf(holder.state)).toEqual([{ line: 4, kind: 'box', message: 'Box' }]);
    });

    it('Git-Marken der Sitzung überleben applyBuildMarks', () => {
        const state = stateOf(text).update({ effects: setGutterMarks([{ line: 1, kind: 'gitModified' }]) }).state;
        const holder = holderOf(state);
        applyBuildMarks(holder, marksOfIssues([issue('error', 2)]));
        expect(gutterMarksOf(holder.state).map((mark) => mark.kind)).toEqual(['gitModified', 'error']);
    });
});

describe('Marken in den Sitzungen (Verdrahtung)', () => {
    const setup = () => {
        const stub = createPreloadStub();
        const build = createBuildStore({
            api: () => stub.api, mainFile: () => PATH, root: () => '/p', saveAll: () => Promise.resolve(true), report: () => undefined,
        });
        const editor = createEditorStore();
        const stop = connectBuildMarks({ build, editor });
        build.getState().connect();
        const finish = (report: BuildIssue[]): void =>
            stub.emit('build:finished', { ok: false, cancelled: false, report, pdfPath: null, durationMs: 1 });
        const session = (path: string): EditorSession => editor.getState().session(path)!;
        return { stub, build, editor, stop, finish, session };
    };

    it('ein neuer Bericht setzt die Marken offener Dateien, der nächste ersetzt sie', () => {
        const { editor, finish, session } = setup();
        editor.getState().open(textFile(PATH, 'eins\nzwei'), { asPreview: false });
        editor.getState().open(textFile('/p/b.tex', 'x\ny'), { asPreview: false });
        finish([issue('error', 2, 'F')]);
        expect(buildMarksOf(session(PATH).state)).toHaveLength(1);
        expect(buildMarksOf(session('/p/b.tex').state)).toHaveLength(0);
        finish([issue('warning', 1, 'W', '/p/b.tex')]);
        expect(buildMarksOf(session(PATH).state)).toHaveLength(0);
        expect(gutterMarksOf(session(PATH).state)).toEqual([]);
        expect(buildMarksOf(session('/p/b.tex').state)[0]?.severity).toBe('warning');
    });

    it('eine später geöffnete Datei bekommt die Marken des letzten Berichts', () => {
        const { editor, finish, session } = setup();
        finish([issue('error', 1, 'F')]);
        editor.getState().open(textFile(PATH, 'eins\nzwei'), { asPreview: false });
        expect(buildMarksOf(session(PATH).state).map((mark) => mark.message)).toEqual(['F']);
    });

    it('Marken verändern weder den Text noch „geändert“, und nach stop() passiert nichts mehr', () => {
        const { editor, finish, session, stop } = setup();
        editor.getState().open(textFile(PATH, 'eins\nzwei'), { asPreview: false });
        finish([issue('error', 1)]);
        expect(session(PATH).isDirty).toBe(false);
        expect(session(PATH).state.doc.toString()).toBe('eins\nzwei');
        stop();
        finish([issue('error', 2)]);
        expect(buildMarksOf(session(PATH).state)[0]?.from).toBe(0);
    });
});
