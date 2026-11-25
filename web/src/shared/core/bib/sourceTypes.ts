// Quelltypen mit den Feldern, die biblatex (und die Gliederung der HgbThesis in Literatur, Online-Quellen,
// Software) erwartet (Port von `SourceType` aus `Bibliography.swift`). Reine Daten ohne DOM oder Node.

export type SourceTypeName = 'book' | 'article' | 'inproceedings' | 'incollection' | 'online' | 'thesis' | 'software';

/** Ein Feld im Formular „Quelle“; `title` ist die deutsche Beschriftung und der Name in Fehlermeldungen */
export interface SourceField {
    readonly name: string;
    readonly title: string;
    readonly isRequired: boolean;
    readonly placeholder?: string;
}

export const SOURCE_TYPE_NAMES: readonly SourceTypeName[] = [
    'book', 'article', 'inproceedings', 'incollection', 'online', 'thesis', 'software',
];

export const SOURCE_TYPE_TITLES: Readonly<Record<SourceTypeName, string>> = {
    book: 'Buch',
    article: 'Zeitschriftenartikel',
    inproceedings: 'Konferenzbeitrag',
    incollection: 'Beitrag in Sammelband',
    online: 'Webseite / Online-Quelle',
    thesis: 'Abschlussarbeit',
    software: 'Software',
};

const PAGES_PLACEHOLDER = 'z. B. 12--34';
const URL_PLACEHOLDER = 'https://…';
const URLDATE_PLACEHOLDER = 'JJJJ-MM-TT';

function field(name: string, title: string, isRequired: boolean, placeholder?: string): SourceField {
    return placeholder === undefined ? { name, title, isRequired } : { name, title, isRequired, placeholder };
}

function titleField(): SourceField {
    return field('title', 'Titel', true);
}

function dateField(type: SourceTypeName): SourceField {
    return field('date', 'Jahr', type !== 'online' && type !== 'software', 'z. B. 2024');
}

const FIELD_BUILDERS: Readonly<Record<SourceTypeName, () => SourceField[]>> = {
    book: () => [
        titleField(), field('subtitle', 'Untertitel', false), field('edition', 'Auflage', false, 'z. B. 3'),
        field('publisher', 'Verlag', true), field('location', 'Ort', false), dateField('book'), field('isbn', 'ISBN', false),
    ],
    article: () => [
        titleField(), field('journaltitle', 'Zeitschrift', true), field('volume', 'Jahrgang (Band)', false),
        field('number', 'Heft', false), field('pages', 'Seiten', false, PAGES_PLACEHOLDER), dateField('article'),
        field('doi', 'DOI', false),
    ],
    inproceedings: () => collectionFields('inproceedings', 'Tagungsband'),
    incollection: () => collectionFields('incollection', 'Sammelband'),
    online: () => [
        titleField(), field('organization', 'Organisation', false), field('url', 'URL', true, URL_PLACEHOLDER),
        field('urldate', 'Abgerufen am', true, URLDATE_PLACEHOLDER), dateField('online'),
    ],
    thesis: () => [
        titleField(), field('type', 'Art', true, 'z. B. Masterarbeit'), field('institution', 'Hochschule', true),
        field('location', 'Ort', false), dateField('thesis'),
    ],
    software: () => [
        titleField(), field('version', 'Version', false), field('url', 'URL', false, URL_PLACEHOLDER),
        field('urldate', 'Abgerufen am', false, URLDATE_PLACEHOLDER), dateField('software'),
    ],
};

function collectionFields(type: SourceTypeName, bookTitle: string): SourceField[] {
    return [
        titleField(), field('booktitle', bookTitle, true), field('editor', 'Herausgeber', false),
        field('publisher', 'Verlag', false), field('location', 'Ort', false),
        field('pages', 'Seiten', false, PAGES_PLACEHOLDER), dateField(type), field('doi', 'DOI', false),
    ];
}

/** Felder des Typs in der Reihenfolge des Formulars und des Eintrags */
export function sourceFields(type: SourceTypeName): SourceField[] {
    return FIELD_BUILDERS[type]();
}

/** Ohne Autor nur bei Webseiten und Software sinnvoll (dort steht oft eine Organisation) */
export function requiresAuthor(type: SourceTypeName): boolean {
    return type !== 'online' && type !== 'software';
}
