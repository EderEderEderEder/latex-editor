// Rechte Spalte: Vorschau an Ort und Stelle (Vorlage `InsertionPreview`): der Code zwischen den echten Zeilen um den
// Cursor, neue Zeilen mit grünem Streifen, die Umgebung blasser. Ohne `.tex` vorne und bei einer Quelle nur der Code.
import { useEffect, useMemo, useRef, useState } from 'react';
import { firstNewRowIndex, previewRows } from '../../app/insertPreview';
import type { PreviewRow } from '../../app/insertPreview';
import { previewLinesOf, standalonePreview } from '../../app/insertLogic';
import type { GenerateInput } from '../../app/insertLogic';
import { todayText } from '../../app/insertRuntime';
import { KIND_TITLES } from '../../app/insertKinds';
import { useInsertStore } from '../../stores/insert';
import { copyTextToClipboard } from './copyText';

export const PREVIEW_TEXTS = {
    region: 'Vorschau',
    inFile: (fileName: string) => `Vorschau in ${fileName}`,
    inBibliography: (fileName: string) => `Neuer Eintrag in ${fileName}`,
    bibEntry: 'BibTeX-Eintrag',
    plain: 'LaTeX-Code',
    copy: 'Kopieren',
    copied: 'Kopiert',
    copyHint: 'Nur den erzeugten Code kopieren',
    newLine: 'Neu: ',
} as const;

/** Wie viele Zeilen Umgebung beim Scrollen zum neuen Code oberhalb stehen bleiben */
const CONTEXT_LINES_ABOVE = 3;
const COPIED_RESET_MS = 1_500;

function useTitle(): string {
    return useInsertStore((state) => {
        if (state.kind === 'source') {
            return state.catalog.bibliography === null ? PREVIEW_TEXTS.bibEntry : PREVIEW_TEXTS.inBibliography(state.catalog.bibliography.name);
        }
        return state.context === null ? PREVIEW_TEXTS.plain : PREVIEW_TEXTS.inFile(state.context.fileName);
    });
}

function Row({ row, isDimmed }: { readonly row: PreviewRow; readonly isDimmed: boolean }) {
    const classes = ['insert-preview-row', row.isNew ? 'is-new' : '', isDimmed && !row.isNew ? 'is-context' : ''].filter(Boolean);
    return (
        <div role="listitem" className={classes.join(' ')} data-new={row.isNew ? 'true' : undefined}>
            <span className="insert-preview-number" aria-hidden="true">{row.number}</span>
            <span className="insert-preview-text">
                {row.isNew && <span className="insert-sr-only">{PREVIEW_TEXTS.newLine}</span>}
                {row.text === '' ? ' ' : row.segments.map((segment, index) => (
                    <span key={index} style={segment.kind === null ? undefined : { color: `var(--editor-syntax-${segment.kind})` }}>{segment.text}</span>
                ))}
            </span>
        </div>
    );
}

function CopyButton({ text }: { readonly text: string }) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return undefined;
        const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
        return () => clearTimeout(timer);
    }, [copied]);
    return (
        <button type="button" title={PREVIEW_TEXTS.copyHint} onClick={() => setCopied(copyTextToClipboard(text))}>
            {copied ? PREVIEW_TEXTS.copied : PREVIEW_TEXTS.copy}
        </button>
    );
}

export function PreviewPane() {
    const state = useInsertStore((current) => current);
    const title = useTitle();
    const scrollRef = useRef<HTMLDivElement>(null);
    const input = useMemo((): GenerateInput => ({ kind: state.kind, settings: state, catalog: state.catalog, today: todayText() }), [state]);
    const hasContext = state.context !== null && state.kind !== 'source';
    const rows = useMemo(
        () => previewRows(previewLinesOf(input, state.context), state.kind === 'source' ? 'bibtex' : 'latex'),
        [input, state.context, state.kind],
    );
    const firstNew = firstNewRowIndex(rows);
    useEffect(() => {
        const container = scrollRef.current;
        if (container === null || firstNew === null) return;
        const target = container.children[Math.max(0, firstNew - CONTEXT_LINES_ABOVE)] as HTMLElement | undefined;
        if (target !== undefined) container.scrollTop = target.offsetTop;
    }, [firstNew, state.kind]);
    return (
        <section className="insert-preview" aria-label={PREVIEW_TEXTS.region}>
            <header>
                <h3>{title}</h3>
                <CopyButton text={standalonePreview(input)} />
            </header>
            <div ref={scrollRef} className="insert-preview-lines" role="list" tabIndex={0} aria-label={`${PREVIEW_TEXTS.region}: ${KIND_TITLES[state.kind]}`}>
                {rows.map((row, index) => <Row key={index} row={row} isDimmed={hasContext} />)}
            </div>
        </section>
    );
}
