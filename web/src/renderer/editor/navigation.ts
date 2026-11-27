// Strg-Klick im Text (W4-13, Vorlage: ⌘-Klick in `LatexTextView.swift`; macOS ⌘): Mit gedrückter Taste zeigt der
// Zeiger über einem Ziel (`\ref`, `\cite`, `\input` …, Abkürzung) „pointer“ und das Ziel ist unterstrichen; der Klick
// öffnet es. Ein Klick auf Text ohne Ziel setzt den Cursor und zeigt die Stelle im PDF (wie Strg+J). Normale Klicks,
// Textauswahl, Umschalt/Alt-Klicks und die Eingabe per IME bleiben unberührt. Was „öffnen“ heißt, kennt der Editor nicht:
// `app/referenceCheckRuntime.ts` meldet die Abläufe über `connectNavigation` an (so importiert diese Datei keine Stores,
// sonst entstünde ein Importkreis über `session.ts`).
import { StateEffect, StateField, Transaction } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import { jumpTargetInLine, type JumpHit, type JumpTarget } from '../../shared/core/jumpTargets';
import type { FeatureContext } from './extensions';

/** Was ein Klick auslöst (die App meldet es an) */
export interface NavigationActions {
    /** Ziel öffnen; `fromPath` ist die Datei, in der geklickt wurde */
    follow(target: JumpTarget, fromPath: string): void;
    /** Klick auf Text ohne Ziel: Cursorstelle im PDF zeigen (Cursor ist schon gesetzt) */
    showInPdf(): void;
}

let actions: NavigationActions | null = null;

export function connectNavigation(next: NavigationActions | null): void {
    actions = next;
}

/** Tasten und Knopf eines Mausereignisses (ohne DOM-Typ) */
export interface ModifierInput {
    readonly button?: number;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
}

const PRIMARY_BUTTON = 0;
const IS_MAC = /Mac/i.test((globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? '');

/** Nur die Sprungtaste (macOS ⌘, sonst Strg), keine weitere: Alt, Umschalt und die jeweils andere bleiben frei */
export function isJumpModifier(input: ModifierInput, isMac: boolean = IS_MAC): boolean {
    if (input.altKey || input.shiftKey) return false;
    return isMac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
}

export function isJumpClick(input: ModifierInput, isMac: boolean = IS_MAC): boolean {
    return (input.button ?? PRIMARY_BUTTON) === PRIMARY_BUTTON && isJumpModifier(input, isMac);
}

// ---------- Unterstreichung des Ziels ----------

const HOVER_CLASS = 'cm-jump-target';
const setJumpHover = StateEffect.define<{ readonly from: number; readonly to: number } | null>();

const jumpHoverField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (!effect.is(setJumpHover)) continue;
            const range = effect.value;
            if (range === null || range.to <= range.from || range.to > tr.newDoc.length) return Decoration.none;
            return Decoration.set([Decoration.mark({ class: HOVER_CLASS }).range(range.from, range.to)]);
        }
        return tr.docChanged ? Decoration.none : value;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/** Aktuell unterstrichenes Ziel (für Tests) */
export function jumpHoverOf(state: EditorState): { from: number; to: number } | null {
    const value = state.field(jumpHoverField, false);
    if (value === undefined) return null;
    const cursor = value.iter();
    return cursor.value === null ? null : { from: cursor.from, to: cursor.to };
}

// ---------- Treffer an einer Stelle ----------

/** Ziel an der Dokumentposition (nur die Zeile wird untersucht); Bereich in Dokumentpositionen */
export function jumpHitAt(state: EditorState, position: number): JumpHit | null {
    const line = state.doc.lineAt(position);
    const hit = jumpTargetInLine(line.text, position - line.from);
    return hit === null ? null : { target: hit.target, start: hit.start + line.from, end: hit.end + line.from };
}

interface Point {
    readonly x: number;
    readonly y: number;
}

/** Ziel unter dem Zeiger, `null` außerhalb des sichtbaren Textes oder ohne Ziel */
function preciseHit(view: EditorView, point: Point): JumpHit | null {
    const position = view.posAtCoords(point);
    return position === null ? null : jumpHitAt(view.state, position);
}

// ---------- Hover (Zeiger und Unterstreichung) ----------

class NavigationPlugin {
    private lastPoint: Point | null = null;
    private shown: { from: number; to: number } | null = null;
    private destroyed = false;
    private readonly ownerDocument: EditorView['dom']['ownerDocument'];

    constructor(private readonly view: EditorView) {
        this.ownerDocument = view.dom.ownerDocument;
        view.contentDOM.addEventListener('mousemove', this.onMouseMove);
        view.contentDOM.addEventListener('mouseleave', this.onMouseLeave);
        this.ownerDocument.addEventListener('keydown', this.onKey);
        this.ownerDocument.addEventListener('keyup', this.onKey);
        this.ownerDocument.defaultView?.addEventListener('blur', this.onMouseLeave);
    }

    destroy(): void {
        this.destroyed = true;
        this.view.contentDOM.removeEventListener('mousemove', this.onMouseMove);
        this.view.contentDOM.removeEventListener('mouseleave', this.onMouseLeave);
        this.ownerDocument.removeEventListener('keydown', this.onKey);
        this.ownerDocument.removeEventListener('keyup', this.onKey);
        this.ownerDocument.defaultView?.removeEventListener('blur', this.onMouseLeave);
    }

    private readonly onMouseMove = (event: MouseEvent): void => {
        this.lastPoint = { x: event.clientX, y: event.clientY };
        this.refresh(isJumpModifier(event));
    };

    private readonly onMouseLeave = (): void => {
        this.lastPoint = null;
        this.show(null);
    };

    /** Die Taste wird gedrückt oder losgelassen, während die Maus ruht */
    private readonly onKey = (event: KeyboardEvent): void => {
        this.refresh(isJumpModifier(event));
    };

    private refresh(isModifierDown: boolean): void {
        const hit = isModifierDown && this.lastPoint !== null && !this.view.composing ? preciseHit(this.view, this.lastPoint) : null;
        this.show(hit === null ? null : { from: hit.start, to: hit.end });
    }

    private show(range: { from: number; to: number } | null): void {
        if (this.destroyed || (this.shown?.from === range?.from && this.shown?.to === range?.to)) return;
        this.shown = range;
        if (this.view.state.field(jumpHoverField, false) === undefined) return;
        this.view.dispatch({ effects: setJumpHover.of(range), annotations: Transaction.addToHistory.of(false) });
    }
}

// ---------- Klick ----------

/** `true`, wenn der Klick behandelt ist (CodeMirror setzt dann keine Auswahl und kein weiteres Mehrfach-Cursor-Verhalten) */
function handleClick(event: MouseEvent, view: EditorView, path: string): boolean {
    if (actions === null || view.composing || !isJumpClick(event)) return false;
    const point = { x: event.clientX, y: event.clientY };
    const hit = preciseHit(view, point);
    event.preventDefault();
    if (hit !== null) {
        actions.follow(hit.target, path);
        return true;
    }
    const position = view.posAtCoords(point);
    if (position === null) return true;
    view.dispatch({ selection: { anchor: position }, userEvent: 'select.pointer' });
    view.focus();
    actions.showInPdf();
    return true;
}

const navigationBaseTheme = EditorView.baseTheme({
    [`.${HOVER_CLASS}`]: { cursor: 'pointer', textDecoration: 'underline' },
});

/** Strg-Klick für eine Sitzung; BibTeX-Dateien haben keine Ziele, ein Klick dort zeigt nur im PDF nichts an */
export function navigationExtension(context: FeatureContext): Extension {
    if (languageFromPath(context.name ?? context.path) !== 'latex') return [];
    return [
        jumpHoverField,
        navigationBaseTheme,
        ViewPlugin.define((view) => new NavigationPlugin(view)),
        EditorView.domEventHandlers({ mousedown: (event, view) => handleClick(event, view, context.path) }),
    ];
}
