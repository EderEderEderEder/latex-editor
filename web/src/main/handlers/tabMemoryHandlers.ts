import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import type { TabMemory } from '../../shared/contract';
import { IpcFailure } from '../../shared/ipcResult';
import type { GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';
import { isTabMemory } from '../ipcValidation';
import { projectHash, type RealpathFunction, resolveRealPath } from '../paths';
import { readTextFile, writeTextFile } from '../textIo';

// Tab-Gedächtnis je Projekt (W2-4): `<userData>/tabs/<Projekt-Hash>.json`, atomar geschrieben. Das Projekt kennt der
// Main (`GrantStore.currentProject`), der Renderer nennt es nie. Eine unlesbare oder fremde Datei ergibt „kein
// Gedächtnis“ (`null`), nie einen Fehler: das Gedächtnis ist Komfort und darf das Öffnen eines Projekts nicht stören.

export const TAB_MEMORY_DIRECTORY = 'tabs';

export const TAB_MEMORY_MESSAGES = {
    invalid: 'Ungültiges Tab-Gedächtnis',
} as const;

export interface TabMemoryStoreOptions {
    readonly userDataDir: string;
    readonly grants: GrantStore;
    readonly realpath?: RealpathFunction;
}

export type TabMemoryHandlers = Pick<IpcHandlers, 'tabs:memoryLoad' | 'tabs:memorySave'>;

function parseMemory(text: string): TabMemory | null {
    try {
        const raw: unknown = JSON.parse(text);
        return isTabMemory(raw) ? raw : null;
    } catch {
        return null;
    }
}

export class TabMemoryStore {
    private writing: Promise<unknown> = Promise.resolve();

    constructor(private readonly options: TabMemoryStoreOptions) {}

    private async fileOf(projectRoot: string): Promise<string> {
        const { grants, realpath, userDataDir } = this.options;
        const platform = grants.platform;
        const resolved = await resolveRealPath(projectRoot, realpath === undefined ? { platform } : { platform, realpath });
        return join(userDataDir, TAB_MEMORY_DIRECTORY, `${projectHash(resolved, platform)}.json`);
    }

    async load(): Promise<TabMemory | null> {
        const root = this.options.grants.currentProject;
        if (root === null) return null;
        try {
            return parseMemory((await readTextFile(await this.fileOf(root))).text);
        } catch (error) {
            if (error instanceof IpcFailure && error.error.kind === 'notFound') return null;
            throw error;
        }
    }

    async save(memory: TabMemory): Promise<void> {
        if (!isTabMemory(memory)) throw new IpcFailure({ kind: 'invalidInput', message: TAB_MEMORY_MESSAGES.invalid });
        const root = this.options.grants.requireProject();
        // Hintereinander, damit ein spätes Schreiben den neueren Stand nicht überholt.
        const run = this.writing.then(() => this.write(root, memory));
        this.writing = run.catch(() => undefined);
        return run;
    }

    private async write(projectRoot: string, memory: TabMemory): Promise<void> {
        const file = await this.fileOf(projectRoot);
        await fsp.mkdir(join(this.options.userDataDir, TAB_MEMORY_DIRECTORY), { recursive: true });
        await writeTextFile(file, JSON.stringify(memory, null, 4), 'utf8', 'lf');
    }
}

export function createTabMemoryHandlers(store: TabMemoryStore): TabMemoryHandlers {
    return {
        'tabs:memoryLoad': () => store.load(),
        'tabs:memorySave': (memory) => store.save(memory),
    };
}
