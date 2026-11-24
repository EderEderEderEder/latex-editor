// Dateisymbole als einfache SVG (16 × 16, Linien in `currentColor`), ein Symbol je Dateiart; keine Paket-Icons.
import type { FileGlyph } from '../../shared/core/fileTypes';

const PAGE = 'M4 1.5h5.5l3 3v10H4z M9.5 1.5v3h3';
const FOLDER = 'M1.5 4h4.5l1.5 1.5h7v8h-13z';

const GLYPH_PATHS: Readonly<Record<FileGlyph, readonly string[]>> = {
    tex: [PAGE, 'M6 8h5 M6 10.5h5'],
    bib: ['M3 2h9v12H3z', 'M5.5 2v12'],
    pdf: [PAGE, 'M6 12h5'],
    image: ['M2 3h12v10H2z', 'M2 11l3.5-3.5 3 3 2-2 3.5 3.5'],
    archive: [PAGE, 'M8 3v6'],
    code: ['M6 5L3 8l3 3', 'M10 5l3 3-3 3'],
    table: ['M2 3h12v10H2z', 'M2 7h12 M6 3v10'],
    text: [PAGE, 'M6 8h4 M6 10h4 M6 12h2'],
    package: ['M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z', 'M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2'],
    data: ['M6 3c-2 0-2 1-2 2v1c0 1-1 2-1 2s1 1 1 2v1c0 1 0 2 2 2', 'M10 3c2 0 2 1 2 2v1c0 1 1 2 1 2s-1 1-1 2v1c0 1 0 2-2 2'],
    video: ['M2 4h12v8H2z', 'M7 6.5v3l2.5-1.5z'],
    audio: ['M3 7v2 M5.5 5v6 M8 3v10 M10.5 5v6 M13 7v2'],
    presentation: ['M2 3h12v8H2z', 'M8 11v3 M5.5 14h5'],
    document: [PAGE, 'M6 8h5 M6 10.5h5'],
    other: [PAGE],
};

export type FileIconKind = FileGlyph | 'folder' | 'folderOpen';

function pathsOf(kind: FileIconKind): readonly string[] {
    return kind === 'folder' || kind === 'folderOpen' ? [FOLDER] : GLYPH_PATHS[kind];
}

export function FileIcon({ kind }: { readonly kind: FileIconKind }) {
    return (
        <svg
            className={`file-icon file-icon-${kind}`}
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {pathsOf(kind).map((d) => (
                <path key={d} d={d} />
            ))}
        </svg>
    );
}
