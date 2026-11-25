// SyncTeX-Abläufe der Oberfläche (W3-5, Vorlage Swift `AppModel.showCursorInPDF`/`showInEditor` und
// `PDFPreviewStore.reveal`): Vorwärts (Strg+J bzw. ⌘J: Cursorzeile → Stelle im PDF, etwa mittig, ohne Markierung),
// Rückwärts (Strg-Klick bzw. ⌘-Klick ins PDF → Datei und Zeile im Editor, nur `.tex`-Dateien des Projekts) und
// „PDF folgt Cursor“ (entprellt, scrollt nur, wenn die Stelle gerade nicht sichtbar ist, meldet nichts).
// Abweichung von Swift (dort bleibt der Modus): Strg+J im Modus „Editor“ und ein Klick im Modus „PDF“ wechseln nach
// „Geteilt“, sonst wäre das Ergebnis unsichtbar. Reine Funktionen mit Fakes testbar, ohne DOM-Typen (Vitest).
import type { IpcEvents, IpcResult, PdfRect, RendererApi, Unsubscribe } from '../../shared/contract';
import { unionRect } from '../../shared/core/synctexCoordinates';
import type { PdfPoint } from '../../shared/core/synctexCoordinates';
import { fail, toIpcError } from '../../shared/ipcResult';
import type { EditorStore } from '../stores/editor';
import type { PdfStore } from '../stores/pdf';
import type { ProjectStore } from '../stores/project';
import type { StatusMessage } from '../stores/status';
import type { SyncTeXStore } from '../stores/synctex';
import type { ViewModeStore } from '../stores/viewMode';
import { createDebounced } from './debounce';
import { relativeToProject } from './pathBarData';
import { revealLine } from './revealLine';
import type { RevealDeps } from './revealLine';

/** `explicit`: Tastenkürzel/Menü, scrollt immer und meldet Probleme; `follow`: „PDF folgt Cursor“ */
export type RevealMode = 'explicit' | 'follow';

export type ForwardOutcome =
    | 'shown' | 'alreadyVisible' | 'noFile' | 'notInProject' | 'noPdf' | 'pdfHidden' | 'noSyncTeX' | 'notFound'
    | 'failed' | 'superseded';
export type BackwardOutcome = 'opened' | 'noProject' | 'noSyncTeX' | 'notFound' | 'notProjectTex' | 'failed' | 'superseded';

/** Ziel im PDF in SyncTeX-Koordinaten (Ursprung oben links der Seite); `page` 1-basiert */
export interface SyncTeXTarget {
    readonly page: number;
    readonly rect: PdfRect;
}

export type ViewerRevealResult = 'scrolled' | 'visible' | 'unavailable';

/** Teil der PDF-Ansicht für SyncTeX (umgesetzt in `pdf/viewer.ts`) */
export interface SyncTeXViewerPort {
    /** `onlyIfHidden`: nichts tun, wenn die Stelle schon ganz sichtbar ist */
    reveal(target: SyncTeXTarget, onlyIfHidden: boolean): ViewerRevealResult;
}

export interface ViewerSlot {
    get(): SyncTeXViewerPort | null;
    set(viewer: SyncTeXViewerPort | null): void;
}

/** Tasten und Knopf eines Mausklicks (ohne DOM-Typ) */
export interface ClickInput {
    readonly button: number;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
}

export interface SyncTeXFlowDeps {
    readonly api: Pick<RendererApi, 'synctex'>;
    readonly editor: Pick<EditorStore, 'getState'>;
    readonly project: Pick<ProjectStore, 'getState'>;
    readonly pdf: Pick<PdfStore, 'getState'>;
    readonly viewMode: Pick<ViewModeStore, 'getState'>;
    readonly synctex: Pick<SyncTeXStore, 'getState'>;
    readonly viewer: () => SyncTeXViewerPort | null;
    readonly reveal: () => RevealDeps;
    readonly report: (message: StatusMessage) => void;
}

export interface SyncTeXConnectDeps {
    readonly flow: () => SyncTeXFlowDeps;
    readonly store: Pick<SyncTeXStore, 'getState'>;
    readonly project: Pick<ProjectStore, 'subscribe'>;
    readonly followsCursor: () => boolean;
    readonly onReady: (listener: (payload: IpcEvents['synctex:ready']) => void) => Unsubscribe;
    readonly onCursorActivity: (listener: () => void) => Unsubscribe;
    readonly delayMs?: number;
}

/** Wie Swift „PDF folgt nach kurzer Pause“ */
export const FOLLOW_CURSOR_DELAY_MS = 300;
const PRIMARY_BUTTON = 0;
const TEX_FILE = /\.tex$/i;
const PATH_SEPARATOR = /[\\/]/;

export const SYNCTEX_TEXTS = {
    noFile: 'Keine Datei offen: Zur PDF-Stelle springen geht nur aus einer Datei des Projekts.',
    notInProject: (name: string) => `„${name}“ gehört nicht zum Projekt; zur PDF-Stelle springen geht nur mit Projektdateien.`,
    noPdf: 'Noch kein PDF. Kompiliere das Projekt zuerst.',
    noSyncTeX: 'Keine SyncTeX-Daten zum PDF. Kompiliere das Projekt zuerst.',
    lineNotFound: (name: string, line: number) => `Zu Zeile ${line} von „${name}“ gibt es keine Stelle im PDF.`,
    pointNotFound: 'Zu dieser Stelle im PDF gibt es keine Zeile im Quelltext.',
    notProjectTex: (name: string) => `Die Stelle stammt aus „${name}“, keiner .tex-Datei des Projekts; sie wird nicht geöffnet.`,
    noProject: 'Kein Projekt offen.',
    failed: (detail: string) => `SyncTeX fehlgeschlagen: ${detail}`,
    followOn: 'PDF folgt dem Cursor.',
    followOff: 'PDF folgt dem Cursor nicht mehr.',
} as const;

export function createViewerSlot(): ViewerSlot {
    let current: SyncTeXViewerPort | null = null;
    return {
        get: () => current,
        set: (viewer) => {
            current = viewer;
        },
    };
}

/** Geste für die Rückwärtssuche wie Swift: ⌘-Klick auf macOS, Strg-Klick sonst; Alt/Umschalt bleiben frei */
export function isSyncTeXClick(input: ClickInput, isMac: boolean): boolean {
    if (input.button !== PRIMARY_BUTTON || input.altKey || input.shiftKey) return false;
    return isMac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
}

function nameOf(path: string): string {
    return path.split(PATH_SEPARATOR).at(-1) ?? path;
}

/** Wie eine Antwort des Mains, auch wenn der Aufruf selbst wirft */
async function ask<T>(request: () => Promise<IpcResult<T>>): Promise<IpcResult<T>> {
    try {
        return await request();
    } catch (error) {
        return fail(toIpcError(error));
    }
}

function info(deps: SyncTeXFlowDeps, mode: RevealMode, text: string): void {
    if (mode === 'explicit') deps.report({ text, kind: 'info' });
}

function finish<T extends string>(deps: SyncTeXFlowDeps, id: number, outcome: T): T {
    deps.synctex.getState().finishRequest(id, outcome);
    return outcome;
}

// ---------- Vorwärts ----------

interface CursorSource {
    readonly path: string;
    readonly name: string;
    readonly line: number;
}

function cursorSource(deps: SyncTeXFlowDeps, mode: RevealMode): CursorSource | ForwardOutcome {
    const session = deps.editor.getState().activeSession();
    if (session === null) {
        info(deps, mode, SYNCTEX_TEXTS.noFile);
        return 'noFile';
    }
    const name = session.file.name;
    if (relativeToProject(deps.project.getState().current?.root ?? null, session.path) === null) {
        info(deps, mode, SYNCTEX_TEXTS.notInProject(name));
        return 'notInProject';
    }
    const state = session.state;
    return { path: session.path, name, line: state.doc.lineAt(session.selection.head).number };
}

/** Vorbedingungen ohne Anfrage: Datei im Projekt, PDF da, im Folgemodus sichtbar */
function forwardPrecheck(deps: SyncTeXFlowDeps, mode: RevealMode): CursorSource | ForwardOutcome {
    const source = cursorSource(deps, mode);
    if (typeof source === 'string') return source;
    if (deps.pdf.getState().pageCount === 0 || deps.viewer() === null) {
        info(deps, mode, SYNCTEX_TEXTS.noPdf);
        return 'noPdf';
    }
    return mode === 'follow' && deps.viewMode.getState().mode === 'editor' ? 'pdfHidden' : source;
}

function showTarget(deps: SyncTeXFlowDeps, mode: RevealMode, target: SyncTeXTarget): ForwardOutcome {
    if (mode === 'explicit' && deps.viewMode.getState().mode === 'editor') deps.viewMode.getState().setMode('split');
    const result = deps.viewer()?.reveal(target, mode === 'follow') ?? 'unavailable';
    if (result === 'visible') return 'alreadyVisible';
    if (result === 'scrolled') return 'shown';
    info(deps, mode, SYNCTEX_TEXTS.noPdf);
    return 'noPdf';
}

async function forwardLookup(deps: SyncTeXFlowDeps, mode: RevealMode, source: CursorSource): Promise<ForwardOutcome> {
    const id = deps.synctex.getState().beginRequest('forward');
    const result = await ask(() => deps.api.synctex.forward(source.path, source.line));
    if (!deps.synctex.getState().isLatest(id)) return 'superseded';
    if (!result.ok) {
        if (mode === 'explicit') deps.report({ text: SYNCTEX_TEXTS.failed(result.error.message), kind: 'error' });
        return finish(deps, id, 'failed');
    }
    const rect = result.value === null ? null : unionRect(result.value.rects);
    if (result.value === null || rect === null) {
        const isReady = deps.synctex.getState().isReady;
        info(deps, mode, isReady ? SYNCTEX_TEXTS.lineNotFound(source.name, source.line) : SYNCTEX_TEXTS.noSyncTeX);
        return finish(deps, id, isReady ? 'notFound' : 'noSyncTeX');
    }
    return finish(deps, id, showTarget(deps, mode, { page: result.value.page, rect }));
}

/** Cursorzeile der aktiven Datei → Stelle im PDF */
export async function revealCursorInPdf(deps: SyncTeXFlowDeps, mode: RevealMode): Promise<ForwardOutcome> {
    const source = forwardPrecheck(deps, mode);
    if (typeof source === 'string') return source;
    return forwardLookup(deps, mode, source);
}

// ---------- Rückwärts ----------

function backwardMissing(deps: SyncTeXFlowDeps, id: number): BackwardOutcome {
    const isReady = deps.synctex.getState().isReady;
    deps.report({ text: isReady ? SYNCTEX_TEXTS.pointNotFound : SYNCTEX_TEXTS.noSyncTeX, kind: 'info' });
    return finish(deps, id, isReady ? 'notFound' : 'noSyncTeX');
}

async function openSource(deps: SyncTeXFlowDeps, id: number, root: string, file: string, line: number): Promise<BackwardOutcome> {
    if (relativeToProject(root, file) === null || !TEX_FILE.test(file)) {
        deps.report({ text: SYNCTEX_TEXTS.notProjectTex(nameOf(file)), kind: 'info' });
        return finish(deps, id, 'notProjectTex');
    }
    if (deps.viewMode.getState().mode === 'pdf') deps.viewMode.getState().setMode('split');
    await revealLine(deps.reveal(), file, line);
    return finish(deps, id, 'opened');
}

/** Stelle im PDF (Seite 1-basiert, Punkt in SyncTeX-Koordinaten) → Datei und Zeile im Editor */
export async function showPdfPointInEditor(deps: SyncTeXFlowDeps, page: number, point: PdfPoint): Promise<BackwardOutcome> {
    const root = deps.project.getState().current?.root ?? null;
    if (root === null) {
        deps.report({ text: SYNCTEX_TEXTS.noProject, kind: 'info' });
        return 'noProject';
    }
    const id = deps.synctex.getState().beginRequest('backward');
    const result = await ask(() => deps.api.synctex.backward(page, point.x, point.y));
    const isCurrent = deps.synctex.getState().isLatest(id) && deps.project.getState().current?.root === root;
    if (!isCurrent) return 'superseded';
    if (!result.ok) {
        deps.report({ text: SYNCTEX_TEXTS.failed(result.error.message), kind: 'error' });
        return finish(deps, id, 'failed');
    }
    if (result.value === null) return backwardMissing(deps, id);
    return openSource(deps, id, root, result.value.file, result.value.line);
}

// ---------- Verdrahtung ----------

/**
 * `synctex:ready` → bereit; Projektwechsel → zurücksetzen; Cursorbewegung → „PDF folgt Cursor“ (entprellt).
 * Gefragt wird auch ohne `ready` (z. B. nach einem Neuladen des Fensters); `ready` wählt nur die Meldung.
 */
export function connectSyncTeX(deps: SyncTeXConnectDeps): Unsubscribe {
    const stopReady = deps.onReady(({ pdfMtime }) => deps.store.getState().markReady(pdfMtime));
    const stopProject = deps.project.subscribe((state, previous) => {
        if (state.current?.root !== previous.current?.root) deps.store.getState().reset();
    });
    const follow = createDebounced(() => {
        if (deps.followsCursor()) void revealCursorInPdf(deps.flow(), 'follow');
    }, deps.delayMs ?? FOLLOW_CURSOR_DELAY_MS);
    const stopCursor = deps.onCursorActivity(() => {
        if (deps.followsCursor()) follow.call();
    });
    return () => {
        follow.cancel();
        stopReady();
        stopProject();
        stopCursor();
    };
}
