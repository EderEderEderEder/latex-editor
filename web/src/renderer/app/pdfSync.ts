// Hält die PDF-Ansicht beim Projekt (W3-3): Ein Projektwechsel leert sie und zeigt `<Hauptdatei>.pdf`, falls es schon
// existiert; nach jedem erfolgreichen Build mit PDF wird neu geladen (Seite, Zoom und Scrollposition bleiben). Direkt
// am Ereignis `build:finished`, nicht am Build-Store: Der setzt bei gleichem Ergebnis (Dauer, Bericht) nichts neu.
// Ohne DOM und ohne `window` (Vitest); das Einhängen steht in `usePdfSync.ts`.
import type { IpcEvents, Unsubscribe } from '../../shared/contract';
import { pdfPathForMainFile } from '../stores/pdf';
import type { PdfStore } from '../stores/pdf';
import type { ProjectStore } from '../stores/project';

export interface PdfSyncDeps {
    readonly pdf: PdfStore;
    readonly project: ProjectStore;
    readonly onBuildFinished: (listener: (result: IpcEvents['build:finished']) => void) => Unsubscribe;
}

export function shouldReloadAfterBuild(result: IpcEvents['build:finished']): boolean {
    return result.ok && !result.cancelled && result.pdfPath !== null;
}

function showProjectPdf(deps: PdfSyncDeps): void {
    deps.pdf.getState().clear();
    const mainFile = deps.project.getState().current?.mainFile ?? null;
    if (mainFile !== null) void deps.pdf.getState().open(pdfPathForMainFile(mainFile), 'project');
}

export function connectPdfSync(deps: PdfSyncDeps): Unsubscribe {
    const stopProject = deps.project.subscribe((state, previous) => {
        if (state.current?.root === previous.current?.root && state.current?.mainFile === previous.current?.mainFile) return;
        showProjectPdf(deps);
    });
    const stopBuild = deps.onBuildFinished((result) => {
        if (shouldReloadAfterBuild(result) && result.pdfPath !== null) void deps.pdf.getState().open(result.pdfPath, 'build');
    });
    if (deps.project.getState().current !== null) showProjectPdf(deps);
    return () => {
        stopProject();
        stopBuild();
    };
}
