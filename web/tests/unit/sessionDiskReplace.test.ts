import { describe, expect, it } from 'vitest';
import { undo, undoDepth } from '@codemirror/commands';
import type { LineEnding, TextFile } from '../../src/shared/contract';
import { EditorSession, fileNameOfPath, minimalReplacement } from '../../src/renderer/editor/session';

// W2-13: minimaler Ersatz (UTF-16-Offsets) und die Sitzungsaufrufe für extern geänderte Dateien, ohne DOM.

const PATH = '/p/kapitel.tex';
const KNOWN_HASH = 'h-alt';
const DISK_HASH = 'h-neu';
const DISK_MTIME = 42;

function file(text: string, hash = KNOWN_HASH, eol: LineEnding = 'lf'): TextFile {
    return { path: PATH, name: fileNameOfPath(PATH), text, encoding: 'utf8', eol, hash, mtime: 0 };
}

function disk(text: string, eol: LineEnding = 'lf'): TextFile {
    return { ...file(text, DISK_HASH, eol), mtime: DISK_MTIME };
}

function run(session: EditorSession, command: typeof undo): boolean {
    return command({ state: session.state, dispatch: (tr) => session.dispatch(tr) });
}

function type(session: EditorSession, at: number, text: string): void {
    session.dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type' });
}

describe('minimalReplacement: gemeinsamer Anfang und gemeinsames Ende', () => {
    it('Umlaute zählen als eine UTF-16-Einheit', () => {
        expect(minimalReplacement('Grüße an Jörg', 'Grüße an Jürgen')).toEqual({ from: 10, to: 13, insert: 'ürgen' });
        expect(minimalReplacement('aÄb', 'aÖb')).toEqual({ from: 1, to: 2, insert: 'Ö' });
    });

    it('trennt am Anfang kein Ersatzpaar (gleiche erste Hälfte)', () => {
        expect(minimalReplacement('😀a', '😁a')).toEqual({ from: 0, to: 2, insert: '😁' });
    });

    it('trennt am Ende kein Ersatzpaar (gleiche zweite Hälfte)', () => {
        // U+1F600 = D83D DE00, U+1F200 = D83C DE00: gleiche zweite Hälfte
        expect(minimalReplacement('x😀', 'x🈀')).toEqual({ from: 1, to: 3, insert: '🈀' });
    });

    it('Emojis vor der Änderung verschieben die Offsets um zwei Einheiten', () => {
        expect(minimalReplacement('😀 alt', '😀 neu')).toEqual({ from: 3, to: 6, insert: 'neu' });
    });

    it('leerer Text vorher oder nachher', () => {
        expect(minimalReplacement('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' });
        expect(minimalReplacement('abc', '')).toEqual({ from: 0, to: 3, insert: '' });
        expect(minimalReplacement('', '')).toBeNull();
    });

    it('identischer Text ergibt keine Änderung; Wiederholungen werden nicht doppelt gezählt', () => {
        expect(minimalReplacement('gleich\n', 'gleich\n')).toBeNull();
        expect(minimalReplacement('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
    });
});

describe('replaceFromDisk: stilles Neuladen eines unveränderten Tabs', () => {
    it('Cursor vor und hinter der Änderung bleibt an seiner Stelle im Text', () => {
        const session = new EditorSession(file('Anfang\nMitte\nEnde'), { selection: { anchor: 2, head: 2 } });
        session.replaceFromDisk(disk('Anfang\nNeue Mitte\nEnde'));
        expect(session.state.doc.toString()).toBe('Anfang\nNeue Mitte\nEnde');
        expect(session.selection).toEqual({ anchor: 2, head: 2 });

        const after = new EditorSession(file('Anfang\nMitte\nEnde'), { selection: { anchor: 15, head: 15 } });
        after.replaceFromDisk(disk('Anfang\nNeue Mitte\nEnde'));
        expect(after.selection).toEqual({ anchor: 20, head: 20 });
    });

    it('bleibt „unverändert“, übernimmt Hash und mtime, meldet keinen Wechsel', () => {
        const changes: boolean[] = [];
        const session = new EditorSession(file('alt'), { onDirtyChange: (_session, dirty) => changes.push(dirty) });
        session.replaceFromDisk(disk('neu'));
        expect(session.isDirty).toBe(false);
        expect(session.file).toMatchObject({ hash: DISK_HASH, mtime: DISK_MTIME });
        expect(changes).toEqual([]);
    });

    it('leert den Undo-Verlauf wie die Swift-Version (auch frühere Schritte)', () => {
        const session = new EditorSession(file('a'));
        type(session, 1, 'b');
        session.markSaved(session.snapshotForSave(), { hash: KNOWN_HASH, mtime: 1 });
        expect(undoDepth(session.state)).toBe(1);
        session.replaceFromDisk(disk('ab und mehr'));
        expect(undoDepth(session.state)).toBe(0);
        expect(run(session, undo)).toBe(false);
        expect(session.state.doc.toString()).toBe('ab und mehr');
    });

    it('nach dem Leeren entsteht beim Tippen wieder ein Verlauf; Rückgängig führt zum Plattenstand („unverändert“)', () => {
        const session = new EditorSession(file('alt'));
        session.replaceFromDisk(disk('neu'));
        type(session, 3, '!');
        expect(session.isDirty).toBe(true);
        expect(run(session, undo)).toBe(true);
        expect(session.state.doc.toString()).toBe('neu');
        expect(session.isDirty).toBe(false);
    });

    it('identischer Text (nur anderer Hash) ändert das Dokument nicht', () => {
        const session = new EditorSession(file('gleich'), { selection: { anchor: 3, head: 5 } });
        session.replaceFromDisk(disk('gleich'));
        expect(session.state.doc.toString()).toBe('gleich');
        expect(session.selection).toEqual({ anchor: 3, head: 5 });
        expect(session.file.hash).toBe(DISK_HASH);
    });

    it('übernimmt geänderte Zeilenenden von der Platte', () => {
        const session = new EditorSession(file('a\nb'));
        session.replaceFromDisk(disk('a\nb\nc', 'crlf'));
        expect(session.state.lineBreak).toBe('\r\n');
        expect(session.file.eol).toBe('crlf');
        expect(session.snapshotForSave().text).toBe('a\nb\nc');
    });

    it('leerer Plattentext', () => {
        const session = new EditorSession(file('etwas'), { selection: { anchor: 5, head: 5 } });
        session.replaceFromDisk(disk(''));
        expect(session.state.doc.length).toBe(0);
        expect(session.selection).toEqual({ anchor: 0, head: 0 });
    });
});

describe('Konflikt: Platten-Version laden und eigene Version behalten', () => {
    it('reloadFromDisk (Platten-Version laden) bleibt rückgängig zu machen, danach wieder „geändert“', () => {
        const session = new EditorSession(file('mein Text'));
        type(session, 9, ' ergänzt');
        session.reloadFromDisk(disk('Plattentext'));
        expect(session.isDirty).toBe(false);
        expect(run(session, undo)).toBe(true);
        expect(session.state.doc.toString()).toBe('mein Text ergänzt');
        expect(session.isDirty).toBe(true);
    });

    it('acceptDiskVersion übernimmt nur den Plattenstand; Text und „geändert“ bleiben', () => {
        const session = new EditorSession(file('mein'));
        type(session, 4, ' Text');
        session.acceptDiskVersion({ hash: DISK_HASH, mtime: DISK_MTIME });
        expect(session.isDirty).toBe(true);
        expect(session.state.doc.toString()).toBe('mein Text');
        expect(session.file).toMatchObject({ hash: DISK_HASH, mtime: DISK_MTIME });
        expect(undoDepth(session.state)).toBe(1);
    });
});
