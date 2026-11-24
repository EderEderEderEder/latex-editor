import { useEffect } from 'react';
import { onMainEvent } from '../ipc/events';
import { projectStore } from '../stores/project';
import { outlineStore } from './outlineRuntime';
import { connectFsEvents, connectProjectToOutline } from './projectSync';

/** Gliederung folgt dem Projekt, `fs:changed` holt den Baum neu; lädt „Zuletzt geöffnet“ einmal beim Start */
export function useProjectSync(): void {
    useEffect(() => {
        const outline = () => outlineStore.getState();
        const stopOutline = connectProjectToOutline(projectStore, outline);
        const stopEvents = connectFsEvents((listener) => onMainEvent('fs:changed', listener), projectStore, outline);
        void projectStore.getState().loadRecent();
        return () => {
            stopOutline();
            stopEvents();
        };
    }, []);
}
