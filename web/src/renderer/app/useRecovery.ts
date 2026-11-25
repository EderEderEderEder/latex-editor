import { useEffect } from 'react';
import { getApi } from '../ipc/api';
import { editorStore } from '../stores/editor';
import { useSettingsStore } from '../stores/settings';
import { projectStore } from '../stores/project';
import { statusStore } from '../stores/status';
import type { StatusMessage } from '../stores/status';
import { recoveryRuntime, startRecovery, stopRecovery } from './recovery';
import { createOfferRunner } from './recoveryOffer';
import { recoveryPrompt } from './recoveryPrompt';
import { loadSettingsOnce } from './startup';

/**
 * Sicherung ungespeicherter Tabs läuft mit der App; die Nachfrage nach früheren Sicherungen kommt nach dem Laden der
 * Einstellungen und jedes Mal, wenn ein anderes Projekt öffnet (Sicherungen von Projektdateien gehören zu ihrem Projekt).
 */
export function useRecovery(): void {
    useEffect(() => {
        const report = (message: StatusMessage): void => statusStore.getState().show(message);
        const controller = startRecovery({ api: getApi(), store: editorStore, report });
        const offer = createOfferRunner({
            api: getApi(),
            store: editorStore,
            report,
            ask: (items) => recoveryPrompt.ask(items),
            afterRestore: () => recoveryRuntime.flush(),
        });
        let active = true;
        void loadSettingsOnce(useSettingsStore, report).then(() => {
            if (active) void offer();
        });
        const unsubscribe = projectStore.subscribe((state, previous) => {
            const root = state.current?.root ?? null;
            if (root !== null && root !== (previous.current?.root ?? null)) void offer();
        });
        return () => {
            active = false;
            unsubscribe();
            void stopRecovery(controller);
        };
    }, []);
}
