import * as fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ContentHash, EpochMillis, RecoveryDiskState } from '../shared/contract';
import { IpcFailure } from '../shared/ipcResult';
import { isFiniteNumber, isNonEmptyString, isString, objectOf } from './ipcValidation';
import type { Guard } from './ipcValidation';
import { arePathsEqual, type PathPlatform, projectHash } from './paths';
import { readTextFile, type TextIoOptions, writeTextFile } from './textIo';

// Sicherung ungespeicherten Texts (W2-14, Vorbild Swift `RecoveryStore`): je Datei eine JSON-Datei
// `<userData>/recovery/<Hash des Pfads>.json`, atomar geschrieben (Temp + Umbenennen). Der Dateiname enthält nie den
// Pfad. Eine Sicherung merkt den Hash der Plattendatei zum Zeitpunkt des Sicherns, damit die Nachfrage nach einem
// Absturz eine inzwischen geänderte Datei erkennt. Ohne Electron, ohne GrantStore: Pfade kommen aufgelöst herein.

export const RECOVERY_DIRECTORY = 'recovery';
export const RECOVERY_VERSION = 1;
const BACKUP_EXTENSION = '.json';

export interface RecoveryBackup {
    readonly version: typeof RECOVERY_VERSION;
    /** Echter, aufgelöster Pfad der Datei */
    readonly path: string;
    readonly name: string;
    readonly text: string;
    readonly savedAt: EpochMillis;
    /** Hash der Plattendatei beim Sichern; `null`, wenn sie fehlte oder nicht lesbar war */
    readonly diskHash: ContentHash | null;
    /** Projekt, zu dem die Datei beim Sichern gehörte; `null` für Dateien außerhalb (Dialog) */
    readonly projectRoot: string | null;
    /** App-Lauf, der die Sicherung geschrieben hat */
    readonly runId: string;
}

export interface BackupInput {
    readonly path: string;
    readonly text: string;
    readonly savedAt: EpochMillis;
    readonly projectRoot: string | null;
}

export interface PendingBackup {
    readonly backup: RecoveryBackup;
    readonly diskState: RecoveryDiskState;
}

export interface RecoveryStoreOptions {
    readonly userDataDir: string;
    readonly platform: PathPlatform;
    /** Sicherungen mit dieser Kennung bietet `pending` nicht an (sie gehören zum laufenden App-Lauf) */
    readonly runId?: string;
    readonly textIo?: TextIoOptions;
}

const isVersion: Guard<typeof RECOVERY_VERSION> = (value): value is typeof RECOVERY_VERSION => value === RECOVERY_VERSION;
const isNullableString: Guard<string | null> = (value): value is string | null => value === null || isString(value);
const isRecoveryBackup: Guard<RecoveryBackup> = objectOf({
    version: isVersion,
    path: isNonEmptyString,
    name: isNonEmptyString,
    text: isString,
    savedAt: isFiniteNumber,
    diskHash: isNullableString,
    projectRoot: isNullableString,
    runId: isNonEmptyString,
});

function parseBackup(text: string): RecoveryBackup | null {
    try {
        const raw: unknown = JSON.parse(text);
        return isRecoveryBackup(raw) ? raw : null;
    } catch {
        return null;
    }
}

async function diskHashOf(path: string): Promise<ContentHash | null> {
    try {
        return (await readTextFile(path)).hash;
    } catch {
        return null;
    }
}

interface StoredFile {
    readonly file: string;
    readonly backup: RecoveryBackup;
}

export class RecoveryStore {
    readonly runId: string;
    private readonly directory: string;
    // Schreiben, Löschen und Aufräumen laufen hintereinander, damit ein spätes Schreiben nie ein Löschen überholt.
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly options: RecoveryStoreOptions) {
        this.runId = options.runId ?? randomUUID();
        this.directory = join(options.userDataDir, RECOVERY_DIRECTORY);
    }

    fileOf(path: string): string {
        return join(this.directory, `${projectHash(path, this.options.platform)}${BACKUP_EXTENSION}`);
    }

    write(input: BackupInput): Promise<void> {
        return this.enqueue(() => this.writeNow(input));
    }

    remove(path: string): Promise<void> {
        return this.enqueue(() => fsp.rm(this.fileOf(path), { force: true }));
    }

    /**
     * Sicherungen früherer App-Läufe für dieses Projekt (`null`: keins offen) und für Dateien außerhalb von Projekten.
     * Ist der gesicherte Text gleich dem der Platte, ist die Sicherung veraltet und wird dabei gelöscht.
     */
    pending(projectRoot: string | null): Promise<PendingBackup[]> {
        return this.enqueue(() => this.pendingNow(projectRoot));
    }

    /** Alle lesbaren Sicherungen; kaputte oder fremde Dateien werden übergangen (und bleiben liegen) */
    async readAll(): Promise<RecoveryBackup[]> {
        return (await this.readStored()).map((stored) => stored.backup);
    }

    private enqueue<T>(job: () => Promise<T>): Promise<T> {
        const run = this.queue.then(job);
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async writeNow(input: BackupInput): Promise<void> {
        const backup: RecoveryBackup = {
            version: RECOVERY_VERSION,
            path: input.path,
            name: this.options.platform.path.basename(input.path) || input.path,
            text: input.text,
            savedAt: input.savedAt,
            diskHash: await diskHashOf(input.path),
            projectRoot: input.projectRoot,
            runId: this.runId,
        };
        await fsp.mkdir(this.directory, { recursive: true });
        await writeTextFile(this.fileOf(input.path), JSON.stringify(backup), 'utf8', 'lf', undefined, this.options.textIo);
    }

    private async readStored(): Promise<StoredFile[]> {
        const names = await fsp.readdir(this.directory).catch(() => [] as string[]);
        const stored: StoredFile[] = [];
        for (const name of names.filter((entry) => entry.endsWith(BACKUP_EXTENSION) && !entry.startsWith('.'))) {
            const file = join(this.directory, name);
            const backup = parseBackup(await fsp.readFile(file, 'utf8').catch(() => ''));
            if (backup !== null) stored.push({ file, backup });
        }
        return stored;
    }

    private belongsTo(backup: RecoveryBackup, projectRoot: string | null): boolean {
        if (backup.projectRoot === null) return true;
        return projectRoot !== null && arePathsEqual(backup.projectRoot, projectRoot, this.options.platform);
    }

    private async pendingNow(projectRoot: string | null): Promise<PendingBackup[]> {
        const offered: PendingBackup[] = [];
        for (const { file, backup } of await this.readStored()) {
            if (backup.runId === this.runId || !this.belongsTo(backup, projectRoot)) continue;
            const diskState = await this.compareWithDisk(backup);
            if (diskState === 'stale') await fsp.rm(file, { force: true });
            else offered.push({ backup, diskState });
        }
        return offered.sort((a, b) => a.backup.path.localeCompare(b.backup.path));
    }

    private async compareWithDisk(backup: RecoveryBackup): Promise<RecoveryDiskState | 'stale'> {
        try {
            const disk = await readTextFile(backup.path);
            if (disk.text === backup.text) return 'stale';
            return disk.hash === backup.diskHash ? 'unchanged' : 'changed';
        } catch (error) {
            const missing = error instanceof IpcFailure && error.error.kind === 'notFound';
            return missing ? 'missing' : 'changed';
        }
    }
}
