import { describe, expect, it } from 'vitest';
import type { BuildIssue } from '../../src/shared/contract';
import {
    DEFAULT_ISSUE_FILTER, countIssues, entriesOf, flattenGroups, groupIssues, issuesByFile, navigableEntries, nextIssue,
    pathKey, previousIssue, sameIssues,
} from '../../src/renderer/app/issueNavigation';
import type { IssueFilter } from '../../src/renderer/app/issueNavigation';

const ROOT = '/p';
const ALL: IssueFilter = { error: true, warning: true, badBox: true };

const issue = (severity: BuildIssue['severity'], file: string | null, line: number | null, message = 'm'): BuildIssue =>
    ({ severity, message, file, line });

const REPORT: readonly BuildIssue[] = [
    issue('warning', null, null, 'Prozess'),
    issue('error', '/p/b.tex', 9, 'Fehler b9'),
    issue('badBox', '/p/a.tex', 30, 'Box a30'),
    issue('warning', '/p/a.tex', 4, 'Warnung a4'),
    issue('error', '/usr/share/texmf/x.sty', 2, 'Fehler x'),
    issue('info', '/p/a.tex', 1, 'Info a1'),
];

describe('Meldungen zählen und filtern', () => {
    it('zählt Fehler, Warnungen (mit Hinweisen) und Boxen', () => {
        expect(countIssues(REPORT)).toEqual({ error: 2, warning: 3, badBox: 1 });
    });

    it('blendet nach Schwere aus; der Standard zeigt keine Boxen', () => {
        const groups = groupIssues(REPORT, DEFAULT_ISSUE_FILTER, ROOT);
        expect(flattenGroups(groups).map((entry) => entry.issue.message)).not.toContain('Box a30');
        expect(flattenGroups(groupIssues(REPORT, ALL, ROOT)).map((entry) => entry.issue.message)).toContain('Box a30');
        expect(flattenGroups(groupIssues(REPORT, { error: false, warning: false, badBox: false }, ROOT))).toEqual([]);
    });
});

describe('Gruppieren nach Datei', () => {
    it('stellt Prozessprobleme (ohne Datei) voran, danach Dateien in Reihenfolge des ersten Auftretens', () => {
        const groups = groupIssues(REPORT, ALL, ROOT);
        expect(groups.problems.map((entry) => entry.issue.message)).toEqual(['Prozess']);
        expect(groups.files.map((group) => group.file)).toEqual(['/p/b.tex', '/p/a.tex', '/usr/share/texmf/x.sty']);
    });

    it('sortiert innerhalb der Datei nach Zeile und benennt relativ zum Projekt', () => {
        const [, a] = groupIssues(REPORT, ALL, ROOT).files;
        expect(a!.label).toBe('a.tex');
        expect(a!.entries.map((entry) => entry.issue.line)).toEqual([1, 4, 30]);
    });

    it('Dateien außerhalb des Projekts lassen sich nicht öffnen und zählen nicht für die Navigation', () => {
        const groups = groupIssues(REPORT, ALL, ROOT);
        expect(groups.files.map((group) => group.canOpen)).toEqual([true, true, false]);
        expect(navigableEntries(groups).map((entry) => entry.issue.file)).not.toContain('/usr/share/texmf/x.sty');
    });

    it('ohne Projektwurzel ist nichts öffnbar', () => {
        expect(groupIssues(REPORT, ALL, null).files.every((group) => !group.canOpen)).toBe(true);
    });

    it('Windows-Pfade mit anderem Trenner und Laufwerksbuchstaben gehören zur selben Datei', () => {
        const byFile = issuesByFile([issue('error', 'C:\\P\\a.tex', 1), issue('error', 'c:/P/a.tex', 2)]);
        expect(byFile.get(pathKey('C:/P/a.tex'))).toHaveLength(2);
    });
});

describe('nächste und vorherige Meldung', () => {
    const entries = navigableEntries(groupIssues(REPORT, DEFAULT_ISSUE_FILTER, ROOT));

    it('Reihenfolge ist die der Anzeige (Datei für Datei, nach Zeile)', () => {
        expect(entries.map((entry) => entry.issue.message)).toEqual(['Fehler b9', 'Info a1', 'Warnung a4']);
    });

    it('ohne Auswahl: erste beim Weiterspringen, letzte beim Zurückspringen', () => {
        expect(nextIssue(entries, null)).toBe(entries[0]);
        expect(previousIssue(entries, null)).toBe(entries[2]);
    });

    it('läuft am Ende um', () => {
        expect(nextIssue(entries, entries[2]!.key)).toBe(entries[0]);
        expect(previousIssue(entries, entries[0]!.key)).toBe(entries[2]);
        expect(nextIssue(entries, entries[0]!.key)).toBe(entries[1]);
        expect(previousIssue(entries, entries[2]!.key)).toBe(entries[1]);
    });

    it('unbekannte Auswahl (ausgeblendet) verhält sich wie keine; leere Liste liefert null', () => {
        expect(nextIssue(entries, 'x')).toBe(entries[0]);
        expect(nextIssue([], null)).toBeNull();
        expect(previousIssue([], 'x')).toBeNull();
    });

    it('Einträge tragen den Index im Bericht als Kennung', () => {
        expect(entriesOf(REPORT).map((entry) => entry.key)).toEqual(['0', '1', '2', '3', '4', '5']);
    });
});

describe('sameIssues', () => {
    it('vergleicht den Inhalt, nicht die Identität', () => {
        expect(sameIssues(REPORT, REPORT.map((entry) => ({ ...entry })))).toBe(true);
        expect(sameIssues(REPORT, REPORT.slice(1))).toBe(false);
        expect(sameIssues([issue('error', null, null, 'a')], [issue('error', null, null, 'b')])).toBe(false);
    });
});
