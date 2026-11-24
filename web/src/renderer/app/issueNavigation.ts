// Meldungen des Builds ordnen (reine Funktionen, ohne DOM): nach Schwere filtern, nach Datei gruppieren, zur
// nächsten oder vorherigen Meldung gehen. Prozessprobleme (Meldungen ohne Datei) bilden eine eigene Gruppe.
import type { AbsolutePath, BuildIssue, IssueSeverity } from '../../shared/contract';
import { relativeToProject } from './pathBarData';

/** Filter-Schalter der Liste; `info` zählt zu den Warnungen */
export type IssueFilterKey = 'error' | 'warning' | 'badBox';
export type IssueFilter = Readonly<Record<IssueFilterKey, boolean>>;
export type IssueCounts = Readonly<Record<IssueFilterKey, number>>;

/** Boxen sind laut und selten ein Grund zu springen: aus, wie in der Swift-Version beim Weiterspringen */
export const DEFAULT_ISSUE_FILTER: IssueFilter = { error: true, warning: true, badBox: false };
export const EMPTY_ISSUE_COUNTS: IssueCounts = { error: 0, warning: 0, badBox: 0 };

/** Eine Meldung mit stabiler Kennung (Index im Bericht des Laufs) */
export interface IssueEntry {
    readonly key: string;
    readonly issue: BuildIssue;
}

export interface IssueGroup {
    readonly file: AbsolutePath;
    /** Pfad relativ zum Projekt, außerhalb der Dateiname */
    readonly label: string;
    /** Nur Dateien im Projekt lassen sich öffnen */
    readonly canOpen: boolean;
    readonly entries: readonly IssueEntry[];
}

export interface IssueGroups {
    readonly problems: readonly IssueEntry[];
    readonly files: readonly IssueGroup[];
}

export type IssueDirection = 'next' | 'previous';

const PATH_SEPARATORS = /[\\/]+/g;
const DRIVE_LETTER = /^[A-Za-z]:/;

export function filterKeyOf(severity: IssueSeverity): IssueFilterKey {
    if (severity === 'error') return 'error';
    return severity === 'badBox' ? 'badBox' : 'warning';
}

/** Schlüssel zum Vergleichen von Pfaden (Trenner vereinheitlicht, Laufwerksbuchstabe klein) */
export function pathKey(path: string): string {
    const normalized = path.replace(PATH_SEPARATORS, '/');
    return DRIVE_LETTER.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function entriesOf(issues: readonly BuildIssue[]): IssueEntry[] {
    return issues.map((issue, index) => ({ key: String(index), issue }));
}

export function countIssues(issues: readonly BuildIssue[]): IssueCounts {
    const counts = { error: 0, warning: 0, badBox: 0 };
    for (const issue of issues) counts[filterKeyOf(issue.severity)] += 1;
    return counts;
}

export function sameIssues(a: readonly BuildIssue[], b: readonly BuildIssue[]): boolean {
    if (a === b) return true;
    return a.length === b.length && a.every((issue, index) => {
        const other = b[index]!;
        return issue.severity === other.severity && issue.message === other.message &&
            issue.file === other.file && issue.line === other.line;
    });
}

/** Meldungen je Datei (Schlüssel `pathKey`), in Berichtsreihenfolge; Prozessprobleme ohne Datei fehlen */
export function issuesByFile(issues: readonly BuildIssue[]): ReadonlyMap<string, readonly BuildIssue[]> {
    const byFile = new Map<string, BuildIssue[]>();
    for (const issue of issues) {
        if (issue.file === null) continue;
        const key = pathKey(issue.file);
        const list = byFile.get(key);
        if (list === undefined) byFile.set(key, [issue]);
        else list.push(issue);
    }
    return byFile;
}

function labelOf(file: AbsolutePath, root: string | null): string {
    return relativeToProject(root, file) ?? file.split(/[\\/]/).at(-1) ?? file;
}

const lineOf = (entry: IssueEntry): number => entry.issue.line ?? 0;

function sortedByLine(entries: readonly IssueEntry[]): IssueEntry[] {
    return [...entries].sort((a, b) => lineOf(a) - lineOf(b) || Number(a.key) - Number(b.key));
}

function groupFiles(entries: readonly IssueEntry[], root: string | null): IssueGroup[] {
    const byFile = new Map<string, { file: AbsolutePath; entries: IssueEntry[] }>();
    for (const entry of entries) {
        const file = entry.issue.file;
        if (file === null) continue;
        const group = byFile.get(pathKey(file)) ?? { file, entries: [] };
        group.entries.push(entry);
        byFile.set(pathKey(file), group);
    }
    return [...byFile.values()].map((group) => ({
        file: group.file,
        label: labelOf(group.file, root),
        canOpen: relativeToProject(root, group.file) !== null,
        entries: sortedByLine(group.entries),
    }));
}

/** Gefilterte Meldungen: Prozessprobleme oben, danach je Datei (in Reihenfolge des ersten Auftretens) nach Zeile */
export function groupIssues(issues: readonly BuildIssue[], filter: IssueFilter, root: string | null): IssueGroups {
    const visible = entriesOf(issues).filter((entry) => filter[filterKeyOf(entry.issue.severity)]);
    return {
        problems: visible.filter((entry) => entry.issue.file === null),
        files: groupFiles(visible, root),
    };
}

/** Alle Meldungen in Anzeigereihenfolge (Prozessprobleme, dann Dateien), für die Pfeiltasten in der Liste */
export function flattenGroups(groups: IssueGroups): IssueEntry[] {
    return [...groups.problems, ...groups.files.flatMap((group) => group.entries)];
}

/** Meldungen, zu denen man springen kann: Datei im Projekt, in Anzeigereihenfolge */
export function navigableEntries(groups: IssueGroups): IssueEntry[] {
    return groups.files.filter((group) => group.canOpen).flatMap((group) => group.entries);
}

function indexOfKey(entries: readonly IssueEntry[], key: string | null): number {
    return key === null ? -1 : entries.findIndex((entry) => entry.key === key);
}

/** Nächste Meldung nach `currentKey` (am Ende wieder die erste); ohne Auswahl die erste */
export function nextIssue(entries: readonly IssueEntry[], currentKey: string | null): IssueEntry | null {
    if (entries.length === 0) return null;
    const index = indexOfKey(entries, currentKey);
    return entries[(index + 1) % entries.length] ?? null;
}

/** Vorherige Meldung vor `currentKey` (am Anfang wieder die letzte); ohne Auswahl die letzte */
export function previousIssue(entries: readonly IssueEntry[], currentKey: string | null): IssueEntry | null {
    if (entries.length === 0) return null;
    const index = indexOfKey(entries, currentKey);
    return entries[index <= 0 ? entries.length - 1 : index - 1] ?? null;
}

export function issueInDirection(
    entries: readonly IssueEntry[], currentKey: string | null, direction: IssueDirection,
): IssueEntry | null {
    return direction === 'next' ? nextIssue(entries, currentKey) : previousIssue(entries, currentKey);
}
