// Arbeitsbereich (W3-4): Editor | Geteilt | PDF mit 14-px-Teiler. Editor und PDF bleiben in jedem Modus eingehängt und
// werden nur ausgeblendet; so bleiben Seite, Zoom, Scrollposition, Auswahl, Undo-Verlauf und Fokus beim Wechsel erhalten.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject } from 'react';
import {
    EDITOR_MIN_WIDTH, PDF_MIN_WIDTH, VIEW_MODES, computeLayout, editorWidthAfterKey, fractionForEditorWidth,
} from '../app/viewModeLogic';
import type { PaneBox, ViewMode, WorkspaceLayout } from '../app/viewModeLogic';
import { pdfStore } from '../stores/pdf';
import { useViewModeStore, viewModeStore } from '../stores/viewMode';
import './workspaceSplit.css';

export const WORKSPACE_TEXTS = {
    modeGroup: 'Ansicht',
    handle: 'Teiler zwischen Editor und PDF',
    modes: { editor: 'Editor', split: 'Geteilt', pdf: 'PDF' },
} as const satisfies { readonly modeGroup: string; readonly handle: string; readonly modes: Readonly<Record<ViewMode, string>> };

function boxStyle(box: PaneBox): CSSProperties {
    return { left: box.left, width: box.width };
}

function paneClass(base: string, box: PaneBox): string {
    return box.isShown ? base : `${base} is-hidden`;
}

export function ViewModeSwitch() {
    const mode = useViewModeStore((state) => state.mode);
    return (
        <div className="workspace-mode-switch" role="group" aria-label={WORKSPACE_TEXTS.modeGroup}>
            {VIEW_MODES.map((entry) => (
                <button key={entry} type="button" aria-pressed={mode === entry} onClick={() => viewModeStore.getState().setMode(entry)}>
                    {WORKSPACE_TEXTS.modes[entry]}
                </button>
            ))}
        </div>
    );
}

interface DragStart {
    readonly pointerX: number;
    readonly editorWidth: number;
}

function SplitHandle({ layout }: { readonly layout: WorkspaceLayout }) {
    const drag = useRef<DragStart | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const { splitEditorWidth, available } = layout;
    const moveTo = (editorWidth: number): void => viewModeStore.getState().setFraction(fractionForEditorWidth(editorWidth, available));
    const endDrag = (): void => {
        drag.current = null;
        setIsDragging(false);
    };
    const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerX: event.clientX, editorWidth: splitEditorWidth };
        setIsDragging(true);
    };
    // Ein Klick auf den leeren Teiler würde sonst die DOM-Auswahl an die nächste Textstelle setzen, und der Editor übernähme sie als Cursor.
    const onMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.currentTarget.focus();
    };
    const onPointerMove = (event: PointerEvent): void => {
        if (drag.current !== null) moveTo(drag.current.editorWidth + event.clientX - drag.current.pointerX);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        const next = editorWidthAfterKey(event.key, splitEditorWidth, available, event.shiftKey);
        if (next === null) return;
        event.preventDefault();
        moveTo(next);
    };
    return (
        <div
            className={`${paneClass('workspace-handle', layout.handle)}${isDragging ? ' is-dragging' : ''}`}
            style={boxStyle(layout.handle)}
            role="separator"
            aria-orientation="vertical"
            aria-label={WORKSPACE_TEXTS.handle}
            aria-valuemin={EDITOR_MIN_WIDTH}
            aria-valuemax={Math.max(available - PDF_MIN_WIDTH, EDITOR_MIN_WIDTH)}
            aria-valuenow={splitEditorWidth}
            tabIndex={layout.handle.isShown ? 0 : -1}
            onMouseDown={onMouseDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => viewModeStore.getState().resetFraction()}
            onKeyDown={onKeyDown}
        />
    );
}

/** Breite des Bereichs; ändert sich nur durch Fenster und Seitenleiste, nie durch den Inhalt (keine Rückkopplung) */
function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const element = ref.current;
        if (element === null) return undefined;
        setWidth(Math.round(element.getBoundingClientRect().width));
        const observer = new ResizeObserver(() => setWidth(Math.round(element.getBoundingClientRect().width)));
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return width;
}

/** pdf.js passt „Breite/Seite anpassen“ nur beim Setzen des Zoomwerts an; nach einer neuen Breite also erneut setzen */
function useRefitPdf(pdfBox: PaneBox): void {
    const { width, isShown } = pdfBox;
    useEffect(() => {
        if (!isShown || width <= 0) return undefined;
        const frame = requestAnimationFrame(() => {
            const zoom = pdfStore.getState().zoom;
            if (typeof zoom === 'string') pdfStore.getState().setZoom(zoom);
        });
        return () => cancelAnimationFrame(frame);
    }, [width, isShown]);
}

export interface WorkspaceSplitProps {
    readonly editor: ReactNode;
    readonly pdf: ReactNode;
}

export function WorkspaceSplit({ editor, pdf }: WorkspaceSplitProps) {
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const mode = useViewModeStore((state) => state.mode);
    const fraction = useViewModeStore((state) => state.fraction);
    const total = useMeasuredWidth(bodyRef);
    const layout = computeLayout(mode, total, fraction);
    useRefitPdf(layout.pdf);
    return (
        <div className="workspace">
            <div className="workspace-modebar">
                <ViewModeSwitch />
            </div>
            <div className="workspace-body" ref={bodyRef}>
                <div className={paneClass('workspace-pane', layout.editor)} style={boxStyle(layout.editor)}>{editor}</div>
                <SplitHandle layout={layout} />
                <div className={paneClass('workspace-pane', layout.pdf)} style={boxStyle(layout.pdf)}>{pdf}</div>
            </div>
        </div>
    );
}
