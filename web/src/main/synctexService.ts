import { stat as nativeStat } from 'node:fs/promises';
import type { AbsolutePath } from '../shared/contract';
import type { EventSender } from './ipc';
import { type PathPlatform, type RealpathFunction, resolveRealPath } from './paths';
import { pathPlatformName } from './synctex';
import { type SyncTeXBackend, SyncTeXClientError } from './synctexClient';

// Nachladen der SyncTeX-Daten nach einem Build bzw. beim Projektöffnen (wie Swift `SyncTeXStore.reload`): gesucht
// wird `<Name>.synctex.gz`, sonst `<Name>.synctex` neben Hauptdatei bzw. PDF. Schlägt das Laden fehl (Datei fehlt,
// ist unvollständig, weil der Build noch schreibt, oder beschädigt), behält der Worker die bisherigen Daten.
// Nach Erfolg geht `synctex:ready` mit der Änderungszeit des PDFs an den Renderer.

export const SYNCTEX_EXTENSIONS = ['.synctex.gz', '.synctex'] as const;
const PDF_EXTENSION = '.pdf';

export type PdfStat = (target: string) => Promise<{ readonly mtimeMs: number }>;

export interface SyncTeXServiceOptions {
    readonly backend: SyncTeXBackend;
    readonly platform: PathPlatform;
    readonly emit: EventSender;
    readonly log: (message: string) => void;
    readonly stat?: PdfStat | undefined;
    readonly realpath?: RealpathFunction | undefined;
}

export const SYNCTEX_SERVICE_MESSAGES = {
    loadFailed: (detail: string) => `SyncTeX nicht neu geladen, die bisherigen Daten bleiben: ${detail}`,
    pdfMissing: (detail: string) => `SyncTeX geladen, aber das PDF fehlt: ${detail}`,
} as const;

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
    return error instanceof SyncTeXClientError && error.error.kind === 'notFound';
}

export class SyncTeXService {
    // Zählt Projektwechsel: ein Laden, das vor dem Wechsel begann, meldet danach nichts mehr.
    private projectGeneration = 0;
    private loaded = false;

    constructor(private readonly options: SyncTeXServiceOptions) {}

    /** Gibt es Daten für das aktuelle Projekt? Ohne liefern die Suchen `null`. */
    get hasData(): boolean {
        return this.loaded;
    }

    /** Projektwechsel: die Daten des alten Projekts gelten nicht mehr */
    reset(): void {
        this.projectGeneration++;
        this.loaded = false;
        this.options.backend.forget();
    }

    /** `sibling`: Hauptdatei oder PDF; `true`, wenn neue Daten geladen und gemeldet sind. Wirft nie. */
    async reloadBeside(sibling: AbsolutePath): Promise<boolean> {
        const generation = this.projectGeneration;
        const { dir, name } = this.options.platform.path.parse(sibling);
        const base = this.options.platform.path.join(dir, name);
        const loaded = await this.loadFirstAvailable(base);
        if (!loaded || generation !== this.projectGeneration) return false;
        this.loaded = true;
        await this.announce(base + PDF_EXTENSION, generation);
        return true;
    }

    private async loadFirstAvailable(base: string): Promise<boolean> {
        const platformName = pathPlatformName(this.options.platform);
        for (const extension of SYNCTEX_EXTENSIONS) {
            try {
                const file = await resolveRealPath(base + extension, this.realPathOptions());
                await this.options.backend.load(file, platformName);
                return true;
            } catch (error) {
                if (isNotFound(error)) continue;
                this.options.log(SYNCTEX_SERVICE_MESSAGES.loadFailed(describeError(error)));
                return false;
            }
        }
        return false;
    }

    private async announce(pdfPath: string, generation: number): Promise<void> {
        try {
            const { mtimeMs } = await (this.options.stat ?? nativeStat)(pdfPath);
            if (generation === this.projectGeneration) this.options.emit('synctex:ready', { pdfMtime: mtimeMs });
        } catch (error) {
            this.options.log(SYNCTEX_SERVICE_MESSAGES.pdfMissing(describeError(error)));
        }
    }

    private realPathOptions(): { platform: PathPlatform; realpath?: RealpathFunction } {
        const { platform, realpath } = this.options;
        return realpath === undefined ? { platform } : { platform, realpath };
    }
}
