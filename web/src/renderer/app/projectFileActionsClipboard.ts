// „Pfad kopieren“ im Kontextmenü des Dateibaums: kopiert den Pfad relativ zum Projekt mit `/` (so, wie er in
// `\input{…}` oder `\includegraphics{…}` steht). Erst die Zwischenablage-API; lehnt Electron sie ab (Berechtigungen
// sind gesperrt, `main/security.ts`), hilft `execCommand('copy')` aus der Nutzeraktion heraus.
import type { AbsolutePath } from '../../shared/contract';
import type { ProjectFileActionDeps } from './projectFileActionsCore';
import { nameOf, relativeToRoot } from './projectFileActionsNames';

export const CLIPBOARD_TEXTS = {
    copied: (path: string) => `Pfad kopiert: ${path}`,
    failed: 'Der Pfad ließ sich nicht in die Zwischenablage kopieren.',
} as const;

export type WriteClipboard = (text: string) => Promise<boolean>;

function copyWithTextarea(text: string): boolean {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let copied = false;
    try {
        copied = document.execCommand('copy');
    } finally {
        area.remove();
        focused?.focus();
    }
    return copied;
}

export const writeClipboardText: WriteClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return copyWithTextarea(text);
    }
};

export async function copyEntryPath(
    deps: Pick<ProjectFileActionDeps, 'project' | 'report'>, path: AbsolutePath, write: WriteClipboard = writeClipboardText,
): Promise<boolean> {
    const root = deps.project.getState().current?.root;
    const relative = root === undefined ? null : relativeToRoot(root, path);
    const text = relative === null || relative === '' ? nameOf(path) : relative;
    const copied = await write(text);
    deps.report(copied ? { text: CLIPBOARD_TEXTS.copied(text), kind: 'info' } : { text: CLIPBOARD_TEXTS.failed, kind: 'error' });
    return copied;
}
