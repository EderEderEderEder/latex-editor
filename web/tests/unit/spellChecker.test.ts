import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { beforeAll, describe, expect, it } from 'vitest';
import { withoutCompoundOnlyEntries } from '../../src/shared/core/spelling/dictionaryCleanup';
import { MAX_SUGGESTIONS, SpellChecker } from '../../src/shared/core/spelling/spellChecker';
import type { Hunspell } from '../../src/shared/core/spelling/spellChecker';
import { checkText, SPELL_SERVICE_TEXTS, SpellService } from '../../src/shared/core/spelling/spellService';
import type { SpellResponse } from '../../src/shared/core/spelling/spellProtocol';
import { getStandardVocabulary } from '../../src/shared/core/spelling/technicalVocabulary';

// Prüfstufen mit dem echten Wörterbuch `dictionary-de-at` (W7-2): Fälle aus Spike S8 (`spikes/spell/src/corpus.ts`).

const DICTIONARY_DIRECTORY = new URL('../../node_modules/dictionary-de-at/', import.meta.url);
const AFFIX = readFileSync(fileURLToPath(new URL('index.aff', DICTIONARY_DIRECTORY)), 'utf8');
const DICTIONARY = readFileSync(fileURLToPath(new URL('index.dic', DICTIONARY_DIRECTORY)), 'utf8');
/** Aufbau dauert ~0,5–0,8 s je Wörterbuch */
const LOAD_TIMEOUT_MS = 20_000;

/** Richtig geschriebene Zusammensetzungen aus Abschlussarbeiten (Spike: 30/30 erkannt) */
const VALID_COMPOUNDS = [
    'Rechtschreibprüfung', 'Literaturverwaltung', 'Zeitschriftenaufsatz', 'Hochschulbibliothek', 'Softwareentwicklung',
    'Datenbankabfrage', 'Benutzeroberfläche', 'Arbeitsspeicher', 'Universitätsbibliothek', 'Fehlermeldung',
    'Abschlussarbeit', 'Quellcodeverwaltung', 'Tastaturkürzel', 'Textsatzsystem', 'Bachelorarbeit',
    'Versionsverwaltung', 'Forschungsfrage', 'Literaturverzeichnis', 'Abbildungsverzeichnis', 'Messergebnisse',
    'Entwicklungsumgebung', 'Anwendungsfall', 'Programmiersprache', 'Betriebssystem', 'Dateisystem',
    'Schreibtischlampe', 'Kundenzufriedenheitsumfrage', 'Speicherverbrauch', 'Ladezeit', 'Netzwerkzugriff',
];

/** Tippfehler in Zusammensetzungen (Spike: 10/10 gemeldet) */
const INVALID_COMPOUNDS = [
    'Rechtschreibprüfnug', 'Literaturverwaltnug', 'Fehlermeldnug', 'Hochschulbiblothek', 'Softwareentwiklung',
    'Datenbankabfarge', 'Benutzeroberfäche', 'Arbietsspeicher', 'Abschlusarbeit', 'Tastaturkürzle',
];

let hunspell: Hunspell;
let checker: SpellChecker;

function encode(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

beforeAll(() => {
    hunspell = nspell(AFFIX, withoutCompoundOnlyEntries(AFFIX, DICTIONARY).dictionary);
    checker = new SpellChecker(hunspell, getStandardVocabulary());
}, LOAD_TIMEOUT_MS);

describe('Wörterbuch-Bereinigung (nspell-Fehler mit ONLYINCOMPOUND)', () => {
    it('entfernt nur Einträge mit dem ONLYINCOMPOUND-Flag', () => {
        const affix = 'SET UTF-8\nONLYINCOMPOUND o\n';
        const result = withoutCompoundOnlyEntries(affix, '3\ngehen/DIVXW\ngehen/Sozm\nHaus/S');
        expect(result).toEqual({ dictionary: '3\ngehen/DIVXW\nHaus/S', removedEntries: 1 });
        expect(withoutCompoundOnlyEntries('SET UTF-8', '1\nHaus')).toEqual({ dictionary: '1\nHaus', removedEntries: 0 });
    });

    it('danach kennt nspell `gehen`, `stehen`, `prüfen`, `zählen` wieder', () => {
        for (const word of ['gehen', 'stehen', 'prüfen', 'zählen']) expect(hunspell.correct(word), word).toBe(true);
    });
});

describe('Stufen der Prüfung', () => {
    it('erkennt alle 30 richtigen Zusammensetzungen und meldet alle 10 Tippfehler', () => {
        expect(VALID_COMPOUNDS.filter((word) => !checker.isCorrect(word))).toEqual([]);
        expect(INVALID_COMPOUNDS.filter((word) => checker.isCorrect(word))).toEqual([]);
    });

    it('österreichische Wörter, Satzanfang, ß und Umlaute', () => {
        for (const word of ['Jänner', 'Matura', 'Paradeiser', 'Straße', 'größere', 'Die', 'Gleichung']) {
            expect(checker.isCorrect(word), word).toBe(true);
        }
        expect(checker.isCorrect('Rechtschreibfeler')).toBe(false);
    });

    it('Fachvokabular (`TechnicalVocabulary.accepts` mit nspell als Systemprüfung)', () => {
        const withoutVocabulary = new SpellChecker(hunspell, null);
        for (const word of ['Surjektion', 'Monoid', 'Adjazenzmatrix', 'Jacobimatrix']) {
            expect(hunspell.correct(word), word).toBe(false);
            expect(checker.verdict(word), word).toBe('vocabulary');
            expect(withoutVocabulary.verdict(word), word).toBe('unknown');
        }
    });

    it('Abkürzung mit Punkt wird mit Punkt nachgefragt', () => {
        expect(checker.isCorrect('bzw', true)).toBe(true);
        expect(checker.isCorrect('bzw', false)).toBe(false);
    });

    it('Zusatzwörter: genau, am Satzanfang großgeschrieben, auch als Teil einer Zusammensetzung', () => {
        const own = new SpellChecker(hunspell, null);
        expect(own.isCorrect('kubectl')).toBe(false);
        own.setExtraWords(['kubectl', 'Electron']);
        expect(own.isCorrect('kubectl')).toBe(true);
        expect(own.isCorrect('Kubectl')).toBe(true);
        expect(own.isCorrect('electron')).toBe(false);
        expect(own.isCorrect('Electronanwendung')).toBe(true);
        own.setExtraWords([]);
        expect(own.isCorrect('kubectl')).toBe(false);
    });

    it('Vorschläge: höchstens sechs, nicht das Wort selbst', () => {
        const suggestions = checker.suggest('Literatr');
        expect(suggestions).toContain('Literatur');
        expect(suggestions).not.toContain('Literatr');
        expect(suggestions.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    });
});

describe('checkText: Syntaxfilter, Vokabular und Zerlegung zusammen', () => {
    it('meldet nur echte Tippfehler mit absoluter Lage', () => {
        const text = '\\section{Einleitnug} Die Bachelorarbeit über \\textbf{Eigenwertprobleme} hat einen Tipfehler. $\\alpha$ % Komentar';
        const { errors } = checkText(checker, { language: 'latex', text, offset: 10, startState: 'normal' });
        const words = errors.map(([from, to]) => text.slice(from - 10, to - 10));
        expect(words).toEqual(['Einleitnug', 'Tipfehler']);
    });

    it('Bindestrich: bekanntes Ganzes gilt, sonst je Teil', () => {
        const text = 'E-Mail Daten-Bankk';
        const { errors } = checkText(checker, { language: 'latex', text, offset: 0, startState: 'normal' });
        expect(errors.map(([from, to]) => text.slice(from, to))).toEqual(['Bankk']);
    });
});

describe('SpellService (Worker ohne Hülle)', () => {
    it('lädt lazy, prüft, schlägt vor und übernimmt Zusatzwörter', () => {
        const service = new SpellService((affix, dictionary) => nspell(affix, dictionary));
        const before = service.handle({ kind: 'check', id: 1, language: 'latex', text: 'Haus', offset: 0, startState: 'normal' });
        expect(before).toEqual({ kind: 'failed', id: 1, message: SPELL_SERVICE_TEXTS.notLoaded, fatal: false });
        expect(service.handle({ kind: 'words', words: ['Tipfehlr'] })).toBeNull();
        const ready = service.handle({ kind: 'load', affix: encode(AFFIX), dictionary: encode(DICTIONARY) });
        expect(ready).toMatchObject({ kind: 'ready' });
        expect((ready as Extract<SpellResponse, { kind: 'ready' }>).removedEntries).toBeGreaterThan(20_000);
        const check = service.handle({ kind: 'check', id: 2, language: 'latex', text: 'Ein Tipfehlr und Fehlr', offset: 0, startState: 'normal' });
        expect(check).toEqual({ kind: 'check', id: 2, errors: [[17, 22]], words: 4 });
        const suggest = service.handle({ kind: 'suggest', id: 3, word: 'Fehlr' });
        expect(suggest).toMatchObject({ kind: 'suggest', id: 3 });
    }, LOAD_TIMEOUT_MS);

    it('Ladefehler ist endgültig (`fatal`) und wirft nicht', () => {
        const service = new SpellService(() => {
            throw new Error('kaputt');
        });
        const response = service.handle({ kind: 'load', affix: encode(''), dictionary: encode('') });
        expect(response).toEqual({ kind: 'failed', id: null, message: SPELL_SERVICE_TEXTS.loadFailed('kaputt'), fatal: true });
    });
});
