import { describe, expect, it } from 'vitest';
import { asciiKeyPart, authorsBibtex, authorsShort, keyValid, makeKey } from '../../src/shared/core/bib/authors';
import { escapeValue, formatEntry } from '../../src/shared/core/bib/formatter';
import { type BibField, catalogEntries, parseBib } from '../../src/shared/core/bib/parser';
import {
    appendix,
    bibTarget,
    buildSource,
    type SourceResult,
    type SourceSettings,
    sourceProblemMessage,
} from '../../src/shared/core/bib/sourceBuilder';
import { loadSpec, type SpecCase } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/bibliography.json` (Format: `notes` der Datei, `shared/spec/README.md`),
// danach Randfälle, die nur die TypeScript-Seite prüft (Umlaute, Klammern, Makros, kaputte Einträge, CRLF).
const EXPECTED_CASE_COUNT = 25;
const MANY_KEYS_COUNT = 27;

type Input = Record<string, unknown> & { readonly op: string };
type Expect = Record<string, unknown>;

const spec = loadSpec('bibliography');

function expectedError(result: SourceResult): unknown {
    if (result.ok) return undefined;
    return result.problem.kind === 'noBibtexEntry' ? 'noBibtexEntry' : { missingFields: result.problem.fields };
}

function checkBuildSource(input: Input, expected: Expect): void {
    const result = buildSource(input.settings as Partial<SourceSettings>, input.existingKeys as string[], String(input.today));
    if (expected.error !== undefined) {
        expect(expectedError(result)).toEqual(expected.error);
        if (expected.errorMessage !== undefined && !result.ok) expect(sourceProblemMessage(result.problem)).toBe(expected.errorMessage);
        return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (expected.key !== undefined) expect(result.key).toBe(expected.key);
    if (expected.entry !== undefined) expect(result.entry).toBe(expected.entry);
}

function checkCatalog(input: Input, expected: Expect): void {
    const entries = catalogEntries(String(input.text));
    expect(entries.map((entry) => entry.summary)).toEqual(expected.summaries);
    if (expected.entries !== undefined) expect(entries).toMatchObject(expected.entries as object[]);
}

const CHECKS: Record<string, (input: Input, expected: Expect) => void> = {
    parseBib: (input, expected) => expect(parseBib(String(input.text))).toEqual(expected.records),
    catalogEntries: checkCatalog,
    authorsBibtex: (input, expected) => expect(authorsBibtex(String(input.input))).toBe(expected.result),
    authorsShort: (input, expected) => expect(authorsShort(String(input.authors))).toBe(expected.result),
    makeKey: (input, expected) => {
        const existing = new Set(input.existing as string[]);
        expect(makeKey(String(input.authors), String(input.title), String(input.year), existing)).toBe(expected.key);
    },
    keyValid: (input, expected) => expect(keyValid(String(input.key))).toBe(expected.valid),
    formatEntry: (input, expected) => {
        const escaping = input.escaping === undefined ? true : input.escaping === true;
        expect(formatEntry(String(input.type), String(input.key), input.fields as BibField[], escaping)).toBe(expected.entry);
    },
    escapeValue: (input, expected) => expect(escapeValue(String(input.value), String(input.field))).toBe(expected.result),
    bibTarget: (input, expected) => {
        expect(bibTarget({ mainText: String(input.mainText), projectFiles: input.projectFiles as string[] })).toBe(expected.target);
    },
    appendix: (input, expected) => expect(appendix(String(input.entry), String(input.existing))).toBe(expected.result),
    buildSource: checkBuildSource,
};

function runCase(testCase: SpecCase): void {
    const input = testCase.input as Input;
    const check = CHECKS[input.op];
    if (check === undefined) throw new Error(`Unbekannte Operation ${input.op}`);
    check(input, testCase.expect as Expect);
}

describe('Vektoren bibliography.json', () => {
    it('enthält alle Fälle', () => {
        expect(spec.cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    it.each(spec.cases)('$id: $name', (testCase) => runCase(testCase));
});

function field(name: string, value: string): BibField {
    return { name, value };
}

describe('parseBib: Randfälle', () => {
    it('behält Umlaute, Latin-1-Zeichen und kleinschreibt Typ und Feldnamen', () => {
        const records = parseBib('@BOOK{Müller2020, TITLE={Über Größe, Café ÿ ñ £ ½}, Author={Ünal, Çağlar}}');
        expect(records).toEqual([{
            type: 'book',
            key: 'Müller2020',
            fields: [field('title', 'Über Größe, Café ÿ ñ £ ½'), field('author', 'Ünal, Çağlar')],
        }]);
    });

    it('liest zerlegte Umlaute (e + Akzent) als Teil von Bezeichnern', () => {
        const records = parseBib('@book{k, ta\u0308g={x}}');
        expect(records[0]?.fields).toEqual([field('ta\u0308g', 'x')]);
    });

    it('behält verschachtelte Klammern und LaTeX-Akzente im Wert', () => {
        const records = parseBib('@book{k,\n title = {A {B} {C {D}} E},\n note = {M\\"{u}ller \\{ok\\}}}');
        expect(records[0]?.fields).toEqual([field('title', 'A {B} {C {D}} E'), field('note', 'M\\"{u}ller \\{ok\\}')]);
    });

    it('beendet einen Wert in Anführungszeichen nur auf Klammertiefe 0', () => {
        const records = parseBib('@book{k, title = "M{\\"u}ller und {"quoted"}", year = "2020"}');
        expect(records[0]?.fields).toEqual([field('title', 'M{\\"u}ller und {"quoted"}'), field('year', '2020')]);
    });

    it('verkettet Makros, Wörter und Texte mit # ohne Auflösung', () => {
        const records = parseBib('@string{pub = "Springer"}\n@book{k, publisher = pub # " Verlag" # {, Berlin}, year = 19 # 84}');
        expect(records).toHaveLength(1);
        expect(records[0]?.fields).toEqual([field('publisher', 'pub Verlag, Berlin'), field('year', '1984')]);
    });

    it('überspringt @comment, @string und @preamble samt verschachtelter Klammern', () => {
        const text = '@comment{ @book{x, title={Y}} }\n@preamble{"\\newcommand{\\a}{b}"}\n@string{s = {A {B}}}\n@book{z, title={Z}}';
        expect(parseBib(text).map((record) => record.key)).toEqual(['z']);
    });

    it('überspringt Kommentare zwischen Einträgen und mitten in der Zeile', () => {
        const text = '@book{a, title={A}}\n% @book{b, title={B}}\nnoch Text % @book{c, title={C}}\n@book{d, title={D}}';
        expect(parseBib(text).map((record) => record.key)).toEqual(['a', 'd']);
    });

    it('liest Einträge mit runden Klammern', () => {
        const records = parseBib('@article(key1, title = {T}, year = 2020)\n@book{k2, title={U}}');
        expect(records.map((record) => record.key)).toEqual(['key1', 'k2']);
        expect(records[0]?.fields).toEqual([field('title', 'T'), field('year', '2020')]);
    });

    it('fügt mehrzeilige Werte mit einem Leerzeichen zusammen', () => {
        const records = parseBib('@book{k, title = {Eine\n    lange   Zeile\n\n  Ende}}');
        expect(records[0]?.fields).toEqual([field('title', 'Eine lange   Zeile Ende')]);
    });

    it('kommt mit Windows-Zeilenenden zurecht', () => {
        const records = parseBib('% Kommentar\r\n@book{a,\r\n  title = {X},\r\n  year = 2020\r\n}\r\n@book{b, title={Y}}');
        expect(records.map((record) => record.key)).toEqual(['a', 'b']);
        expect(records[0]?.fields).toEqual([field('title', 'X'), field('year', '2020')]);
    });

    it('verwirft Einträge ohne Schlüssel und ohne Klammer, behält die nächsten', () => {
        const text = '@book{, title={X}}\n@book title={Y}\nan @ home\n@book{ok, title={Z}}';
        expect(parseBib(text).map((record) => record.key)).toEqual(['ok']);
    });

    it('überlebt abgeschnittene Einträge ohne Absturz', () => {
        expect(parseBib('@book{a, title={X').map((record) => record.key)).toEqual(['a']);
        expect(parseBib('@book{a, title="X')).toHaveLength(1);
        expect(parseBib('@book{a, title = ')).toHaveLength(1);
        expect(parseBib('@book')).toEqual([]);
        expect(parseBib('@')).toEqual([]);
        expect(parseBib('')).toEqual([]);
    });

    it('behält doppelte Felder und Schlüssel in Reihenfolge', () => {
        const records = parseBib('@book{a, title={1}, title={2}}\n@book{a, title={3}}');
        expect(records).toHaveLength(2);
        expect(records[0]?.fields).toEqual([field('title', '1'), field('title', '2')]);
    });

    it('ignoriert Felder ohne Gleichheitszeichen und liest dahinter weiter', () => {
        const records = parseBib('@book{a, kaputt, title={X}}');
        expect(records[0]?.fields.map((entry) => entry.name)).toContain('title');
    });
});

describe('catalogEntries: Randfälle', () => {
    it('nimmt editor, sonst organization, und zählt Zeilen ab dem Schlüssel', () => {
        const text = '\n\n@book{a, editor={Huber, Anna}, title={A}}\n@online{b,\n organization={{Wikipedia}}, title = {B}}';
        const entries = catalogEntries(text);
        expect(entries).toMatchObject([
            { key: 'a', authors: 'Huber', line: 3, summary: 'Huber · A' },
            { key: 'b', authors: 'Wikipedia', allAuthors: 'Wikipedia', line: 4, summary: 'Wikipedia · B' },
        ]);
    });

    it('lässt leere Teile der Zusammenfassung weg und nimmt für doppelte Schlüssel die erste Zeile', () => {
        const entries = catalogEntries('@misc{x, year={2020}}\n@misc{x, title={Zwei}}');
        expect(entries.map((entry) => entry.summary)).toEqual(['2020', 'Zwei']);
        expect(entries.map((entry) => entry.line)).toEqual([1, 1]);
    });

    it('kürzt das Jahr auf vier Zeichen und bevorzugt date vor year', () => {
        const entries = catalogEntries('@misc{x, date={2019-12-31}, year={2000}}\n@misc{y, year={n.d.}}');
        expect(entries.map((entry) => entry.year)).toEqual(['2019', 'n.d.']);
    });
});

describe('Autoren und Schlüssel: Randfälle', () => {
    it('formt Namen um und lässt Sonderformen stehen', () => {
        expect(authorsBibtex('   ')).toBe('');
        expect(authorsBibtex('Jörg Müller')).toBe('Müller, Jörg');
        expect(authorsBibtex('Max Mustermann AND Erika Musterfrau')).toBe('Max Mustermann AND Erika Musterfrau');
        expect(authorsBibtex('{Deutsche Bank AG}')).toBe('{Deutsche Bank AG}');
        expect(authorsBibtex('Anna Maria Huber;; ;  Max Mustermann')).toBe('Huber, Anna Maria and Mustermann, Max');
        expect(authorsBibtex('Max A\r\nErika B')).toBe('A, Max and B, Erika');
    });

    it('kürzt Autorenlisten', () => {
        expect(authorsShort('')).toBe('');
        expect(authorsShort('A, a and B, b and C, c')).toBe('A u. a.');
        expect(authorsShort('{Müller}, Jörg')).toBe('Müller');
        expect(authorsShort('Max {van der} Berg')).toBe('Berg');
    });

    it('schreibt Umlaute und Akzente um und behält nur ASCII', () => {
        expect(asciiKeyPart('Straße Äpfel Öl Über')).toBe('StrasseAepfelOelUeber');
        expect(asciiKeyPart('Ñandú Café')).toBe('NanduCafe');
        expect(asciiKeyPart('Mu\u0308ller')).toBe('Mueller');
        expect(asciiKeyPart('2020/21')).toBe('202021');
    });

    it('baut Schlüssel mit Rückfallwerten und endet bei vielen Treffern mit Anzahl', () => {
        expect(makeKey('Ω', '', '2020', new Set())).toBe('quelle2020');
        expect(makeKey('', 'Über uns', '', new Set())).toBe('Ueber');
        expect(makeKey('', '', '2020', new Set())).toBe('quelle2020');
        expect(makeKey('Mustermann, Max and Huber, Anna', '', '2024', new Set())).toBe('Mustermann2024');
        const taken = new Set(['Mueller2024', ...'abcdefghijklmnopqrstuvwxyz'.split('').map((suffix) => `Mueller2024${suffix}`)]);
        expect(taken.size).toBe(MANY_KEYS_COUNT);
        expect(makeKey('Müller, J', '', '2024', taken)).toBe(`Mueller2024-${MANY_KEYS_COUNT}`);
    });

    it('prüft Schlüssel streng auf ASCII', () => {
        for (const valid of ['a', 'a:b-c_d.e', 'Knuth1984']) expect(keyValid(valid)).toBe(true);
        for (const invalid of ['', 'a b', 'Ünal', 'key,1', 'a\n', 'a/b']) expect(keyValid(invalid)).toBe(false);
    });
});

describe('Formatter: Randfälle', () => {
    it('maskiert Sonderzeichen außer in wörtlichen Feldern und behält vorhandene Maskierung', () => {
        expect(escapeValue(' a_b & c % d # e $f \n', 'title')).toBe('a\\_b \\& c \\% d \\# e \\$f');
        expect(escapeValue('\\\\_', 'title')).toBe('\\\\_');
        expect(escapeValue('a_b%c&d', 'url')).toBe('a_b%c&d');
        expect(escapeValue('  10.1/a_b ', 'doi')).toBe('10.1/a_b');
        expect(escapeValue('Café Größe {x}', 'title')).toBe('Café Größe {x}');
    });

    it('schreibt ohne Felder und ohne Maskierung wie die Vorlage', () => {
        expect(formatEntry('t', 'k', [])).toBe('@t{k,\n\n}\n');
        expect(formatEntry('t', 'k', [field('title', ' '), field('note', '\t')])).toBe('@t{k,\n\n}\n');
        expect(formatEntry('article', 'k', [field('title', 'Über $\\alpha$ & _x')], false))
            .toBe('@article{k,\n\ttitle={Über $\\alpha$ & _x}\n}\n');
    });
});

describe('bibTarget und appendix: Randfälle', () => {
    it('findet Ressourcen mit Optionen, Unterordner und mehreren Namen', () => {
        const files = ['x.bib', 'lit/refs.bib', 'b.bib'];
        expect(bibTarget({ mainText: '\\addbibresource[datatype=bibtex]{lit/refs.bib}', projectFiles: files })).toBe('lit/refs.bib');
        expect(bibTarget({ mainText: '\\bibliography{nichtda, b}', projectFiles: files })).toBe('b.bib');
        expect(bibTarget({ mainText: '\\AddBibFile{./lit/../b.bib}', projectFiles: files })).toBe('b.bib');
        expect(bibTarget({ mainText: '\\addbibresource { b.bib }', projectFiles: files })).toBe('b.bib');
    });

    it('nimmt sonst die erste .bib und liefert null ohne .bib', () => {
        expect(bibTarget({ mainText: '\\bibliography{fehlt}', projectFiles: ['main.tex', 'A.BIB', 'z.bib'] })).toBe('A.BIB');
        expect(bibTarget({ mainText: null, projectFiles: ['z.bib'] })).toBe('z.bib');
        expect(bibTarget({ mainText: '', projectFiles: ['main.tex', 'bild.png'] })).toBeNull();
    });

    it('hängt mit genau einer Leerzeile Abstand an', () => {
        expect(appendix('@x{}\n', '@a{}\n\n')).toBe('@x{}\n');
        expect(appendix('@x{}\n', '@a{}\n\n\n\n')).toBe('@x{}\n');
        expect(appendix('@x{}\n', '\n')).toBe('\n@x{}\n');
    });
});

function build(settings: Partial<SourceSettings>, existing: string[] = []): SourceResult {
    return buildSource(settings, existing, '2026-10-15');
}

describe('buildSource: Randfälle', () => {
    it('nennt fehlende Pflichtfelder je Typ in der Reihenfolge der Feldliste', () => {
        expect(expectedError(build({}))).toEqual({ missingFields: ['Autor', 'Titel', 'Verlag', 'Jahr'] });
        expect(expectedError(build({ type: 'article', authors: 'A B' }))).toEqual({ missingFields: ['Titel', 'Zeitschrift', 'Jahr'] });
        expect(expectedError(build({ type: 'inproceedings', authors: 'A B', values: { title: 'T', date: '2020' } })))
            .toEqual({ missingFields: ['Tagungsband'] });
        expect(expectedError(build({ type: 'incollection', authors: 'A B', values: { title: 'T', date: '2020' } })))
            .toEqual({ missingFields: ['Sammelband'] });
        expect(expectedError(build({ type: 'thesis', authors: 'A B', values: { title: 'T' } })))
            .toEqual({ missingFields: ['Art', 'Hochschule', 'Jahr'] });
    });

    it('behandelt Werte aus Leerraum als fehlend und trimmt Werte', () => {
        const result = build({ type: 'software', values: { title: '  \n ', url: ' https://x.org ' } });
        expect(expectedError(result)).toEqual({ missingFields: ['Titel'] });
        const ok = build({ type: 'software', values: { title: ' Tool_X ', url: ' https://x.org/a_b ' }, language: 'none' });
        expect(ok).toEqual({ ok: true, key: 'ToolX', entry: '@software{ToolX,\n\ttitle={Tool\\_X},\n\turl={https://x.org/a_b}\n}\n' });
    });

    it('übernimmt ein vorhandenes Abrufdatum und setzt sonst heute', () => {
        const base = { type: 'online', values: { title: 'T', url: 'https://x.org' }, language: 'none' } as const;
        const today = build(base);
        expect(today.ok && today.entry).toContain('urldate={2026-10-15}');
        const own = build({ ...base, values: { ...base.values, urldate: ' 2020-01-02 ' } });
        expect(own.ok && own.entry).toContain('urldate={2020-01-02}');
        expect(own.ok && own.entry).not.toContain('langid');
    });

    it('wählt den Eigenschlüssel nur, wenn er gültig und frei ist; Jahr ist auf vier Zeichen gekürzt', () => {
        const values = { title: 'Ünderstanding', publisher: 'V', date: '2024-05-01' };
        const form = { authors: 'Jörg Müller', values };
        expect(build({ ...form, keyOverride: ' eigen-1 ' })).toMatchObject({ ok: true, key: 'eigen-1' });
        expect(build({ ...form, keyOverride: 'Mueller2024' }, ['Mueller2024'])).toMatchObject({ key: 'Mueller2024a' });
        expect(build({ ...form, keyOverride: 'ungültig!' })).toMatchObject({ key: 'Mueller2024' });
    });

    it('übernimmt eingefügtes BibTeX unverändert und kürzt das Jahr dort nicht', () => {
        const bibtex = '@Book{bad key, Author={Müller, J}, title={T & _x}, date={2020-05-01}, note = "Café ÿ"}';
        expect(build({ mode: 'bibtex', bibtex })).toEqual({
            ok: true,
            key: 'Mueller20200501',
            entry: '@book{Mueller20200501,\n\tauthor={Müller, J},\n\ttitle={T & _x},\n\tdate={2020-05-01},\n\tnote={Café ÿ}\n}\n',
        });
    });

    it('nimmt bei eingefügtem BibTeX den Eintragsschlüssel, wenn er frei ist, und den ersten Eintrag', () => {
        const bibtex = '@comment{x}\n@book{erster, title={A}}\n@book{zweiter, title={B}}';
        expect(build({ mode: 'bibtex', bibtex })).toMatchObject({ key: 'erster' });
        expect(build({ mode: 'bibtex', bibtex }, ['erster'])).toMatchObject({ key: 'A' });
        expect(build({ mode: 'bibtex', bibtex, keyOverride: 'mein' })).toMatchObject({ key: 'mein' });
        expect(build({ mode: 'bibtex', bibtex, keyOverride: ' x' })).toMatchObject({ key: 'A' });
    });

    it('meldet fehlendes BibTeX mit deutscher Meldung', () => {
        const result = build({ mode: 'bibtex', bibtex: '@book{, title={X}}' });
        expect(expectedError(result)).toBe('noBibtexEntry');
        if (!result.ok) expect(sourceProblemMessage(result.problem)).toContain('Kein BibTeX-Eintrag erkannt');
    });
});
