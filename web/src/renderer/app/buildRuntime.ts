// Der Build der App (ein Store je App-Lauf) mit seinen Abhängigkeiten aus den App-Singletons: Hauptdatei und Wurzel
// aus dem Projekt-Store, „Speichern vor dem Build“ über die Speicherlogik, Meldungen in die Statusleiste.
import { useStore } from 'zustand';
import { getApi } from '../ipc/api';
import { createBuildStore, defaultBuildApi } from '../stores/build';
import type { BuildStoreState } from '../stores/build';
import { editorStore } from '../stores/editor';
import { projectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import { statusStore } from '../stores/status';
import { createCompileOnSave } from './compileOnSave';
import { saveDirtyProjectFiles } from './saveBeforeBuild';

const projectRoot = (): string | null => projectStore.getState().current?.root ?? null;

export const buildStore = createBuildStore({
    api: defaultBuildApi,
    mainFile: () => projectStore.getState().current?.mainFile ?? null,
    root: projectRoot,
    // Ohne `onSaved`: Das Speichern vor dem Build darf nicht selbst „Kompilieren beim Speichern“ auslösen.
    saveAll: () => saveDirtyProjectFiles(
        { api: getApi(), store: editorStore, report: (message) => statusStore.getState().show(message) }, projectRoot(),
    ),
    report: (message) => statusStore.getState().show(message),
});

export const compileOnSave = createCompileOnSave({
    isEnabled: () => useSettingsStore.getState().values.compilesOnSave,
    root: projectRoot,
    compile: () => void buildStore.getState().compile(),
});

export function useBuildStore<T>(selector: (state: BuildStoreState) => T): T {
    return useStore(buildStore, selector);
}
