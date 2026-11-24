import { useEffect } from 'react';
import { editorStore } from '../stores/editor';
import { projectStore } from '../stores/project';
import { buildStore, compileOnSave } from './buildRuntime';
import { connectBuildMarks } from './buildMarksSync';

/** Abonniert die Build-Ereignisse des Mains, setzt die Marken in den Sitzungen und beendet alles beim Abbau */
export function useBuildSync(): void {
    useEffect(() => {
        const stopEvents = buildStore.getState().connect();
        const stopMarks = connectBuildMarks({ build: buildStore, editor: editorStore });
        // Ein Projektwechsel verwirft Ergebnis und einen vorgemerkten „Kompilieren beim Speichern“-Lauf des alten Projekts
        const stopProject = projectStore.subscribe((state, previous) => {
            if (state.current?.root === previous.current?.root) return;
            compileOnSave.cancel();
            buildStore.getState().clearResults();
        });
        return () => {
            stopEvents();
            stopMarks();
            stopProject();
            compileOnSave.cancel();
        };
    }, []);
}
