// Wählt den Preload des Hauptfensters. Der Stub-Preload (gefälschte `window.api`-Antworten) dient nur
// den Playwright-Tests und ist im gepackten Programm nicht vorhanden; der Schalter gilt dort nie.

export const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const STUB_PRELOAD_ENABLED = '1';

export interface PreloadChoiceInput {
    readonly isPackaged: boolean;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly realPath: string;
    readonly stubPath: string;
}

export function choosePreloadPath({ isPackaged, env, realPath, stubPath }: PreloadChoiceInput): string {
    if (isPackaged) return realPath;
    return env[STUB_PRELOAD_ENV] === STUB_PRELOAD_ENABLED ? stubPath : realPath;
}
