import { describe, expect, it } from 'vitest';
import { makeInsertionContext } from '../../src/shared/core/insertion';
import {
    adoptSelection, blockerOf, createInsertSettings, destinationOf, EMPTY_INSERT_CATALOG, generateInsertion, imageReferenceOf,
    INSERT_TEXTS, labelNamesOf, previewLinesOf, resolvedLabel, standalonePreview, validationMessage,
} from '../../src/renderer/app/insertLogic';
import type { GenerateInput, InsertCatalog, InsertSettings } from '../../src/renderer/app/insertLogic';
import type { InsertionKind } from '../../src/renderer/app/insertKinds';

const TODAY = '2026-11-27';

function catalogWith(overrides: Partial<InsertCatalog> = {}): InsertCatalog {
    return { ...EMPTY_INSERT_CATALOG, projectRoot: '/p', ...overrides };
}

function input(kind: InsertionKind, settings: InsertSettings, catalog: InsertCatalog = catalogWith(), imageReference?: string): GenerateInput {
    return { kind, settings, catalog, today: TODAY, ...(imageReference === undefined ? {} : { imageReference }) };
}

function withSettings(change: (settings: InsertSettings) => Partial<InsertSettings>): InsertSettings {
    const base = createInsertSettings();
    return { ...base, ...change(base) };
}

describe('Label (Eindeutigkeit über den Projektindex)', () => {
    const labels = [{ label: 'tab:ergebnisse', file: 'a.tex', line: 3 }, { label: 'tab:ergebnisse-2', file: 'a.tex', line: 9 }];

    it('erzeugt aus der Beschriftung ein freies Label und nummeriert bei Kollisionen weiter', () => {
        const settings = withSettings((base) => ({ table: { ...base.table, caption: 'Ergebnisse' } }));
        const existing = labelNamesOf(catalogWith({ labels }));
        expect(resolvedLabel('table', settings, existing)).toBe('tab:ergebnisse-3');
        expect(resolvedLabel('table', settings, new Set())).toBe('tab:ergebnisse');
    });

    it('ohne Beschriftung gibt es kein Label, ein eigener Wert gilt unverändert', () => {
        const plain = createInsertSettings();
        expect(resolvedLabel('table', plain, new Set())).toBe('');
        const custom = { ...plain, labelOverrides: { ...plain.labelOverrides, table: ' tab:eigen ' } };
        expect(resolvedLabel('table', custom, new Set(['tab:eigen']))).toBe('tab:eigen');
    });

    it('der Text enthält das eindeutige Label hinter der Beschriftung', () => {
        const settings = withSettings((base) => ({ image: { ...base.image, caption: 'Ablauf' } }));
        const text = generateInsertion(input('image', settings, catalogWith({ labels: [{ label: 'fig:ablauf', file: 'x.tex', line: 1 }] }), 'a.png'));
        expect(text).toContain('\\label{fig:ablauf-2}');
        expect(text).toContain('\\includegraphics[width=.75\\textwidth]{a.png}');
    });
});

describe('markierter Text', () => {
    it('wird Inhalt von Code, Gleichung und Liste (Liste: eine Zeile je Punkt, höchstens 30)', () => {
        const adopted = adoptSelection(createInsertSettings(), '  eins\n\n zwei \n');
        expect(adopted.code.content).toBe('eins\n\n zwei');
        expect(adopted.equation.content).toBe('eins\n\n zwei');
        expect(adopted.list.items).toEqual(['eins', 'zwei']);
        const many = adoptSelection(createInsertSettings(), Array.from({ length: 40 }, (_, index) => `p${index}`).join('\n'));
        expect(many.list.items).toHaveLength(30);
    });

    it('leere Auswahl ändert nichts', () => {
        const settings = createInsertSettings();
        expect(adoptSelection(settings, '  \n ')).toBe(settings);
    });
});

describe('Bildpfad', () => {
    const catalog = catalogWith({ graphicsDirectories: ['images/'] });

    it('Projektbild: relativ zum Projekt ohne das Grafikverzeichnis', () => {
        const settings = { ...createInsertSettings(), imageChoice: { kind: 'project', path: '/p/images/a.png', name: 'a.png' } as const };
        expect(imageReferenceOf(settings, catalog)).toBe('a.png');
        expect(imageReferenceOf(settings, catalogWith())).toBe('images/a.png');
    });

    it('fremdes Bild: wie es nach dem Kopieren heißen wird (bereinigter Name in images/)', () => {
        const settings = { ...createInsertSettings(), imageChoice: { kind: 'external', grantId: 'g', name: 'Mein Bild ä.PNG' } as const };
        const reference = imageReferenceOf(settings, catalogWith());
        expect(reference.startsWith('images/')).toBe(true);
        expect(reference).not.toContain(' ');
    });

    it('Windows-Wurzel mit Rückwärtsstrichen', () => {
        const settings = { ...createInsertSettings(), imageChoice: { kind: 'project', path: 'C:\\p\\bilder\\x.png', name: 'x.png' } as const };
        expect(imageReferenceOf(settings, catalogWith({ projectRoot: 'C:\\p' }))).toBe('bilder/x.png');
    });
});

describe('Blocker und Prüfung', () => {
    it('ohne .tex vorne blockiert jeder Block, der Hinweis nennt es', () => {
        for (const kind of ['table', 'code', 'equation', 'list'] as const) {
            expect(blockerOf(input(kind, createInsertSettings()), false)).toBe(INSERT_TEXTS.needsTeX);
            expect(blockerOf(input(kind, createInsertSettings()), true)).toBeNull();
        }
    });

    it('Bild braucht Auswahl und Projekt; Verweis braucht Labels; Zitat braucht Schlüssel', () => {
        expect(validationMessage(input('image', createInsertSettings()))).toBe(INSERT_TEXTS.chooseImage);
        const chosen = { ...createInsertSettings(), imageChoice: { kind: 'external', grantId: 'g', name: 'a.png' } as const };
        expect(validationMessage(input('image', chosen, EMPTY_INSERT_CATALOG))).toBe(INSERT_TEXTS.imageNeedsProject);
        expect(validationMessage(input('image', chosen))).toBeNull();
        expect(validationMessage(input('reference', createInsertSettings()))).toBe(INSERT_TEXTS.noLabels);
        expect(validationMessage(input('citation', createInsertSettings()))).toBe(INSERT_TEXTS.chooseCitation);
    });

    it('Quelle braucht keine .tex, nur zum gleichzeitigen Zitieren', () => {
        const bibliography = { path: '/p/lit.bib', name: 'lit.bib' };
        const filled = withSettings((base) => ({
            source: { ...base.source, type: 'online', authors: '', values: { title: 'Seite', url: 'https://example.com' } },
        }));
        const catalog = catalogWith({ bibliography });
        expect(blockerOf(input('source', filled, catalog), false)).toBe(INSERT_TEXTS.citeNeedsTeX);
        const withoutCite = { ...filled, sourceOptions: { citeAfterInsert: false, note: '' } };
        expect(blockerOf(input('source', withoutCite, catalog), false)).toBeNull();
        expect(blockerOf(input('source', filled, catalog), true)).toBeNull();
    });

    it('Quelle ohne Literaturdatei oder mit fehlenden Pflichtfeldern wird gemeldet', () => {
        expect(validationMessage(input('source', createInsertSettings()))).toBe(INSERT_TEXTS.noBibliography);
        const catalog = catalogWith({ bibliography: { path: '/p/lit.bib', name: 'lit.bib' } });
        expect(validationMessage(input('source', createInsertSettings(), catalog))).toContain('Bitte noch ausfüllen');
    });
});

describe('Quelle: Eintrag und Zitat', () => {
    const catalog = catalogWith({
        bibliography: { path: '/p/lit.bib', name: 'lit.bib' },
        citations: [{ key: 'Mustermann2024', summary: '', searchText: '' }],
    });
    const settings = withSettings((base) => ({
        source: {
            ...base.source, type: 'book', authors: 'Max Mustermann', values: { title: 'Ein Buch', publisher: 'Verlag', date: '2024' },
        },
        sourceOptions: { citeAfterInsert: true, note: 'S.~12' },
    }));

    it('der Schlüssel ist eindeutig gegenüber dem Index, das Zitat zeigt auf ihn', () => {
        const preview = standalonePreview(input('source', settings, catalog));
        expect(preview).toContain('@book{Mustermann2024a,');
        expect(preview).toContain('% Im Text: \\cite[S.~12]{Mustermann2024a}');
        expect(generateInsertion(input('source', settings, catalog))).toBe('\\cite[S.~12]{Mustermann2024a}');
    });

    it('ohne Zitier-Wunsch bleibt nichts für den Editor übrig', () => {
        const quiet = { ...settings, sourceOptions: { citeAfterInsert: false, note: '' } };
        expect(generateInsertion(input('source', quiet, catalog))).toBe('');
        expect(standalonePreview(input('source', quiet, catalog))).not.toContain('% Im Text');
    });
});

describe('Vorschau an Ort und Stelle', () => {
    const text = 'a\nb\n\\section{X}\nc\nd';
    const cursor = text.indexOf('\nc\n') + 1;
    const context = makeInsertionContext(text, { location: cursor, length: 0 }, 'kapitel.tex');

    it('zeigt den Block zwischen den echten Zeilen, nur die neuen Zeilen sind markiert', () => {
        const lines = previewLinesOf(input('list', createInsertSettings()), context);
        const newLines = lines.filter((line) => line.isNew).map((line) => line.text);
        expect(newLines[0]).toBe('\\begin{itemize}');
        expect(newLines.at(-1)).toBe('\\end{itemize}');
        expect(lines.find((line) => line.text === '\\section{X}')?.isNew).toBe(false);
    });

    it('Fließtext (Verweis) steht in der Cursorzeile, ohne Umgebung nur der Code', () => {
        const reference = withSettings((base) => ({ reference: { ...base.reference, label: 'fig:a' } }));
        const lines = previewLinesOf(input('reference', reference), context);
        expect(lines.some((line) => line.isNew && line.text.includes('\\ref{fig:a}'))).toBe(true);
        const plain = previewLinesOf(input('reference', reference), null);
        expect(plain).toEqual([{ number: 1, text: 'Abbildung~\\ref{fig:a}', isNew: false }]);
    });

    it('Fußzeile nennt Datei und Zeile bzw. die Literaturdatei', () => {
        expect(destinationOf(input('table', createInsertSettings()), context, null)).toBe('Einfügen in kapitel.tex, Zeile 4');
        expect(destinationOf(input('table', createInsertSettings()), null, null)).toBe(INSERT_TEXTS.defaultDestination);
        expect(destinationOf(input('source', createInsertSettings()), context, { path: '/p/l.bib', name: 'l.bib' }))
            .toBe('Neuer Eintrag in l.bib, Zitat an der Cursorposition');
    });
});
