// Daten der Tab-Leiste aus dem Editor-Store (nur Metadaten, nie Text).
import type { AbsolutePath } from '../../shared/contract';
import type { TabsState } from '../../shared/core/tabs';
import type { TabInfo } from '../stores/editor';
import { fileNameOf } from './statusText';

export interface TabBarItem {
    readonly path: AbsolutePath;
    readonly title: string;
    /** Tooltip: der Projektpfad, bei Dialog-Dateien (Schlüssel ist eine `GrantId`) nur der Name */
    readonly hint: string;
    readonly isActive: boolean;
    /** Vorschau-Tab: Titel kursiv */
    readonly isPreview: boolean;
    readonly isDirty: boolean;
}

const PATH_SEPARATOR = /[\\/]/;

function hintFor(path: AbsolutePath, title: string): string {
    return PATH_SEPARATOR.test(path) ? path : title;
}

export function buildTabBarItems(tabs: TabsState, files: Readonly<Record<AbsolutePath, TabInfo>>): TabBarItem[] {
    return tabs.items.map((path) => {
        const title = files[path]?.title ?? fileNameOf(path);
        return {
            path,
            title,
            hint: hintFor(path, title),
            isActive: path === tabs.active,
            isPreview: path === tabs.preview,
            isDirty: files[path]?.isDirty ?? false,
        };
    });
}

export function closeConfirmationText(title: string): string {
    return `„${title}“ hat ungespeicherte Änderungen. Trotzdem schließen? Die Änderungen gehen verloren.`;
}
