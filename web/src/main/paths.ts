import { createHash } from 'node:crypto';
import { realpath as nativeRealpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IpcFailure } from '../shared/ipcResult';

// Reine Pfadlogik ohne Electron. Jede Funktion bekommt die Plattform als Parameter, damit
// Windows-Fälle (`path.win32`) auch unter macOS in Vitest prüfbar sind.

// `path.posix` und `path.win32` haben dieselbe Form; @types/node nennt sie nicht eigens.
export type PathModule = typeof path.posix;

export interface PathPlatform {
    readonly path: PathModule;
    readonly windows: boolean;
    // NTFS und APFS (Standard) unterscheiden Groß-/Kleinschreibung nicht, ext4 schon.
    readonly caseSensitive: boolean;
}

export const WINDOWS_PATHS: PathPlatform = { path: path.win32, windows: true, caseSensitive: false };
export const MACOS_PATHS: PathPlatform = { path: path.posix, windows: false, caseSensitive: false };
export const LINUX_PATHS: PathPlatform = { path: path.posix, windows: false, caseSensitive: true };

export type RealpathFunction = (target: string) => Promise<string>;

export interface RealPathOptions {
    readonly platform?: PathPlatform;
    // Standard: `fs/promises.realpath`, gleiche Semantik wie `fs.realpath.native`, aber asynchron.
    readonly realpath?: RealpathFunction;
}

const HASH_ALGORITHM = 'sha256';
const MAX_PATH_DEPTH = 512;
const FILE_PROTOCOL = 'file:';
const MISSING_PATH_ERRORS: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);
const WINDOWS_DRIVE_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
// UNC `\\server\share`, aber keine Gerätepfade `\\?\…` oder `\\.\…`.
const WINDOWS_UNC = /^[\\/]{2}[^\\/?.]/;
const WINDOWS_LONG_UNC_PREFIX = /^\\\\\?\\UNC\\/i;
const WINDOWS_LONG_PREFIX = /^\\\\\?\\(?=[a-zA-Z]:\\)/;

export function currentPathPlatform(platform: NodeJS.Platform = process.platform): PathPlatform {
    if (platform === 'win32') return WINDOWS_PATHS;
    if (platform === 'darwin') return MACOS_PATHS;
    return LINUX_PATHS;
}

function invalidPath(message: string): IpcFailure {
    return new IpcFailure({ kind: 'invalidInput', message });
}

function stripWindowsLongPrefix(input: string): string {
    if (WINDOWS_LONG_UNC_PREFIX.test(input)) return input.replace(WINDOWS_LONG_UNC_PREFIX, '\\\\');
    return input.replace(WINDOWS_LONG_PREFIX, '');
}

function isAcceptedAbsolute(input: string, platform: PathPlatform): boolean {
    if (!platform.windows) return input.startsWith('/');
    return WINDOWS_DRIVE_ABSOLUTE.test(input) || WINDOWS_UNC.test(input);
}

function trimTrailingSeparator(normalized: string, platform: PathPlatform): string {
    const root = platform.path.parse(normalized).root;
    if (normalized === root) return normalized;
    return normalized.endsWith(platform.path.sep) ? normalized.slice(0, -1) : normalized;
}

function uppercaseDriveLetter(normalized: string, platform: PathPlatform): string {
    if (!platform.windows || !WINDOWS_DRIVE_ABSOLUTE.test(normalized)) return normalized;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// Lexikalische Normalisierung: Trenner, `.`/`..`, Laufwerksbuchstabe groß, kein Schluss-Trenner.
// Groß-/Kleinschreibung bleibt für die Anzeige erhalten (Vergleiche über `comparisonKey`).
export function normalizeAbsolutePath(input: unknown, platform: PathPlatform): string {
    if (typeof input !== 'string' || input.length === 0) throw invalidPath('Pfad fehlt');
    if (input.includes('\0')) throw invalidPath('Pfad enthält ein Nullzeichen');
    const prepared = platform.windows ? stripWindowsLongPrefix(input) : input;
    if (!isAcceptedAbsolute(prepared, platform)) throw invalidPath(`Kein absoluter Pfad: ${input}`);
    const normalized = platform.path.normalize(prepared);
    return uppercaseDriveLetter(trimTrailingSeparator(normalized, platform), platform);
}

// Schlüssel für Vergleiche: normalisiert, Unicode NFC (macOS liefert Umlaute als NFD) und
// je nach Plattform kleingeschrieben.
export function comparisonKey(input: string, platform: PathPlatform): string {
    const normalized = normalizeAbsolutePath(input, platform).normalize('NFC');
    return platform.caseSensitive ? normalized : normalized.toLowerCase();
}

export function arePathsEqual(first: string, second: string, platform: PathPlatform): boolean {
    return comparisonKey(first, platform) === comparisonKey(second, platform);
}

// Rein lexikalisch: liegt `candidate` gleich `root` oder darunter? Symlinks prüft `isInsideProject`.
export function isPathWithin(candidate: string, root: string, platform: PathPlatform): boolean {
    const candidateKey = comparisonKey(candidate, platform);
    const rootKey = comparisonKey(root, platform);
    if (candidateKey === rootKey) return true;
    const separator = platform.path.sep;
    const prefix = rootKey.endsWith(separator) ? rootKey : rootKey + separator;
    return candidateKey.startsWith(prefix);
}

function errorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}

async function tryRealpath(target: string, resolve: RealpathFunction): Promise<string | null> {
    try {
        return await resolve(target);
    } catch (error) {
        if (MISSING_PATH_ERRORS.has(errorCode(error) ?? '')) return null;
        throw error;
    }
}

// Löst Symlinks (und unter Windows 8.3-Namen) auf. Fehlt der Pfad noch (z. B. Ziel von
// „Neue Datei“), wird der nächste vorhandene Vorfahr aufgelöst und der Rest angehängt.
export async function resolveRealPath(input: string, options: RealPathOptions = {}): Promise<string> {
    const platform = options.platform ?? currentPathPlatform();
    const resolve = options.realpath ?? nativeRealpath;
    const normalized = normalizeAbsolutePath(input, platform);
    const missingSegments: string[] = [];
    let current = normalized;
    for (let depth = 0; depth < MAX_PATH_DEPTH; depth++) {
        const real = await tryRealpath(current, resolve);
        if (real !== null) {
            const joined = platform.path.join(real, ...missingSegments.reverse());
            return normalizeAbsolutePath(joined, platform);
        }
        const parent = platform.path.dirname(current);
        if (parent === current) break;
        missingSegments.push(platform.path.basename(current));
        current = parent;
    }
    return normalized;
}

// Entscheidend sind die aufgelösten Pfade: ein Symlink im Projekt, der hinaus zeigt, zählt als außerhalb.
export async function isInsideProject(
    candidate: string,
    projectRoot: string,
    options: RealPathOptions = {},
): Promise<boolean> {
    const platform = options.platform ?? currentPathPlatform();
    const [realCandidate, realRoot] = await Promise.all([
        resolveRealPath(candidate, options),
        resolveRealPath(projectRoot, options),
    ]);
    return isPathWithin(realCandidate, realRoot, platform);
}

export async function assertInsideProject(
    candidate: string,
    projectRoot: string,
    options: RealPathOptions = {},
): Promise<string> {
    if (await isInsideProject(candidate, projectRoot, options)) return resolveRealPath(candidate, options);
    throw new IpcFailure({ kind: 'forbiddenPath', message: `Pfad liegt nicht im Projekt: ${candidate}` });
}

// Schlüssel für den App-Datenordner (Markierungen, Wiederherstellung). Den Projektpfad vorher
// mit `resolveRealPath` auflösen, damit Symlink und Ziel denselben Hash bekommen.
export function projectHash(projectRoot: string, platform: PathPlatform): string {
    return createHash(HASH_ALGORITHM).update(comparisonKey(projectRoot, platform), 'utf8').digest('hex');
}

export function pathToFileUrl(input: string, platform: PathPlatform): string {
    const normalized = normalizeAbsolutePath(input, platform);
    return pathToFileURL(normalized, { windows: platform.windows }).href;
}

export function fileUrlToPath(url: string, platform: PathPlatform): string {
    if (!URL.canParse(url) || new URL(url).protocol !== FILE_PROTOCOL) {
        throw invalidPath(`Keine file:-URL: ${url}`);
    }
    let converted: string;
    try {
        // Wirft z. B. bei einem Host in einer POSIX-URL oder bei kodierten Trennern.
        converted = fileURLToPath(url, { windows: platform.windows });
    } catch {
        throw invalidPath(`file:-URL lässt sich nicht in einen Pfad umwandeln: ${url}`);
    }
    return normalizeAbsolutePath(converted, platform);
}
