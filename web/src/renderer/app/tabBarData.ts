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
    /** Beschriftung des Schließen-Knopfs */
    readonly closeLabel: string;
}

export const TAB_DIRTY_LABEL = 'Ungespeicherte Änderungen';
export type TabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
const NAVIGATION_KEYS: ReadonlySet<string> = new Set<TabNavigationKey>(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

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
            closeLabel: `„${title}“ schließen`,
        };
    });
}

export function isTabNavigationKey(key: string): key is TabNavigationKey {
    return NAVIGATION_KEYS.has(key);
}

/** Ziel einer Pfeil-/Pos1-/Ende-Taste in der Tab-Leiste (Pfeile laufen am Rand herum); `null` ohne Wirkung */
export function tabAfterKey(items: readonly TabBarItem[], from: AbsolutePath, key: TabNavigationKey): AbsolutePath | null {
    const index = items.findIndex((item) => item.path === from);
    if (index < 0) return null;
    const count = items.length;
    const target = { ArrowLeft: (index + count - 1) % count, ArrowRight: (index + 1) % count, Home: 0, End: count - 1 }[key];
    return items[target]?.path ?? null;
}

export interface ScrollRange {
    readonly start: number;
    readonly size: number;
}

/** Neue Scrollposition, damit der Tab ganz sichtbar ist; unverändert, wenn er es schon ist (größere Tabs zeigen den Anfang) */
export function scrollLeftToReveal(view: ScrollRange, tab: ScrollRange): number {
    if (tab.start < view.start) return Math.max(0, tab.start);
    const overflow = tab.start + tab.size - (view.start + view.size);
    if (overflow <= 0) return view.start;
    return Math.min(view.start + overflow, tab.start);
}
