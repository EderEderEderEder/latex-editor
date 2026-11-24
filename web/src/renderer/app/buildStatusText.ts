// Statusanzeige des Builds (reine Funktion): Art (für das Symbol), Text und ein erklärender Zusatz (Tooltip).
import type { BuildState, ToolsInfo } from '../../shared/contract';
import type { IssueCounts } from './issueNavigation';

export type BuildStatusKind =
    | 'noMainFile'
    | 'unavailable'
    | 'saving'
    | 'queued'
    | 'running'
    | 'cancelling'
    | 'cleaning'
    | 'startFailed'
    | 'idle'
    | 'success'
    | 'failed'
    | 'cancelled';

export interface BuildStatusInput {
    readonly hasMainFile: boolean;
    readonly state: BuildState;
    readonly isSaving: boolean;
    readonly isCleaning: boolean;
    readonly tools: ToolsInfo | null;
    readonly startFailure: string | null;
    /** Ergebnis des letzten Laufs; `null`, solange noch nicht kompiliert wurde */
    readonly lastResult: { readonly ok: boolean; readonly cancelled: boolean; readonly durationMs: number } | null;
    readonly counts: IssueCounts;
}

export interface BuildStatusView {
    readonly kind: BuildStatusKind;
    readonly text: string;
    /** Erklärung für den Tooltip; `null`, wenn der Text genügt */
    readonly detail: string | null;
}

export const BUILD_STATUS_TEXTS = {
    noMainFile: 'Keine Hauptdatei',
    noMainFileDetail: 'Kompilieren braucht ein geöffnetes Projekt mit einer Hauptdatei.',
    unavailable: 'latexmk nicht gefunden',
    installHint: 'Bitte TeX Live oder MiKTeX installieren und die App neu starten.',
    saving: 'Speichert …',
    queued: 'Kompiliert … (nächster Lauf vorgemerkt)',
    running: 'Kompiliert …',
    cancelling: 'Wird abgebrochen …',
    cleaning: 'Löscht Hilfsdateien …',
    startFailed: 'Nicht gestartet',
    idle: 'Bereit',
    idleDetail: 'Seit dem Öffnen wurde nicht kompiliert, das PDF kann veraltet sein.',
    failed: 'Fehler',
    cancelled: 'Abgebrochen',
    cancelledDetail: 'Meldungen und PDF stammen vom Lauf davor.',
    done: (duration: string) => `Fertig in ${duration}`,
    errors: (count: number) => (count === 1 ? '1 Fehler' : `${count} Fehler`),
    warnings: (count: number) => (count === 1 ? '1 Warnung' : `${count} Warnungen`),
} as const;

const MS_PER_SECOND = 1000;

/** „3,2 s“ mit deutschem Komma */
export function formatDuration(durationMs: number): string {
    const seconds = Math.max(durationMs, 0) / MS_PER_SECOND;
    return `${seconds.toFixed(1).replace('.', ',')} s`;
}

const LATEXMK_MISSING_MESSAGE = (tools: ToolsInfo): string =>
    tools.problems.find((problem) => problem.tool === 'latexmk')?.message ?? BUILD_STATUS_TEXTS.installHint;

function busyStatus(input: BuildStatusInput): BuildStatusView | null {
    const { state } = input;
    if (state === 'cancelling') return { kind: 'cancelling', text: BUILD_STATUS_TEXTS.cancelling, detail: null };
    if (input.isCleaning) return { kind: 'cleaning', text: BUILD_STATUS_TEXTS.cleaning, detail: null };
    if (input.isSaving) return { kind: 'saving', text: BUILD_STATUS_TEXTS.saving, detail: null };
    if (state === 'queued') return { kind: 'queued', text: BUILD_STATUS_TEXTS.queued, detail: null };
    if (state === 'running') return { kind: 'running', text: BUILD_STATUS_TEXTS.running, detail: null };
    return null;
}

function resultStatus(input: BuildStatusInput): BuildStatusView {
    const { lastResult, counts } = input;
    if (lastResult === null) return { kind: 'idle', text: BUILD_STATUS_TEXTS.idle, detail: BUILD_STATUS_TEXTS.idleDetail };
    if (lastResult.cancelled) {
        return { kind: 'cancelled', text: BUILD_STATUS_TEXTS.cancelled, detail: BUILD_STATUS_TEXTS.cancelledDetail };
    }
    if (!lastResult.ok) {
        const text = counts.error === 0 ? BUILD_STATUS_TEXTS.failed : BUILD_STATUS_TEXTS.errors(counts.error);
        return { kind: 'failed', text, detail: null };
    }
    const done = BUILD_STATUS_TEXTS.done(formatDuration(lastResult.durationMs));
    const text = counts.warning === 0 ? done : `${done} · ${BUILD_STATUS_TEXTS.warnings(counts.warning)}`;
    return { kind: 'success', text, detail: null };
}

export function buildStatusOf(input: BuildStatusInput): BuildStatusView {
    const busy = busyStatus(input);
    if (busy !== null) return busy;
    if (!input.hasMainFile) {
        return { kind: 'noMainFile', text: BUILD_STATUS_TEXTS.noMainFile, detail: BUILD_STATUS_TEXTS.noMainFileDetail };
    }
    if (input.tools !== null && input.tools.latexmk === null) {
        return { kind: 'unavailable', text: BUILD_STATUS_TEXTS.unavailable, detail: LATEXMK_MISSING_MESSAGE(input.tools) };
    }
    if (input.startFailure !== null) {
        return { kind: 'startFailed', text: BUILD_STATUS_TEXTS.startFailed, detail: input.startFailure };
    }
    return resultStatus(input);
}
