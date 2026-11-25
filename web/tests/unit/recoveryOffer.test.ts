import { describe, expect, it, vi } from 'vitest';
import type { RecoveryDiskState, RecoveryItem, TextFile } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createOfferRunner, offerRecovery, RECOVERY_OFFER_TEXTS } from '../../src/renderer/app/recoveryOffer';
import type { RecoveryOfferDeps } from '../../src/renderer/app/recoveryOffer';
import { createRecoveryPrompt } from '../../src/renderer/app/recoveryPrompt';
import type { RecoveryChoice } from '../../src/renderer/app/recoveryPrompt';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

const PATH = '/p/main.tex';
const DISK_TEXT = 'Platte\n';
const BACKUP_TEXT = 'aus der Sicherung\n';

function item(diskState: RecoveryDiskState = 'unchanged', path = PATH): RecoveryItem {
    return { path, name: path.split('/').at(-1)!, text: BACKUP_TEXT, savedAt: 1_700_000_000_000, diskState };
}

function diskFile(path: string): TextFile {
    return { path, name: path.split('/').at(-1)!, text: DISK_TEXT, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

function setup(items: RecoveryItem[], choice: RecoveryChoice = 'restore') {
    const stub = createPreloadStub({ 'recovery:list': () => items, 'fs:readText': (path) => diskFile(path) });
    const store = createEditorStore();
    const messages: StatusMessage[] = [];
    const ask = vi.fn((_items: readonly RecoveryItem[]) => Promise.resolve(choice));
    const afterRestore = vi.fn(() => Promise.resolve());
    const deps: RecoveryOfferDeps = { api: stub.api, store, report: (message) => messages.push(message), ask, afterRestore };
    const calls = (channel: string) => stub.calls.filter((call) => call.channel === channel);
    const textOf = (path = PATH): string | undefined => store.getState().session(path)?.state.doc.toString();
    return { stub, store, messages, ask, afterRestore, deps, calls, textOf };
}

describe('Nachfrage nach Sicherungen', () => {
    it('ohne Sicherungen wird nicht gefragt', async () => {
        const { deps, ask } = setup([]);
        expect(await offerRecovery(deps)).toEqual({ offered: 0, choice: null, restored: 0 });
        expect(ask).not.toHaveBeenCalled();
    });

    it('Wiederherstellen öffnet die Datei mit dem gesicherten Text als ungespeicherte Änderung, ohne die Platte zu schreiben', async () => {
        const { deps, store, textOf, calls, messages, afterRestore } = setup([item()]);
        const result = await offerRecovery(deps);
        expect(result).toEqual({ offered: 1, choice: 'restore', restored: 1 });
        expect(textOf()).toBe(BACKUP_TEXT);
        expect(store.getState().session(PATH)?.isDirty).toBe(true);
        expect(store.getState().files[PATH]?.isDirty).toBe(true);
        expect(store.getState().tabs.items).toEqual([PATH]);
        expect(store.getState().tabs.preview).toBeNull();
        expect(calls('fs:writeText')).toHaveLength(0);
        expect(calls('recovery:delete')).toHaveLength(0);
        expect(messages).toEqual([{ text: RECOVERY_OFFER_TEXTS.restored(1), kind: 'info' }]);
        expect(afterRestore).toHaveBeenCalledTimes(1);
    });

    it('ist die Datei schon offen, ersetzt der gesicherte Text den Inhalt dieses Tabs', async () => {
        const { deps, store, textOf, calls } = setup([item()]);
        store.getState().open(diskFile(PATH), { asPreview: false });
        await offerRecovery(deps);
        expect(textOf()).toBe(BACKUP_TEXT);
        expect(store.getState().tabs.items).toEqual([PATH]);
        expect(calls('fs:readText')).toHaveLength(0);
    });

    it('eine inzwischen geänderte Platte wird dem Dialog gemeldet (diskState)', async () => {
        const { deps, ask } = setup([item('changed'), item('missing', '/p/weg.tex')], 'later');
        await offerRecovery(deps);
        const shown = ask.mock.calls[0]?.[0] ?? [];
        expect(shown.map((entry) => entry.diskState)).toEqual(['changed', 'missing']);
    });

    it('eine fehlende Datei wird leer neu angelegt und dann wie jede andere wiederhergestellt', async () => {
        const { deps, textOf, calls } = setup([item('missing')]);
        await offerRecovery(deps);
        expect(calls('fs:writeText').map((call) => call.args)).toEqual([[PATH, '', 'utf8', 'lf']]);
        expect(textOf()).toBe(BACKUP_TEXT);
    });

    it('Verwerfen löscht alle Sicherungen und öffnet nichts', async () => {
        const { deps, store, calls } = setup([item(), item('unchanged', '/p/b.tex')], 'discard');
        const result = await offerRecovery(deps);
        expect(result).toEqual({ offered: 2, choice: 'discard', restored: 0 });
        expect(calls('recovery:delete').map((call) => call.args[0])).toEqual([PATH, '/p/b.tex']);
        expect(store.getState().tabs.items).toEqual([]);
    });

    it('ohne Entscheidung (Escape) bleibt alles liegen', async () => {
        const { deps, store, calls } = setup([item()], 'later');
        await offerRecovery(deps);
        expect(calls('recovery:delete')).toHaveLength(0);
        expect(store.getState().tabs.items).toEqual([]);
    });

    it('eine nicht lesbare Datei wird gemeldet, ihre Sicherung bleibt, die übrigen werden wiederhergestellt', async () => {
        const { stub, deps, store, messages, calls, textOf } = setup([item('unchanged', '/p/kaputt.tex'), item()]);
        stub.respond('fs:readText', (path) => {
            if (path.endsWith('kaputt.tex')) throw new IpcFailure({ kind: 'forbiddenPath', message: 'kein Zugriff' });
            return diskFile(path);
        });
        const result = await offerRecovery(deps);
        expect(result.restored).toBe(1);
        expect(store.getState().tabs.items).toEqual([PATH]);
        expect(textOf()).toBe(BACKUP_TEXT);
        expect(calls('recovery:delete')).toHaveLength(0);
        expect(messages[0]).toEqual({ text: RECOVERY_OFFER_TEXTS.failed('kaputt.tex', 'kein Zugriff'), kind: 'error' });
    });
});

describe('Nachfragen nacheinander', () => {
    it('der Ablauf stellt nie zwei Fragen zugleich (Start und Projektöffnen überschneiden sich)', async () => {
        const { deps } = setup([item()]);
        let open = 0;
        let maxOpen = 0;
        const ask = async () => {
            maxOpen = Math.max(maxOpen, ++open);
            await Promise.resolve();
            open--;
            return 'later' as const;
        };
        const runOffer = createOfferRunner({ ...deps, ask });
        await Promise.all([runOffer(), runOffer(), runOffer()]);
        expect(maxOpen).toBe(1);
    });

    it('eine zweite Frage bei offener Frage wird wie „Später“ beantwortet', async () => {
        const prompt = createRecoveryPrompt();
        const first = prompt.ask([item()]);
        expect(prompt.store.getState().question?.items).toHaveLength(1);
        expect(await prompt.ask([item()])).toBe('later');
        prompt.answer('restore');
        expect(await first).toBe('restore');
        expect(prompt.store.getState().question).toBeNull();
    });
});
