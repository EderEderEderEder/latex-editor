// „Speichern vor dem Build“: schreibt alle ungespeicherten Dateien des Projekts über die vorhandene Speicherlogik
// (`saveFile`: Hash-Prüfung, Konflikt, Fehlermeldung in der Statusleiste). Dateien außerhalb des Projekts (Dialog-Dateien)
// zählen nicht, der Build liest sie nicht.
import { saveFile } from './fileActions';
import type { FileActionDeps } from './fileActions';
import { relativeToProject } from './pathBarData';

export function dirtyProjectPaths(deps: Pick<FileActionDeps, 'store'>, root: string | null): string[] {
    const { files } = deps.store.getState();
    return Object.values(files)
        .filter((file) => file.isDirty && relativeToProject(root, file.path) !== null)
        .map((file) => file.path);
}

/** `true`, wenn nichts offen blieb; bei Konflikt oder Fehler `false` (die Meldung hat `saveFile` schon gezeigt) */
export async function saveDirtyProjectFiles(deps: FileActionDeps, root: string | null): Promise<boolean> {
    let allSaved = true;
    for (const path of dirtyProjectPaths(deps, root)) {
        const outcome = await saveFile(deps, path);
        if (outcome !== 'saved' && outcome !== 'unchanged') allSaved = false;
    }
    return allSaved;
}
