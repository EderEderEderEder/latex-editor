// Hält die Marken des Builds in den Sitzungen aktuell (reine Verdrahtung ohne React): Ein neuer Bericht ersetzt die
// Marken aller offenen Dateien, eine neu geöffnete Datei bekommt die Marken des letzten Berichts. Je Sitzung wird
// gemerkt, für welche Meldungen (`fileIssues`) sie zuletzt gesetzt wurden; so bleibt jedes Update billig.
import type { BuildIssue, Unsubscribe } from '../../shared/contract';
import { applyBuildMarks, marksOfIssues } from '../editor/buildMarks';
import type { BuildMarkTarget } from '../editor/buildMarks';
import type { BuildStore } from '../stores/build';
import type { EditorStore } from '../stores/editor';
import { pathKey } from './issueNavigation';

type FileIssues = ReadonlyMap<string, readonly BuildIssue[]>;

interface Applied {
    readonly source: FileIssues;
    readonly hadMarks: boolean;
}

/** Was von einer Sitzung gebraucht wird: Pfad und Zugriff auf den Zustand */
export interface MarkedSession extends BuildMarkTarget {
    readonly path: string;
}

export interface BuildMarksSyncDeps {
    readonly build: Pick<BuildStore, 'getState' | 'subscribe'>;
    readonly editor: Pick<EditorStore, 'getState' | 'subscribe'>;
}

function syncSession(session: MarkedSession, fileIssues: FileIssues, memory: WeakMap<object, Applied>): void {
    const previous = memory.get(session);
    if (previous?.source === fileIssues) return;
    const marks = marksOfIssues(fileIssues.get(pathKey(session.path)) ?? []);
    memory.set(session, { source: fileIssues, hadMarks: marks.length > 0 });
    if (marks.length === 0 && previous?.hadMarks !== true) return;
    applyBuildMarks(session, marks);
}

export function connectBuildMarks({ build, editor }: BuildMarksSyncDeps): Unsubscribe {
    const memory = new WeakMap<object, Applied>();
    const syncAll = (): void => {
        const { fileIssues } = build.getState();
        const state = editor.getState();
        for (const path of Object.keys(state.files)) {
            const session = state.session(path);
            if (session !== undefined && !session.isDisposed) syncSession(session, fileIssues, memory);
        }
    };
    const stopBuild = build.subscribe((state, previous) => {
        if (state.fileIssues !== previous.fileIssues) syncAll();
    });
    const stopEditor = editor.subscribe((state, previous) => {
        if (state.files !== previous.files) syncAll();
    });
    syncAll();
    return () => {
        stopBuild();
        stopEditor();
    };
}
