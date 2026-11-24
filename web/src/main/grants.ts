import { randomUUID } from 'node:crypto';
import { realpath as nativeRealpath, stat as nativeStat } from 'node:fs/promises';
import type { DropGrantResult, GrantedPath, GrantId } from '../shared/contract';
import { IpcFailure } from '../shared/ipcResult';
import {
    assertInsideProject,
    comparisonKey,
    isUncPath,
    normalizeAbsolutePath,
    type PathPlatform,
    type RealpathFunction,
} from './paths';

// Gewährungen des Main-Prozesses (Befund H1 aus docs/REVIEW-M0.md): Der Renderer kann dem Main nie
// behaupten, woher ein Pfad stammt. Pfade außerhalb des Projekts kennt er nur als Kennung, die der Main
// selbst vergeben hat (Dialog, Zuletzt geöffnet, Drag & Drop); das aktuelle Projekt hält der Main.
// Ohne Electron, Kennungen und Dateisystem sind einspeisbar.

// project: darf mit `project:open` geöffnet werden; importSource: darf nur gelesen und ins Projekt
// kopiert werden; saveTarget: Ziel aus „Speichern unter“; pickedFile: im Dialog „Dateien wählen“
// ausgesuchte Datei (lesen und zurückschreiben, z. B. Einzeldatei ohne Projekt).
export type GrantKind = 'project' | 'importSource' | 'saveTarget' | 'pickedFile';

// Eine Kennung je Pfad: Wer denselben Pfad mehrfach gewährt bekommt (zweimal geöffnet, „Speichern unter“ auf
// eine offene Datei), erhält dieselbe Kennung, damit der Renderer „schon offen“ erkennt. Die Arten sammeln sich;
// jede davon hat der Main für genau diesen Pfad selbst vergeben.
interface Grant {
    readonly kinds: Set<GrantKind>;
    readonly path: string;
    readonly key: string;
}

export interface GrantStoreOptions {
    readonly platform: PathPlatform;
    readonly createId?: () => GrantId;
    readonly maxGrants?: number;
}

// Obergrenze gegen unbegrenztes Wachstum; die ältesten Kennungen verfallen zuerst.
export const MAX_GRANTS = 10_000;

export const GRANT_MESSAGES = {
    unknownGrant: 'Unbekannte oder abgelaufene Freigabe',
    noProject: 'Kein Projekt geöffnet',
} as const;

function forbidden(message: string): IpcFailure {
    return new IpcFailure({ kind: 'forbiddenPath', message });
}

export class GrantStore {
    private readonly grants = new Map<GrantId, Grant>();
    private readonly idsByKey = new Map<string, GrantId>();
    private projectRoot: string | null = null;
    readonly platform: PathPlatform;
    private readonly createId: () => GrantId;
    private readonly maxGrants: number;

    constructor(options: GrantStoreOptions) {
        this.platform = options.platform;
        this.createId = options.createId ?? randomUUID;
        this.maxGrants = options.maxGrants ?? MAX_GRANTS;
    }

    // Nur Main-Code ruft das auf, mit Pfaden aus Dialogen, der Liste „Zuletzt geöffnet“ oder geprüften Drops.
    grant(input: string, kind: GrantKind): GrantedPath {
        const path = normalizeAbsolutePath(input, this.platform);
        const key = comparisonKey(path, this.platform);
        const grantId = this.idsByKey.get(key) ?? this.createId();
        const kinds = this.grants.get(grantId)?.kinds ?? new Set<GrantKind>();
        kinds.add(kind);
        // Neu einreihen: eine wieder gewährte Kennung verfällt als letzte.
        this.grants.delete(grantId);
        this.grants.set(grantId, { kinds, path, key });
        this.idsByKey.set(key, grantId);
        this.dropOldest();
        return { grantId, name: this.platform.path.basename(path) || path };
    }

    // Liefert den gewährten Pfad, aber nur für die passende Art; sonst `forbiddenPath`.
    resolve(grantId: GrantId, kind: GrantKind): string {
        return this.resolveOneOf(grantId, [kind]);
    }

    // Wie `resolve`, aber für eine von mehreren zulässigen Arten (z. B. Lesen aus Dialog oder Drop).
    resolveOneOf(grantId: GrantId, kinds: readonly GrantKind[]): string {
        const grant = this.grants.get(grantId);
        if (grant === undefined || !kinds.some((kind) => grant.kinds.has(kind))) throw forbidden(GRANT_MESSAGES.unknownGrant);
        return grant.path;
    }

    openProject(grantId: GrantId): string {
        const root = this.resolve(grantId, 'project');
        this.projectRoot = root;
        return root;
    }

    closeProject(): void {
        this.projectRoot = null;
    }

    get currentProject(): string | null {
        return this.projectRoot;
    }

    requireProject(): string {
        if (this.projectRoot === null) throw new IpcFailure({ kind: 'notFound', message: GRANT_MESSAGES.noProject });
        return this.projectRoot;
    }

    // Für jeden Pfad vom Renderer: liegt er (aufgelöst) im aktuellen Projekt?
    async assertInProject(candidate: string, realpath?: RealpathFunction): Promise<string> {
        const options = realpath === undefined ? { platform: this.platform } : { platform: this.platform, realpath };
        return assertInsideProject(candidate, this.requireProject(), options);
    }

    private dropOldest(): void {
        while (this.grants.size > this.maxGrants) {
            const oldest = this.grants.entries().next().value;
            if (oldest === undefined) return;
            this.grants.delete(oldest[0]);
            this.idsByKey.delete(oldest[1].key);
        }
    }
}

// ---------- Importquellen (Dialog „Dateien wählen“, Drag & Drop) ----------

export interface ImportSourceRules {
    // Kleingeschrieben mit Punkt, z. B. `.png`
    readonly extensions: ReadonlySet<string>;
    readonly maxBytes: number;
}

const MEGABYTE = 1024 * 1024;
const MAX_IMAGE_MEGABYTES = 50;
const MAX_FILE_MEGABYTES = 100;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg'];
const TEXT_EXTENSIONS = ['.tex', '.bib', '.sty', '.cls', '.bst', '.txt', '.csv', '.dat'];

export const IMAGE_IMPORT_RULES: ImportSourceRules = {
    extensions: new Set(IMAGE_EXTENSIONS),
    maxBytes: MAX_IMAGE_MEGABYTES * MEGABYTE,
};

export const FILE_IMPORT_RULES: ImportSourceRules = {
    extensions: new Set([...IMAGE_EXTENSIONS, ...TEXT_EXTENSIONS]),
    maxBytes: MAX_FILE_MEGABYTES * MEGABYTE,
};

export interface FileStatLike {
    isFile(): boolean;
    readonly size: number;
}

export interface ImportSourceDependencies {
    readonly platform: PathPlatform;
    readonly realpath?: RealpathFunction;
    readonly stat?: (target: string) => Promise<FileStatLike>;
}

export const IMPORT_MESSAGES = {
    network: 'Netzwerkpfade (UNC) lassen sich nicht importieren',
    extension: (name: string) => `Dateityp nicht erlaubt: ${name}`,
    notAFile: (name: string) => `Keine Datei: ${name}`,
    tooLarge: (name: string) => `Datei zu groß: ${name}`,
} as const;

function invalidSource(message: string): IpcFailure {
    return new IpcFailure({ kind: 'invalidInput', message });
}

function checkExtension(path: string, rules: ImportSourceRules, platform: PathPlatform): void {
    const extension = platform.path.extname(path).toLowerCase();
    if (!rules.extensions.has(extension)) throw invalidSource(IMPORT_MESSAGES.extension(platform.path.basename(path)));
}

// Prüft eine Quelle vor dem Gewähren und vor dem Kopieren: kein UNC (vor jedem Dateizugriff), erlaubte
// Endung (auch nach dem Auflösen von Symlinks), reguläre Datei, Größengrenze. Liefert den aufgelösten Pfad.
export async function checkImportSource(
    input: string,
    rules: ImportSourceRules,
    dependencies: ImportSourceDependencies,
): Promise<string> {
    const { platform } = dependencies;
    const normalized = normalizeAbsolutePath(input, platform);
    if (isUncPath(normalized, platform)) throw invalidSource(IMPORT_MESSAGES.network);
    checkExtension(normalized, rules, platform);
    const real = normalizeAbsolutePath(await (dependencies.realpath ?? nativeRealpath)(normalized), platform);
    if (isUncPath(real, platform)) throw invalidSource(IMPORT_MESSAGES.network);
    checkExtension(real, rules, platform);
    const info = await (dependencies.stat ?? nativeStat)(real);
    const name = platform.path.basename(real);
    if (!info.isFile()) throw invalidSource(IMPORT_MESSAGES.notAFile(name));
    if (info.size > rules.maxBytes) throw invalidSource(IMPORT_MESSAGES.tooLarge(name));
    return real;
}

function displayName(input: string, platform: PathPlatform): string {
    return platform.path.basename(input) || input;
}

// Drag & Drop: jede Datei wird geprüft und als Importquelle gewährt; abgelehnte nur mit Namen zurück.
export async function grantDroppedPaths(
    store: GrantStore,
    paths: readonly string[],
    dependencies: ImportSourceDependencies,
): Promise<DropGrantResult> {
    const granted: GrantedPath[] = [];
    const rejected: string[] = [];
    for (const path of paths) {
        try {
            const real = await checkImportSource(path, FILE_IMPORT_RULES, dependencies);
            granted.push(store.grant(real, 'importSource'));
        } catch {
            rejected.push(displayName(path, dependencies.platform));
        }
    }
    return { granted, rejected };
}
