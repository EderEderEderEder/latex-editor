import type { ReadManyItem, TextFile } from '../../shared/contract';
import { fail, IpcFailure, ok, toIpcError } from '../../shared/ipcResult';
import type { GrantKind, GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';
import { isGrantId } from '../ipcValidation';
import { type RealpathFunction, resolveRealPath } from '../paths';
import { readTextFile, type TextIoOptions, writeTextFile } from '../textIo';

// Text-Dateien lesen und schreiben (H1). Das Ziel ist entweder
// - ein absoluter Pfad, der (nach Auflösen der Symlinks) im aktuellen Projekt des Main liegt, oder
// - die `GrantId` einer Datei aus `dialog:pickFiles`/`dialog:saveAs` (bzw. Drop, nur lesen).
// Beide Formen sind Strings und überschneiden sich nicht: Eine `GrantId` enthält weder Trenner noch `:`.
// Im Ergebnis steht immer das Ziel, das der Renderer geschickt hat (`path`, Schlüssel seiner Sitzung), dazu der
// Anzeigename (`name`), damit er den Pfad einer gewährten Datei nie erfährt.

export interface FsHandlerDependencies {
    readonly grants: GrantStore;
    readonly realpath?: RealpathFunction;
    readonly textIo?: TextIoOptions;
}

export type FsHandlers = Pick<IpcHandlers, 'fs:readText' | 'fs:readMany' | 'fs:writeText'>;

type Access = 'read' | 'write';

const GRANT_KINDS_BY_ACCESS: Readonly<Record<Access, readonly GrantKind[]>> = {
    read: ['pickedFile', 'saveTarget', 'importSource'],
    write: ['pickedFile', 'saveTarget'],
};

export const FS_MESSAGES = {
    parentSegment: 'Pfade mit „..“ sind nicht erlaubt',
} as const;

const PATH_SEPARATORS = /[\\/]/;
const PARENT_SEGMENT = '..';

// Der Renderer schickt Pfade aus dem Projektbaum; `..` hat dort nichts zu suchen, auch wenn es im
// Projekt bliebe.
function rejectParentSegments(target: string): void {
    if (target.split(PATH_SEPARATORS).includes(PARENT_SEGMENT)) {
        throw new IpcFailure({ kind: 'forbiddenPath', message: FS_MESSAGES.parentSegment });
    }
}

// Beim Schreiben wird der gewährte Pfad aufgelöst (N2): Das atomare Umbenennen ersetzte sonst einen Symlink
// durch eine normale Datei. Geprüft bleibt die Gewährung des gewählten Pfads; Projektpfade liefert
// `assertInProject` bereits aufgelöst (und prüft dabei das Ziel des Symlinks).
async function resolveGrantTarget(target: string, access: Access, deps: FsHandlerDependencies): Promise<string> {
    const granted = deps.grants.resolveOneOf(target, GRANT_KINDS_BY_ACCESS[access]);
    if (access === 'read') return granted;
    const { platform } = deps.grants;
    return resolveRealPath(granted, deps.realpath === undefined ? { platform } : { platform, realpath: deps.realpath });
}

// Liefert den echten Dateipfad oder wirft `forbiddenPath` (bzw. `notFound` ohne Projekt).
export async function resolveFileTarget(target: string, access: Access, deps: FsHandlerDependencies): Promise<string> {
    if (isGrantId(target)) return resolveGrantTarget(target, access, deps);
    rejectParentSegments(target);
    return deps.grants.assertInProject(target, deps.realpath);
}

function lastSegment(path: string): string {
    return path.split(PATH_SEPARATORS).filter((segment) => segment.length > 0).at(-1) ?? path;
}

// Anzeigename mit Endung: bei einer Kennung der Name des gewählten Pfads (nicht des Symlink-Ziels), sonst der
// letzte Teil des Projektpfads. Unbekannte Kennungen behalten ihren Text (der Renderer kennt ihn ohnehin).
function displayNameOf(target: string, deps: FsHandlerDependencies): string {
    if (!isGrantId(target)) return lastSegment(target);
    try {
        return lastSegment(deps.grants.resolveOneOf(target, GRANT_KINDS_BY_ACCESS.read));
    } catch {
        return target;
    }
}

async function readText(target: string, deps: FsHandlerDependencies): Promise<TextFile> {
    const file = await readTextFile(await resolveFileTarget(target, 'read', deps));
    return { ...file, path: target, name: displayNameOf(target, deps) };
}

// Nacheinander statt parallel: viele gleichzeitige Öffnungen laufen unter Windows in `EMFILE`.
async function readMany(targets: readonly string[], deps: FsHandlerDependencies): Promise<ReadManyItem[]> {
    const items: ReadManyItem[] = [];
    for (const target of targets) {
        const name = displayNameOf(target, deps);
        try {
            items.push({ path: target, name, result: ok(await readText(target, deps)) });
        } catch (error) {
            items.push({ path: target, name, result: fail(toIpcError(error)) });
        }
    }
    return items;
}

export function createFsHandlers(deps: FsHandlerDependencies): FsHandlers {
    return {
        'fs:readText': (target) => readText(target, deps),
        'fs:readMany': (targets) => readMany(targets, deps),
        'fs:writeText': async (target, text, encoding, eol, expectedHash) => {
            const path = await resolveFileTarget(target, 'write', deps);
            return writeTextFile(path, text, encoding, eol, expectedHash, deps.textIo);
        },
    };
}
