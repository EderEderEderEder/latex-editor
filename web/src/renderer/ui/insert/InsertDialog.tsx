// Einfügen-Fenster (W4-10, Vorlage `InsertSheet`): ein modaler `<dialog>` im Renderer in drei Spalten (Bausteine,
// Einstellungen, Vorschau an Ort und Stelle) und einer Fußzeile (Hinweis, Abbrechen, Einfügen). Der native Dialog
// sperrt den Rest der Seite (Fokusfalle), Escape bricht ab, Enter in einem Eingabefeld fügt ein. Farben nur aus
// `--chrome-*` und den Editorfarben, damit Hell und Dunkel stimmen.
import { useMemo } from 'react';
import type { FormEvent } from 'react';
import { closeInsertDialog, performInsert } from '../../app/insertActions';
import type { InsertDeps } from '../../app/insertDeps';
import { KIND_SUMMARIES, KIND_TITLES } from '../../app/insertKinds';
import type { InsertionKind } from '../../app/insertKinds';
import { blockerOf, destinationOf, insertButtonTitle } from '../../app/insertLogic';
import type { GenerateInput } from '../../app/insertLogic';
import { insertDeps, todayText } from '../../app/insertRuntime';
import { useInsertStore } from '../../stores/insert';
import { cancelHandler, useModalDialog } from '../dialogs/useModalDialog';
import { ImagePanel } from './ImagePanel';
import { KindList } from './KindList';
import { PreviewPane } from './PreviewPane';
import { CitationPanel, ReferencePanel } from './ReferencePanels';
import { SourcePanel } from './SourcePanel';
import { TablePanel } from './TablePanel';
import { CodePanel, EquationPanel, ListPanel } from './TextPanels';
import '../dialogs/dialogs.css';
import './insertDialog.css';

export const INSERT_DIALOG_TEXTS = {
    title: 'Einfügen',
    cancel: 'Abbrechen',
    settings: 'Einstellungen',
} as const;

const TITLE_ID = 'insert-dialog-title';
const STATUS_ID = 'insert-dialog-status';

export interface InsertDialogProps {
    /** Gibt den Fokus nach dem Schließen an den Editor zurück */
    readonly focusEditor: () => void;
}

function Panel({ kind }: { readonly kind: InsertionKind }) {
    switch (kind) {
        case 'table': return <TablePanel />;
        case 'image': return <ImagePanel />;
        case 'code': return <CodePanel />;
        case 'equation': return <EquationPanel />;
        case 'list': return <ListPanel />;
        case 'reference': return <ReferencePanel />;
        case 'citation': return <CitationPanel />;
        case 'source': return <SourcePanel />;
    }
}

interface FooterProps {
    readonly error: string | null;
    readonly blocker: string | null;
    readonly destination: string;
    readonly kind: InsertionKind;
    readonly isBusy: boolean;
    readonly onCancel: () => void;
}

function Footer({ error, blocker, destination, kind, isBusy, onCancel }: FooterProps) {
    const message = error ?? blocker ?? destination;
    return (
        <footer className="insert-footer">
            <p id={STATUS_ID} className={error === null ? 'insert-footer-text' : 'insert-footer-text is-error'} role={error === null ? 'status' : 'alert'}>
                {message}
            </p>
            <button type="button" onClick={onCancel}>{INSERT_DIALOG_TEXTS.cancel}</button>
            <button type="submit" className="is-default" disabled={blocker !== null || isBusy} aria-describedby={STATUS_ID}>
                {insertButtonTitle(kind)}
            </button>
        </footer>
    );
}

function InsertDialogBody({ focusEditor }: InsertDialogProps) {
    const dialogRef = useModalDialog();
    const deps = useMemo((): InsertDeps => insertDeps(focusEditor), [focusEditor]);
    const state = useInsertStore((current) => current);
    const input: GenerateInput = { kind: state.kind, settings: state, catalog: state.catalog, today: todayText() };
    const blocker = blockerOf(input, state.canInsertIntoEditor);
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (blocker === null && !state.isBusy) void performInsert(deps);
    };
    const cancel = (): void => closeInsertDialog(deps);
    return (
        <dialog ref={dialogRef} className="close-confirm insert-dialog" aria-labelledby={TITLE_ID} onCancel={cancelHandler(cancel)}>
            <form className="insert-form" onSubmit={submit}>
                <h2 id={TITLE_ID} className="insert-sr-only">{INSERT_DIALOG_TEXTS.title}</h2>
                <div className="insert-columns">
                    <KindList />
                    <section className="insert-settings" aria-label={INSERT_DIALOG_TEXTS.settings}>
                        <header>
                            <h3>{KIND_TITLES[state.kind]}</h3>
                            <p>{KIND_SUMMARIES[state.kind]}</p>
                        </header>
                        <Panel kind={state.kind} />
                    </section>
                    <PreviewPane />
                </div>
                <Footer
                    error={state.errorMessage}
                    blocker={blocker}
                    destination={destinationOf(input, state.context, state.catalog.bibliography)}
                    kind={state.kind}
                    isBusy={state.isBusy}
                    onCancel={cancel}
                />
            </form>
        </dialog>
    );
}

/** Hängt das Fenster ein; es entsteht bei jedem Öffnen neu (frischer `showModal`, Fokus auf dem gewählten Baustein) */
export function InsertDialog({ focusEditor }: InsertDialogProps) {
    const isOpen = useInsertStore((state) => state.isOpen);
    return isOpen ? <InsertDialogBody focusEditor={focusEditor} /> : null;
}
