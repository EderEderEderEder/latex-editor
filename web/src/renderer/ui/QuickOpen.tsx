// „Schnell öffnen“ (Strg+P): modaler `<dialog>` (Fokusfalle durch `showModal`) mit Eingabe und Trefferliste.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, SyntheticEvent } from 'react';
import { fileNameOf, folderOf, matchPositions, normalizeQuery, rankQuickOpen } from '../../shared/core/quickOpen';
import type { QuickOpenFile } from '../../shared/core/quickOpen';
import './quickOpen.css';

export interface QuickOpenProps {
    /** Alle Projektdateien (relative Pfade), `isOpen` für Dateien mit Tab */
    readonly files: readonly QuickOpenFile[];
    readonly onOpen: (path: string) => void;
    readonly onClose: () => void;
}

const TEXTS = {
    label: 'Datei suchen',
    placeholder: 'Datei suchen …',
    empty: 'Keine passende Datei.',
    open: 'offen',
} as const;

const LISTBOX_ID = 'quick-open-list';

function Highlighted({ text, positions }: { readonly text: string; readonly positions: readonly number[] }) {
    if (positions.length === 0) return <>{text}</>;
    const marked = new Set(positions);
    return (
        <>
            {Array.from(text).map((character, index) =>
                marked.has(index) ? <mark key={index}>{character}</mark> : character,
            )}
        </>
    );
}

function QuickOpenRow(props: {
    readonly file: QuickOpenFile;
    readonly needle: string;
    readonly selected: boolean;
    readonly index: number;
    readonly onHover: () => void;
    readonly onChoose: () => void;
}) {
    const { file, needle, selected, index } = props;
    const name = fileNameOf(file.path);
    const folder = folderOf(file.path);
    const namePositions = matchPositions(name, needle);
    const folderPositions = namePositions.length === 0 ? matchPositions(file.path, needle).filter((position) => position < folder.length) : [];
    return (
        <li id={`quick-open-${index}`} role="option" aria-selected={selected} className="quick-open-item"
            onMouseMove={props.onHover} onClick={props.onChoose}>
            <span className="quick-open-name"><Highlighted text={name} positions={namePositions} /></span>
            <span className="quick-open-folder"><Highlighted text={folder} positions={folderPositions} /></span>
            {file.isOpen === true ? <span className="quick-open-open">{TEXTS.open}</span> : null}
        </li>
    );
}

/** Pfeiltaste → neue Auswahl, sonst `null` */
function movedSelection(key: string, selection: number, count: number): number | null {
    if (count === 0) return null;
    if (key === 'ArrowDown') return (selection + 1) % count;
    if (key === 'ArrowUp') return (selection - 1 + count) % count;
    return null;
}

export function QuickOpen({ files, onOpen, onClose }: QuickOpenProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [query, setQuery] = useState('');
    const [selection, setSelection] = useState(0);
    const results = useMemo(() => rankQuickOpen(files, query), [files, query]);
    const needle = normalizeQuery(query);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog !== null && !dialog.open) dialog.showModal();
    }, []);
    useEffect(() => {
        document.getElementById(`quick-open-${selection}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [selection, results]);
    const choose = (index: number): void => {
        const file = results[index];
        if (file !== undefined) onOpen(file.path);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        const moved = movedSelection(event.key, selection, results.length);
        if (moved !== null) {
            event.preventDefault();
            setSelection(moved);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(selection);
        }
    };
    const cancel = (event: SyntheticEvent): void => {
        event.preventDefault();
        onClose();
    };
    // Klick auf den Hintergrund (das `<dialog>` selbst) schließt
    const closeOnBackdrop = (event: MouseEvent): void => {
        if (event.target === event.currentTarget) onClose();
    };
    return (
        <dialog ref={dialogRef} className="close-confirm quick-open" aria-label={TEXTS.label} onCancel={cancel} onClick={closeOnBackdrop}>
            <input
                type="text" role="combobox" autoFocus autoComplete="off" spellCheck={false}
                aria-label={TEXTS.label} aria-expanded="true" aria-controls={LISTBOX_ID} aria-autocomplete="list"
                aria-activedescendant={results.length > 0 ? `quick-open-${selection}` : undefined}
                placeholder={TEXTS.placeholder} value={query} onKeyDown={onKeyDown}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setSelection(0);
                }}
            />
            <ul id={LISTBOX_ID} role="listbox" aria-label={TEXTS.label} className="quick-open-list">
                {results.map((file, index) => (
                    <QuickOpenRow key={file.path} file={file} needle={needle} selected={index === selection} index={index}
                        onHover={() => setSelection(index)} onChoose={() => choose(index)} />
                ))}
            </ul>
            {results.length === 0 ? <div className="quick-open-empty" role="status">{TEXTS.empty}</div> : null}
        </dialog>
    );
}
