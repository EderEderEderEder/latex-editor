// PDF-Ansicht (W3-3): Zoom-Leiste (Minus, Plus, Breite, Seite, Prozentwert), Seitenwechsel mit „Seite x / n“ und der
// pdf.js-Viewer. Der Zustand liegt im PDF-Store; hier stehen nur die Darstellung und das Ein- und Aushängen des Viewers.
// Die Ansicht ist immer eingehängt und trägt deshalb auch die SyncTeX-Verdrahtung (W3-5, `app/synctexFlow.ts`).
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { connectAppSyncTeX, showPdfPointInEditorFromApp, syncTeXViewerSlot } from '../app/commandsRuntime';
import { createPdfViewer } from '../pdf/viewer';
import { pdfStore, usePdfStore } from '../stores/pdf';
import type { PdfZoom } from '../stores/pdf';
import './pdfPane.css';

export const PDF_PANE_TEXTS = {
    region: 'PDF',
    toolbar: 'PDF-Ansicht',
    zoomOut: 'Verkleinern',
    zoomIn: 'Vergrößern',
    fitWidth: 'Breite anpassen',
    fitPage: 'Seite anpassen',
    previousPage: 'Vorherige Seite',
    nextPage: 'Nächste Seite',
    zoomLabel: 'Zoom',
    pageLabel: 'Seitenanzeige',
    page: (pageNumber: number, pageCount: number) => `Seite ${pageNumber} / ${pageCount}`,
    noPage: 'Seite – / –',
    empty: 'Kein PDF. Nach dem Kompilieren erscheint es hier.',
    loading: 'PDF wird geladen …',
} as const;

const PERCENT = 100;

function percentText(scale: number): string {
    return `${Math.round(scale * PERCENT)} %`;
}

function ZoomButton({ label, symbol, zoom, isActive, disabled }: {
    readonly label: string;
    readonly symbol: string;
    readonly zoom: Exclude<PdfZoom, number>;
    readonly isActive: boolean;
    readonly disabled: boolean;
}) {
    return (
        <button type="button" aria-label={label} title={label} aria-pressed={isActive} disabled={disabled}
            onClick={() => pdfStore.getState().setZoom(zoom)}>
            {symbol}
        </button>
    );
}

function ZoomControls({ disabled }: { readonly disabled: boolean }) {
    const zoom = usePdfStore((state) => state.zoom);
    const scale = usePdfStore((state) => state.scale);
    return (
        <div className="pdf-toolbar-group">
            <button type="button" aria-label={PDF_PANE_TEXTS.zoomOut} title={PDF_PANE_TEXTS.zoomOut} disabled={disabled}
                onClick={() => pdfStore.getState().zoomStep('out')}>−</button>
            <span className="pdf-zoom-value" aria-label={PDF_PANE_TEXTS.zoomLabel}>{percentText(scale)}</span>
            <button type="button" aria-label={PDF_PANE_TEXTS.zoomIn} title={PDF_PANE_TEXTS.zoomIn} disabled={disabled}
                onClick={() => pdfStore.getState().zoomStep('in')}>+</button>
            <ZoomButton label={PDF_PANE_TEXTS.fitWidth} symbol="↔" zoom="pageWidth" isActive={zoom === 'pageWidth'} disabled={disabled} />
            <ZoomButton label={PDF_PANE_TEXTS.fitPage} symbol="↕" zoom="pageFit" isActive={zoom === 'pageFit'} disabled={disabled} />
        </div>
    );
}

function PageControls() {
    const pageNumber = usePdfStore((state) => state.pageNumber);
    const pageCount = usePdfStore((state) => state.pageCount);
    const go = (target: number): void => pdfStore.getState().goToPage(target);
    return (
        <div className="pdf-toolbar-group">
            <button type="button" aria-label={PDF_PANE_TEXTS.previousPage} title={PDF_PANE_TEXTS.previousPage}
                disabled={pageCount === 0 || pageNumber <= 1} onClick={() => go(pageNumber - 1)}>‹</button>
            <span className="pdf-page-indicator" aria-label={PDF_PANE_TEXTS.pageLabel}>
                {pageCount === 0 ? PDF_PANE_TEXTS.noPage : PDF_PANE_TEXTS.page(pageNumber, pageCount)}
            </span>
            <button type="button" aria-label={PDF_PANE_TEXTS.nextPage} title={PDF_PANE_TEXTS.nextPage}
                disabled={pageCount === 0 || pageNumber >= pageCount} onClick={() => go(pageNumber + 1)}>›</button>
        </div>
    );
}

interface PdfViewerRefs {
    readonly containerRef: RefObject<HTMLDivElement | null>;
    readonly viewerRef: RefObject<HTMLDivElement | null>;
}

/** Hängt den pdf.js-Viewer beim Einhängen an den Store und gibt ihn beim Aushängen frei */
function usePdfViewer(): PdfViewerRefs {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const container = containerRef.current;
        const viewerElement = viewerRef.current;
        if (container === null || viewerElement === null) return;
        const viewer = createPdfViewer(
            { container, viewer: viewerElement },
            (report) => pdfStore.getState().noteView(report),
            showPdfPointInEditorFromApp,
        );
        pdfStore.getState().attachViewer(viewer);
        syncTeXViewerSlot.set(viewer);
        const disconnectSyncTeX = connectAppSyncTeX();
        return () => {
            disconnectSyncTeX();
            syncTeXViewerSlot.set(null);
            pdfStore.getState().attachViewer(null);
            viewer.destroy();
        };
    }, []);
    return { containerRef, viewerRef };
}

function EmptyHint() {
    const pageCount = usePdfStore((state) => state.pageCount);
    const isLoading = usePdfStore((state) => state.isLoading);
    if (pageCount > 0) return null;
    // Kein `<p>`: Der Stub-Smoke-Test sucht das einzige `main p` (Verbindungsprüfung).
    return <div className="pdf-empty">{isLoading ? PDF_PANE_TEXTS.loading : PDF_PANE_TEXTS.empty}</div>;
}

export function PDFPane() {
    const { containerRef, viewerRef } = usePdfViewer();
    const hasDocument = usePdfStore((state) => state.pageCount > 0);
    const isLoading = usePdfStore((state) => state.isLoading);
    return (
        <section className="pdf-pane" aria-label={PDF_PANE_TEXTS.region} aria-busy={isLoading}>
            <div className="pdf-toolbar" role="toolbar" aria-label={PDF_PANE_TEXTS.toolbar}>
                <ZoomControls disabled={!hasDocument} />
                <PageControls />
            </div>
            <div className="pdf-viewport">
                <div className="pdf-container" ref={containerRef} tabIndex={-1}>
                    <div className="pdfViewer" ref={viewerRef} />
                </div>
                <EmptyHint />
            </div>
        </section>
    );
}
