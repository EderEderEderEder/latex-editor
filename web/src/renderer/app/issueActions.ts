// Sprung zu einer Meldung: öffnet die Datei und setzt den Cursor an die Zeile (`revealLine`). Meldungen ohne Datei
// (Prozessprobleme) und Dateien außerhalb des Projekts haben kein Ziel.
import type { BuildStore } from '../stores/build';
import type { IssueDirection, IssueEntry } from './issueNavigation';
import { revealLine } from './revealLine';
import type { RevealDeps } from './revealLine';

const FIRST_LINE = 1;

export async function openIssue(deps: RevealDeps, build: Pick<BuildStore, 'getState'>, entry: IssueEntry): Promise<void> {
    build.getState().select(entry.key);
    const { file, line } = entry.issue;
    if (file === null) return;
    await revealLine(deps, file, line ?? FIRST_LINE);
}

/** F8 / Umschalt+F8: wählt die nächste oder vorherige Meldung und springt hin */
export async function goToIssue(deps: RevealDeps, build: Pick<BuildStore, 'getState'>, direction: IssueDirection): Promise<void> {
    const target = build.getState().navigate(direction);
    if (target === null) return;
    await openIssue(deps, build, target);
}
