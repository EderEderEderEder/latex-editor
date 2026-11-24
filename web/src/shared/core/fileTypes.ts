// Dateiarten für Symbol, Typmenü und „im Editor öffnen?“ (Vorlage: `FileGlyph`/`FileTypeCatalog` der Swift-Version).
// Reine Logik ohne Dateizugriff; Endungen sind klein geschrieben, ohne Punkt, `''` für Dateien ohne Endung.

export type FileGlyph =
    | 'tex' | 'bib' | 'pdf' | 'image' | 'archive' | 'code' | 'table' | 'text' | 'package' | 'data'
    | 'video' | 'audio' | 'presentation' | 'document' | 'other';

interface FileGroup {
    readonly glyph: FileGlyph;
    readonly title: string;
    readonly extensions: readonly string[];
    /** Textdatei, die der Editor öffnen kann */
    readonly isEditable: boolean;
}

export const NO_EXTENSION_TITLE = 'Ohne Endung';
export const OTHER_GROUP_TITLE = 'Sonstige';
const TEX_TITLE = 'LaTeX';
const BIB_TITLE = 'Literatur';
const PACKAGE_TITLE = 'Pakete und Klassen';
const IMAGE_TITLE = 'Bilder';
const PDF_TITLE = 'PDF';
const EDITABLE_TABLE_EXTENSIONS: readonly string[] = ['csv', 'tsv'];

const FILE_GROUPS: readonly FileGroup[] = [
    { glyph: 'tex', title: TEX_TITLE, extensions: ['tex'], isEditable: true },
    { glyph: 'bib', title: BIB_TITLE, extensions: ['bib'], isEditable: true },
    { glyph: 'package', title: PACKAGE_TITLE, extensions: ['sty', 'cls', 'bst', 'def', 'cfg', 'clo', 'ini'], isEditable: true },
    {
        glyph: 'image', title: IMAGE_TITLE, isEditable: false,
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'svg', 'heic', 'webp', 'bmp', 'eps'],
    },
    { glyph: 'pdf', title: PDF_TITLE, extensions: ['pdf'], isEditable: false },
    { glyph: 'archive', title: 'Archive', extensions: ['zip', 'gz', 'tar', 'tgz', '7z', 'rar', 'bz2', 'xz'], isEditable: false },
    {
        glyph: 'code', title: 'Code', isEditable: true,
        extensions: ['py', 'swift', 'java', 'c', 'cpp', 'h', 'hpp', 'js', 'ts', 'sh', 'rb', 'go', 'rs', 'cs', 'php', 'kt', 'm', 'r', 'sql', 'html', 'css'],
    },
    { glyph: 'table', title: 'Tabellen', extensions: ['csv', 'tsv', 'xlsx', 'xls', 'numbers', 'ods'], isEditable: false },
    { glyph: 'text', title: 'Text', extensions: ['txt', 'md', 'markdown', 'rtf'], isEditable: true },
    { glyph: 'data', title: 'Daten', extensions: ['json', 'xml', 'yaml', 'yml', 'toml', 'plist'], isEditable: true },
    { glyph: 'video', title: 'Video', extensions: ['mp4', 'mov', 'm4v', 'avi'], isEditable: false },
    { glyph: 'audio', title: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac'], isEditable: false },
    { glyph: 'presentation', title: 'Präsentationen', extensions: ['pptx', 'ppt', 'key'], isEditable: false },
    { glyph: 'document', title: 'Dokumente', extensions: ['docx', 'doc', 'pages', 'odt'], isEditable: false },
];

const GROUP_BY_EXTENSION: ReadonlyMap<string, FileGroup> = new Map(
    FILE_GROUPS.flatMap((group) => group.extensions.map((extension) => [extension, group] as const)),
);

/** Reihenfolge im Typmenü: zuerst, was man schreibt, dann Pakete, Bilder, PDF, der Rest, zuletzt Sonstige */
const LEAD_TITLES: readonly string[] = [TEX_TITLE, BIB_TITLE, PACKAGE_TITLE, IMAGE_TITLE, PDF_TITLE];
export const FILE_TYPE_GROUP_ORDER: readonly string[] = [
    ...LEAD_TITLES,
    ...FILE_GROUPS.map((group) => group.title).filter((title) => !LEAD_TITLES.includes(title)),
    OTHER_GROUP_TITLE,
];

/** Kleingeschriebene Endung; Namen ohne Punkt, mit Punkt nur am Anfang (`.gitignore`) oder am Ende ergeben `''` */
export function extensionKey(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return '';
    return name.slice(dot + 1).toLowerCase();
}

export function fileGlyphOf(name: string): FileGlyph {
    return GROUP_BY_EXTENSION.get(extensionKey(name))?.glyph ?? 'other';
}

/** Kann der Editor die Datei als Text öffnen? (Dateien ohne Endung ja, sie sind meist Text) */
export function isEditableTextFile(name: string): boolean {
    const extension = extensionKey(name);
    if (extension === '') return true;
    if (EDITABLE_TABLE_EXTENSIONS.includes(extension)) return true;
    return GROUP_BY_EXTENSION.get(extension)?.isEditable ?? false;
}

export function groupTitleOfExtension(extension: string): string {
    return GROUP_BY_EXTENSION.get(extension)?.title ?? OTHER_GROUP_TITLE;
}

export interface FileTypeEntry {
    readonly extension: string;
    /** „.sty“, bei Dateien ohne Endung „Ohne Endung“ */
    readonly title: string;
    /** 0: im Projekt gibt es keine solche Datei, der Typ ist aber ausgeblendet (bleibt zum Einblenden im Menü) */
    readonly count: number;
}

export interface FileTypeSection {
    readonly title: string;
    readonly entries: readonly FileTypeEntry[];
}

export function fileTypeTitle(extension: string): string {
    return extension === '' ? NO_EXTENSION_TITLE : `.${extension}`;
}

/** Gruppen mit ihren Endungen (alphabetisch); ausgeblendete Endungen ohne Datei stehen mit Anzahl 0 dabei */
export function buildFileTypeSections(counts: ReadonlyMap<string, number>, hidden: ReadonlySet<string>): FileTypeSection[] {
    const all = new Map(counts);
    for (const extension of hidden) if (!all.has(extension)) all.set(extension, 0);
    const grouped = new Map<string, FileTypeEntry[]>();
    for (const [extension, count] of all) {
        const title = groupTitleOfExtension(extension);
        const entries = grouped.get(title) ?? [];
        entries.push({ extension, title: fileTypeTitle(extension), count });
        grouped.set(title, entries);
    }
    return FILE_TYPE_GROUP_ORDER.flatMap((title) => {
        const entries = grouped.get(title);
        if (entries === undefined) return [];
        return [{ title, entries: entries.sort((a, b) => a.extension.localeCompare(b.extension)) }];
    });
}
