// Springt zu Datei und Zeile (Gliederung, später Fehlerliste): öffnet die Datei, falls nötig (als Vorschau-Tab),
// aktiviert sie und setzt Cursor und Scrollposition. Die Anzeige wechselt synchron mit dem Store, daher ist die
// Sitzung danach sichtbar und `revealLine` der Sitzung scrollt wirklich.
import { openProjectFile } from './projectFiles';
import type { ProjectFileDeps } from './projectFiles';

export interface RevealDeps extends ProjectFileDeps {
    /** Gibt dem Editor den Fokus, damit man nach dem Sprung gleich weiterschreiben kann */
    readonly focusEditor: () => void;
}

export async function revealLine(deps: RevealDeps, path: string, line: number): Promise<void> {
    if (!(await openProjectFile(deps, path, true))) return;
    deps.store.getState().session(path)?.revealLine(line);
    deps.focusEditor();
}
