import { useEffect } from 'react';
import { getApi } from '../ipc/api';
import { onMainEvent } from '../ipc/events';
import { diskConflictStore } from '../stores/diskConflict';
import { editorStore } from '../stores/editor';
import { statusStore } from '../stores/status';
import { startDiskSync, stopDiskSync } from './diskSync';
import { recoveryRuntime } from './recovery';

/** Offene Tabs folgen extern geänderten Dateien (`fs:changed`, auch nach Fenster-Fokus und Build), W2-13 */
export function useDiskSync(): void {
    useEffect(() => {
        const sync = startDiskSync({
            api: getApi(),
            store: editorStore,
            conflicts: diskConflictStore,
            report: (message) => statusStore.getState().show(message),
            settleRecovery: () => recoveryRuntime.flush(),
        });
        const unsubscribe = onMainEvent('fs:changed', (event) => sync.handleChanged(event));
        return () => {
            unsubscribe();
            stopDiskSync(sync);
        };
    }, []);
}
