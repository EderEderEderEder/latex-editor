import { constants } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { IpcFailure } from '../shared/ipcResult';
import { sanitizedName } from '../shared/core/insertion/sanitizedName';
import { checkImportSource, IMAGE_IMPORT_RULES, type ImportSourceDependencies, type ImportSourceRules } from './grants';
import { arePathsEqual, normalizeAbsolutePath, type PathPlatform, resolveRealPath } from './paths';

// Bild-Import (W4-9, Port von `ImageImport` aus der Swift-Version): kopiert eine gewährte Bilddatei ins
// Grafikverzeichnis des Projekts. Gleicher Inhalt → vorhandene Datei weiterverwenden, anderer Inhalt →
// `-2`, `-3` …; nie überschreiben. Die Quelle wird nur gelesen. Wie in Swift nur, was pdfLaTeX einbinden kann.

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.pdf']);
export const IMAGE_COPY_RULES: ImportSourceRules = { extensions: IMAGE_EXTENSIONS, maxBytes: IMAGE_IMPORT_RULES.maxBytes };

const FIRST_DUPLICATE_NUMBER = 2;
const MAX_NAME_ATTEMPTS = 1000;

export const IMAGE_IMPORT_MESSAGES = {
    unsupported: (name: string) => `„${name}“ hat ein Format, das pdfLaTeX nicht einbinden kann. Erlaubt sind PNG, JPG und PDF.`,
    noFreeName: 'Kein freier Dateiname im Bilderordner',
    notADirectory: (path: string) => `Der Ordner „${path}“ konnte nicht angelegt werden.`,
} as const;

export interface ImageImportDependencies {
    readonly platform: PathPlatform;
    readonly realpath?: ImportSourceDependencies['realpath'];
    readonly stat?: ImportSourceDependencies['stat'];
}

function failure(kind: 'invalidInput' | 'io' | 'alreadyExists', message: string): IpcFailure {
    return new IpcFailure({ kind, message });
}

function errorCode(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function isRegularFile(path: string): Promise<boolean> {
    try {
        return (await fsp.lstat(path)).isFile();
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return false;
        throw error;
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await fsp.lstat(path);
        return true;
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return false;
        throw error;
    }
}

async function hasSameContent(first: string, second: string): Promise<boolean> {
    const [firstStat, secondStat] = await Promise.all([fsp.stat(first), fsp.stat(second)]);
    if (firstStat.size !== secondStat.size) return false;
    const [firstBytes, secondBytes] = await Promise.all([fsp.readFile(first), fsp.readFile(second)]);
    return firstBytes.equals(secondBytes);
}

function candidateName(name: string, attempt: number, platform: PathPlatform): string {
    if (attempt === 0) return name;
    const { name: stem, ext } = platform.path.parse(name);
    return `${stem}-${attempt + FIRST_DUPLICATE_NUMBER - 1}${ext}`;
}

export interface ImportedImage {
    readonly path: string;
    readonly reused: boolean;
}

// Kopiert mit `COPYFILE_EXCL`: Ein Treffer im selben Augenblick (anderer Prozess) ergibt den nächsten Namen
// statt eines Überschreibens.
async function copyToFreeName(source: string, directory: string, deps: ImageImportDependencies): Promise<ImportedImage> {
    const { path } = deps.platform;
    const baseName = sanitizedName(path.basename(source));
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
        const target = path.join(directory, candidateName(baseName, attempt, deps.platform));
        if (await exists(target)) {
            if ((await isRegularFile(target)) && (await hasSameContent(target, source))) return { path: target, reused: true };
            continue;
        }
        try {
            await fsp.copyFile(source, target, constants.COPYFILE_EXCL);
            return { path: target, reused: false };
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') throw error;
        }
    }
    throw failure('alreadyExists', IMAGE_IMPORT_MESSAGES.noFreeName);
}

async function ensureDirectory(directory: string): Promise<void> {
    try {
        await fsp.mkdir(directory, { recursive: true });
    } catch {
        throw failure('io', IMAGE_IMPORT_MESSAGES.notADirectory(directory));
    }
}

// `source`: gewährter Pfad (Gewährung hat der Handler geprüft); `imagesDir`: bereits als „im Projekt“ geprüfter,
// aufgelöster Pfad. Liefert den Zielpfad; der Handler macht daraus den Projektpfad.
export async function importImage(source: string, imagesDir: string, deps: ImageImportDependencies): Promise<ImportedImage> {
    const { platform } = deps;
    const sourceName = platform.path.basename(source);
    if (!IMAGE_EXTENSIONS.has(platform.path.extname(sourceName).toLowerCase())) {
        throw failure('invalidInput', IMAGE_IMPORT_MESSAGES.unsupported(sourceName));
    }
    const real = await checkImportSource(source, IMAGE_COPY_RULES, deps);
    const directory = normalizeAbsolutePath(imagesDir, platform);
    await ensureDirectory(directory);
    const realDirectory = await resolveRealPath(directory, { platform, realpath: deps.realpath });
    if (arePathsEqual(platform.path.dirname(real), realDirectory, platform)) return { path: real, reused: true };
    return copyToFreeName(real, realDirectory, deps);
}
