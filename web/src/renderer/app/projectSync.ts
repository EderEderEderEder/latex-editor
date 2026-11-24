// Verbindet Projekt-Store, Gliederung und Dateiüberwachung (reine Verdrahtung, ohne React):
// - andere Hauptdatei → Gliederung neu aufbauen; neuer Baum → Gliederung nachziehen,
// - `fs:changed` mit `treeChanged` → Baum entprellt neu holen; geänderte `.tex`-Dateien → Gliederung aktualisieren.
import type { EventListener, Unsubscribe } from '../../shared/contract';
import type { OutlineStoreState } from '../stores/outline';
import type { ProjectStore } from '../stores/project';

type OutlineControl = Pick<OutlineStoreState, 'setMainFile' | 'requestRefresh'>;
const TEX_EXTENSION = /\.tex$/i;

export function connectProjectToOutline(project: ProjectStore, outline: () => OutlineControl): Unsubscribe {
    outline().setMainFile(project.getState().current?.mainFile ?? null);
    return project.subscribe((state, previous) => {
        if (state.current === previous.current) return;
        outline().setMainFile(state.current?.mainFile ?? null);
        if (state.current?.root === previous.current?.root) outline().requestRefresh();
    });
}

export function connectFsEvents(
    on: (listener: EventListener<'fs:changed'>) => Unsubscribe, project: ProjectStore, outline: () => OutlineControl,
): Unsubscribe {
    return on((event) => {
        if (project.getState().current === null) return;
        if (event.treeChanged) project.getState().requestRefresh();
        if (event.paths.some((path) => TEX_EXTENSION.test(path))) outline().requestRefresh();
    });
}
