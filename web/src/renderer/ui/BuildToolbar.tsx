// Kompilieren-Leiste in der Kopfzeile des Editors (W2-12): Knopf „Kompilieren“ (Strg+B; während des Laufs
// „Abbrechen“), Statusanzeige mit Symbol und Text (nie nur Farbe) und ein Menü mit „Beim Speichern kompilieren“ und
// „Hilfsdateien löschen“ (mit Rückfrage). Der Zustand liegt im Build-Store; hier steht nur die Darstellung.
import { useId, useRef, useState } from 'react';
import { BUILD_STATUS_TEXTS, buildStatusOf } from '../app/buildStatusText';
import type { BuildStatusKind, BuildStatusView } from '../app/buildStatusText';
import { buildStore, useBuildStore } from '../app/buildRuntime';
import { useProjectStore } from '../stores/project';
import { sidebarStore } from '../stores/sidebar';
import { useSettingsStore } from '../stores/settings';
import { statusStore } from '../stores/status';
import { useDismiss } from './FileTypeMenu';
import './buildToolbar.css';

export const BUILD_TOOLBAR_TEXTS = {
    group: 'Kompilieren',
    compile: 'Kompilieren',
    compileTitle: 'Kompilieren (Strg+B)',
    cancel: 'Abbrechen',
    cancelTitle: 'Kompilieren abbrechen (Strg+.)',
    showIssues: 'Meldungen anzeigen',
    menu: 'Weitere Aktionen zum Kompilieren',
    compilesOnSave: 'Beim Speichern kompilieren',
    clean: 'Hilfsdateien löschen …',
    cleanQuestion: 'Hilfsdateien (.aux, .log, …) löschen? Das PDF bleibt erhalten, der nächste Lauf erzeugt sie neu.',
    cleanConfirm: 'Löschen',
    cleanDecline: 'Nicht löschen',
} as const;

const ICON_PATHS: Readonly<Record<BuildStatusKind, string>> = {
    noMainFile: 'M8 2.5v6 M8 11.5h.01',
    unavailable: 'M8 2l6.5 11.5h-13z M8 6.5v3 M8 11.5h.01',
    saving: 'M3 2.5h8l2 2v9h-10z M5.5 2.5v3h4v-3',
    queued: 'M8 3v5l3 2',
    running: 'M8 2.5a5.5 5.5 0 1 0 5.5 5.5',
    cancelling: 'M8 2.5a5.5 5.5 0 1 0 5.5 5.5',
    cleaning: 'M3 4.5h10 M6 4.5v-2h4v2 M4.5 4.5l.5 9h6l.5-9',
    startFailed: 'M8 2l6.5 11.5h-13z M8 6.5v3 M8 11.5h.01',
    idle: 'M4 8h8',
    success: 'M3 8.5l3.5 3.5 6.5-7.5',
    failed: 'M4.5 4.5l7 7 M11.5 4.5l-7 7',
    cancelled: 'M4.5 4.5h7v7h-7z',
};

const SPINNING_KINDS: ReadonlySet<BuildStatusKind> = new Set(['running', 'queued', 'saving', 'cancelling', 'cleaning']);

function StatusIcon({ kind }: { readonly kind: BuildStatusKind }) {
    const className = SPINNING_KINDS.has(kind) ? 'build-status-icon is-busy' : 'build-status-icon';
    return (
        <svg className={className} viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={ICON_PATHS[kind]} />
        </svg>
    );
}

function useBuildStatus(): BuildStatusView {
    const hasMainFile = useProjectStore((state) => (state.current?.mainFile ?? null) !== null);
    const state = useBuildStore((s) => s.status);
    const isSaving = useBuildStore((s) => s.isSaving);
    const isCleaning = useBuildStore((s) => s.isCleaning);
    const tools = useBuildStore((s) => s.tools);
    const startFailure = useBuildStore((s) => s.startFailure);
    const lastResult = useBuildStore((s) => s.lastResult);
    const counts = useBuildStore((s) => s.counts);
    return buildStatusOf({ hasMainFile, state, isSaving, isCleaning, tools, startFailure, lastResult, counts });
}

function CompileButton() {
    const hasMainFile = useProjectStore((state) => (state.current?.mainFile ?? null) !== null);
    const isBusy = useBuildStore((state) => state.status !== 'idle');
    if (isBusy) {
        return (
            <button type="button" aria-keyshortcuts="Control+Period" title={BUILD_TOOLBAR_TEXTS.cancelTitle} onClick={() => void buildStore.getState().cancel()}>
                {BUILD_TOOLBAR_TEXTS.cancel}
            </button>
        );
    }
    return (
        <button
            type="button"
            disabled={!hasMainFile}
            aria-keyshortcuts="Control+B"
            title={hasMainFile ? BUILD_TOOLBAR_TEXTS.compileTitle : BUILD_STATUS_TEXTS.noMainFileDetail}
            onClick={() => void buildStore.getState().compile()}
        >
            {BUILD_TOOLBAR_TEXTS.compile}
        </button>
    );
}

function BuildStatus() {
    const status = useBuildStatus();
    return (
        <div className="build-status" role="status" data-kind={status.kind} title={status.detail ?? status.text}>
            <StatusIcon kind={status.kind} />
            <button
                type="button"
                className="build-status-text"
                aria-label={`${status.text}. ${BUILD_TOOLBAR_TEXTS.showIssues}`}
                onClick={() => sidebarStore.getState().setTab('issues')}
            >
                {status.text}
            </button>
        </div>
    );
}

function CompilesOnSaveToggle() {
    const isOn = useSettingsStore((state) => state.values.compilesOnSave);
    const change = (value: boolean): void => {
        useSettingsStore.getState().set('compilesOnSave', value).catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            statusStore.getState().show({ text: `Einstellung nicht gespeichert: ${detail}`, kind: 'error' });
        });
    };
    return (
        <label className="build-menu-item">
            <input type="checkbox" checked={isOn} onChange={(event) => change(event.target.checked)} />
            <span>{BUILD_TOOLBAR_TEXTS.compilesOnSave}</span>
        </label>
    );
}

function CleanConfirm({ onDone }: { readonly onDone: () => void }) {
    const confirm = (): void => {
        onDone();
        void buildStore.getState().clean();
    };
    return (
        <div className="build-menu-confirm" role="alertdialog" aria-label={BUILD_TOOLBAR_TEXTS.clean}>
            <p>{BUILD_TOOLBAR_TEXTS.cleanQuestion}</p>
            <div className="build-menu-buttons">
                <button type="button" onClick={confirm}>{BUILD_TOOLBAR_TEXTS.cleanConfirm}</button>
                <button type="button" onClick={onDone}>{BUILD_TOOLBAR_TEXTS.cleanDecline}</button>
            </div>
        </div>
    );
}

function BuildMenuBody({ onClose }: { readonly onClose: () => void }) {
    const [isAsking, setIsAsking] = useState(false);
    if (isAsking) return <CleanConfirm onDone={onClose} />;
    return (
        <div className="build-menu-popover" role="group" aria-label={BUILD_TOOLBAR_TEXTS.menu}>
            <CompilesOnSaveToggle />
            <button type="button" onClick={() => setIsAsking(true)}>{BUILD_TOOLBAR_TEXTS.clean}</button>
        </div>
    );
}

function BuildMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverId = useId();
    const hasMainFile = useProjectStore((state) => (state.current?.mainFile ?? null) !== null);
    const isBusy = useBuildStore((state) => state.status !== 'idle');
    useDismiss(rootRef, isOpen, () => setIsOpen(false));
    return (
        <div ref={rootRef} className="build-menu">
            <button
                type="button"
                className="build-menu-button"
                aria-label={BUILD_TOOLBAR_TEXTS.menu}
                aria-expanded={isOpen}
                aria-controls={isOpen ? popoverId : undefined}
                disabled={!hasMainFile || isBusy}
                onClick={() => setIsOpen((open) => !open)}
            >
                <span aria-hidden="true">⋯</span>
            </button>
            {isOpen && (
                <div id={popoverId}>
                    <BuildMenuBody onClose={() => setIsOpen(false)} />
                </div>
            )}
        </div>
    );
}

export function BuildToolbar() {
    return (
        <div className="build-toolbar" role="toolbar" aria-label={BUILD_TOOLBAR_TEXTS.group}>
            <CompileButton />
            <BuildStatus />
            <BuildMenu />
        </div>
    );
}
