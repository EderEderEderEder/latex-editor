// Schnittstelle zwischen Preload und Seite (nur Typen, von beiden importiert).
export interface SpikeConfig {
    readonly pdfPath: string;
    readonly allowedDirectory: string;
    readonly outsidePath: string;
    readonly pageName: string;
    readonly csp: string;
}

export interface SpikeApi {
    readonly isContextIsolated: boolean;
    readonly isSandboxed: boolean;
    readonly getConfig: () => Promise<SpikeConfig>;
    readonly getPathForFile: (file: File) => string;
    readonly readPdf: (path: string) => Promise<ArrayBuffer>;
    readonly clipboardRead: () => Promise<string>;
    readonly clipboardWrite: (text: string) => Promise<void>;
}

declare global {
    interface Window {
        spike: SpikeApi;
    }
}
