// Reine Rechnung für den Arbeitsbereich (Vorlage Swift `WorkspaceSplit`): Ansichtsmodi, Mindestbreiten, Teilerposition
// als Anteil und die Aufteilung der Breite. Ohne DOM, damit testbar.

export type ViewMode = 'editor' | 'split' | 'pdf';

export const VIEW_MODES: readonly ViewMode[] = ['editor', 'split', 'pdf'];
export const DEFAULT_VIEW_MODE: ViewMode = 'split';
/** Anteil des Editors beim Öffnen und nach Doppelklick auf den Teiler */
export const DEFAULT_SPLIT_FRACTION = 0.5;
export const SPLIT_HANDLE_WIDTH = 14;
export const EDITOR_MIN_WIDTH = 180;
export const PDF_MIN_WIDTH = 150;
export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;

export interface PaneBox {
    readonly left: number;
    readonly width: number;
    readonly isShown: boolean;
}

export interface WorkspaceLayout {
    readonly editor: PaneBox;
    readonly handle: PaneBox;
    readonly pdf: PaneBox;
    /** Breite des Editors im geteilten Modus (Wert des Teilers) */
    readonly splitEditorWidth: number;
    /** Breite, die sich zwischen Editor und PDF aufteilt (ohne Teiler) */
    readonly available: number;
}

export function isViewMode(value: unknown): value is ViewMode {
    return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value);
}

export function clampFraction(fraction: number): number {
    if (!Number.isFinite(fraction)) return DEFAULT_SPLIT_FRACTION;
    return Math.min(Math.max(fraction, 0), 1);
}

/** Breite des Editors: beide Seiten behalten ihre Mindestbreite, solange der Platz reicht (sonst halbe-halbe) */
export function editorWidthFor(fraction: number, available: number): number {
    if (available <= EDITOR_MIN_WIDTH + PDF_MIN_WIDTH) return Math.round(available / 2);
    const wanted = clampFraction(fraction) * available;
    return Math.round(Math.min(Math.max(wanted, EDITOR_MIN_WIDTH), available - PDF_MIN_WIDTH));
}

export function fractionForEditorWidth(editorWidth: number, available: number): number {
    if (available <= 0) return DEFAULT_SPLIT_FRACTION;
    return clampFraction(editorWidth / available);
}

/** Neue Editorbreite nach einer Taste (Pfeile, Pos1, Ende); `null` für andere Tasten */
export function editorWidthAfterKey(key: string, editorWidth: number, available: number, isLarge: boolean): number | null {
    const step = isLarge ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
    switch (key) {
        case 'ArrowLeft': return editorWidth - step;
        case 'ArrowRight': return editorWidth + step;
        case 'Home': return EDITOR_MIN_WIDTH;
        case 'End': return available - PDF_MIN_WIDTH;
        default: return null;
    }
}

/**
 * Aufteilung für einen Modus. Beide Seiten bleiben immer im Baum: Die nicht gezeigte behält ihre Breite aus dem
 * geteilten Modus (Editor) bzw. liegt rechts außerhalb (PDF), damit keine Seite bei null Breite neu berechnet wird.
 */
export function computeLayout(mode: ViewMode, total: number, fraction: number): WorkspaceLayout {
    const width = Math.max(total, 0);
    const available = Math.max(width - SPLIT_HANDLE_WIDTH, 0);
    const lead = editorWidthFor(fraction, available);
    const trail = Math.max(available - lead, 0);
    const handleLeft = lead;
    const common = { splitEditorWidth: lead, available };
    if (mode === 'split') {
        return {
            ...common,
            editor: { left: 0, width: lead, isShown: true },
            handle: { left: handleLeft, width: SPLIT_HANDLE_WIDTH, isShown: true },
            pdf: { left: lead + SPLIT_HANDLE_WIDTH, width: trail, isShown: true },
        };
    }
    const handle = { left: handleLeft, width: SPLIT_HANDLE_WIDTH, isShown: false };
    if (mode === 'editor') {
        return { ...common, editor: { left: 0, width, isShown: true }, handle, pdf: { left: width, width: trail, isShown: false } };
    }
    return { ...common, editor: { left: 0, width: lead, isShown: false }, handle, pdf: { left: 0, width, isShown: true } };
}
