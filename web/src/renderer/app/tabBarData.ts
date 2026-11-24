// Daten der Tab-Leiste aus dem Editor-Store (nur Metadaten, nie Text).
import type { AbsolutePath } from '../../shared/contract';
import type { TabsState } from '../../shared/core/tabs';
import type { TabInfo } from '../stores/editor';
import { fileNameOf } from './statusText';

export interface TabBarItem {
    readonly path: AbsolutePath;
    readonly title: string;
    readonly isActive: boolean;
    /** Vorschau-Tab: Titel kursiv */
    readonly isPreview: boolean;
    readonly isDirty: boolean;
}

export function buildTabBarItems(tabs: TabsState, files: Readonly<Record<AbsolutePath, TabInfo>>): TabBarItem[] {
    return tabs.items.map((path) => ({
        path,
        title: files[path]?.title ?? fileNameOf(path),
        isActive: path === tabs.active,
        isPreview: path === tabs.preview,
        isDirty: files[path]?.isDirty ?? false,
    }));
}

export function closeConfirmationText(title: string): string {
    return `„${title}“ hat ungespeicherte Änderungen. Trotzdem schließen? Die Änderungen gehen verloren.`;
}
