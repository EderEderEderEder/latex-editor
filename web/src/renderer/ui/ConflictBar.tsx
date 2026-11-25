// Konfliktleiste über dem Editor (W2-13): Die gezeigte Datei wurde auf der Platte geändert, während der Tab
// ungespeicherte Änderungen hat, oder sie wurde gelöscht. Erscheint nur dann (sonst kein Platz), `role="alert"`,
// echte Knöpfe (Tab/Enter/Leertaste). Die Aktionen laufen über `diskSyncRuntime` (`app/diskSync.ts`).
import { useState } from 'react';
import { diskSyncRuntime } from '../app/diskSync';
import type { AbsolutePath } from '../../shared/contract';
import type { DiskConflictKind } from '../stores/diskConflict';
import { useDiskConflictStore } from '../stores/diskConflict';
import { useEditorStore } from '../stores/editor';
import './conflictBar.css';

export const CONFLICT_BAR_TEXTS = {
    changed: 'Die Datei wurde auf der Festplatte geändert.',
    changedDetail: 'Hier gibt es ungespeicherte Änderungen.',
    deleted: 'Die Datei wurde auf der Festplatte gelöscht.',
    deletedDetail: 'Der Text bleibt im Editor erhalten.',
    loadDisk: 'Platten-Version laden',
    loadDiskHelp: 'Version von der Festplatte übernehmen. Die eigene Version wird vorher gesichert; Rückgängig holt sie zurück.',
    keepMine: 'Meine Version behalten',
    keepMineHelp: 'Eigene Version behalten; Speichern überschreibt dann die Datei auf der Festplatte.',
    recreate: 'Neu anlegen',
    recreateHelp: 'Datei mit dem Text aus dem Editor wieder anlegen.',
} as const;

interface BarAction {
    readonly label: string;
    readonly help: string;
    readonly run: (path: AbsolutePath) => Promise<void>;
}

const ACTIONS: Readonly<Record<DiskConflictKind, readonly BarAction[]>> = {
    changed: [
        { label: CONFLICT_BAR_TEXTS.loadDisk, help: CONFLICT_BAR_TEXTS.loadDiskHelp, run: diskSyncRuntime.loadDiskVersion },
        { label: CONFLICT_BAR_TEXTS.keepMine, help: CONFLICT_BAR_TEXTS.keepMineHelp, run: diskSyncRuntime.keepMine },
    ],
    deleted: [{ label: CONFLICT_BAR_TEXTS.recreate, help: CONFLICT_BAR_TEXTS.recreateHelp, run: diskSyncRuntime.recreate }],
};

const MESSAGES: Readonly<Record<DiskConflictKind, { readonly text: string; readonly detail: string }>> = {
    changed: { text: CONFLICT_BAR_TEXTS.changed, detail: CONFLICT_BAR_TEXTS.changedDetail },
    deleted: { text: CONFLICT_BAR_TEXTS.deleted, detail: CONFLICT_BAR_TEXTS.deletedDetail },
};

function ConflictActions({ path, kind }: { readonly path: AbsolutePath; readonly kind: DiskConflictKind }) {
    const [busy, setBusy] = useState(false);
    const run = (action: BarAction): void => {
        setBusy(true);
        void action.run(path).finally(() => setBusy(false));
    };
    return (
        <span className="conflict-bar-actions">
            {ACTIONS[kind].map((action) => (
                <button key={action.label} type="button" title={action.help} disabled={busy} onClick={() => run(action)}>
                    {action.label}
                </button>
            ))}
        </span>
    );
}

export function ConflictBar() {
    const active = useEditorStore((state) => state.tabs.active);
    const kind = useDiskConflictStore((state) => (active === null ? null : (state.conflicts[active]?.kind ?? null)));
    if (active === null || kind === null) return null;
    const message = MESSAGES[kind];
    return (
        <div className={`conflict-bar is-${kind}`} role="alert">
            <span className="conflict-bar-message">
                <strong>{message.text}</strong> {message.detail}
            </span>
            <ConflictActions key={`${active}:${kind}`} path={active} kind={kind} />
        </div>
    );
}
