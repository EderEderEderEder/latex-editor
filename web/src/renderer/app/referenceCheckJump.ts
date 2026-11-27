// Strg-Klick-Ziele öffnen (W4-13, Vorlage `AppModel.jump(to:)` in Swift): Label, Quelle und Abkürzung aus dem Ergebnis des
// Index-Workers (`ReferenceSnapshot`), Dateien aus dem Projektbaum. Gibt es das Ziel nicht (Tippfehler im Schlüssel),
// erscheint eine Meldung in der Statusleiste statt des Pieptons von Swift. Reine Abläufe mit Fakes testbar, ohne DOM.
import { fileCandidates, type JumpFileTarget, type JumpTarget } from '../../shared/core/jumpTargets';
import { problemMessage } from '../../shared/core/latex/referenceCheck';
import type { StatusMessage } from '../stores/status';
import type { ProjectFiles } from './completionIndexLogic';
import { pathKey } from './issueNavigation';
import type { ReferenceSnapshot } from './referenceCheckLogic';

export type JumpOutcome = 'opened' | 'notFound' | 'noProject';

export interface JumpFlowDeps {
    readonly references: () => ReferenceSnapshot;
    readonly project: () => ProjectFiles | null;
    /** Öffnet die Datei und setzt den Cursor an die Zeile (1-basiert) */
    readonly reveal: (path: string, line: number) => Promise<void>;
    readonly report: (message: StatusMessage) => void;
}

export const JUMP_TEXTS = {
    noProject: 'Kein Projekt offen: Strg-Klick-Ziele gibt es nur in Projektdateien.',
    fileNotFound: (path: string) => `Die Datei „${path}“ gibt es im Projekt nicht.`,
} as const;

const FIRST_LINE = 1;
const SEPARATORS = /\\/g;

function directoryOf(path: string): string {
    const normalized = path.replace(SEPARATORS, '/');
    return normalized.slice(0, Math.max(0, normalized.lastIndexOf('/')));
}

/** Ordner, in denen ein Pfad im Text gesucht wird: Hauptdatei zuerst, dann Projektwurzel, dann die Datei selbst */
function searchBases(project: ProjectFiles, fromPath: string): string[] {
    const bases = [project.mainFile === null ? null : directoryOf(project.mainFile), project.root.replace(SEPARATORS, '/'), directoryOf(fromPath)];
    return [...new Set(bases.filter((base): base is string => base !== null && base !== ''))];
}

/** Projektdatei zu einem Pfad im Text (mit und ohne Endung, bei Bildern auch mit `\graphicspath`), sonst `null` */
export function resolveProjectFile(
    target: JumpFileTarget, project: ProjectFiles, fromPath: string, graphicsDirectories: readonly string[],
): string | null {
    const known = new Map(project.files.map((file) => [pathKey(file), file]));
    const candidates = fileCandidates(target, { bases: searchBases(project, fromPath), graphicsDirectories });
    for (const candidate of candidates) {
        const found = known.get(pathKey(candidate));
        if (found !== undefined) return found;
    }
    return null;
}

async function followFile(deps: JumpFlowDeps, target: JumpFileTarget, fromPath: string): Promise<JumpOutcome> {
    const project = deps.project();
    if (project === null) {
        deps.report({ text: JUMP_TEXTS.noProject, kind: 'info' });
        return 'noProject';
    }
    const file = resolveProjectFile(target, project, fromPath, deps.references().graphicsDirectories);
    if (file === null) {
        deps.report({ text: JUMP_TEXTS.fileNotFound(target.path), kind: 'info' });
        return 'notFound';
    }
    await deps.reveal(file, FIRST_LINE);
    return 'opened';
}

interface Definition {
    readonly file: string;
    readonly line: number;
}

function definitionOf(references: ReferenceSnapshot, target: Exclude<JumpTarget, JumpFileTarget>): Definition | undefined {
    switch (target.kind) {
        case 'label': return references.labels.find((entry) => entry.label === target.key);
        case 'citation': return references.sources.find((entry) => entry.key === target.key);
        case 'acronym': return references.acronyms.find((entry) => entry.key === target.key);
    }
}

const UNKNOWN_KIND = { label: 'unknownLabel', citation: 'unknownCitation', acronym: 'unknownAcronym' } as const;

/** Springt zum Ziel: Definition bzw. Datei; ohne Ziel eine Meldung */
export async function followJumpTarget(deps: JumpFlowDeps, target: JumpTarget, fromPath: string): Promise<JumpOutcome> {
    if (target.kind === 'file') return followFile(deps, target, fromPath);
    const references = deps.references();
    if (!references.loaded) {
        deps.report({ text: JUMP_TEXTS.noProject, kind: 'info' });
        return 'noProject';
    }
    const definition = definitionOf(references, target);
    if (definition === undefined) {
        deps.report({ text: problemMessage(UNKNOWN_KIND[target.kind], target.key), kind: 'info' });
        return 'notFound';
    }
    await deps.reveal(definition.file, definition.line);
    return 'opened';
}
