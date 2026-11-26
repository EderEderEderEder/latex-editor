import { trimBlanks } from '../bib/textUtils';
import { DEFAULT_INDENT, joinLines } from './floatOptions';

export type ListKind = 'itemize' | 'enumerate';

export const MAXIMUM_LIST_ITEMS = 30;
const DEFAULT_ITEM_COUNT = 3;

export interface ListSettings {
    readonly kind: ListKind;
    readonly items: readonly string[];
    readonly indent: string;
}

export function createListSettings(overrides: Partial<ListSettings> = {}): ListSettings {
    return {
        kind: 'itemize',
        items: Array.from({ length: DEFAULT_ITEM_COUNT }, () => ''),
        indent: DEFAULT_INDENT,
        ...overrides,
    };
}

/** Ändert die Zahl der Einträge (1…30), vorhandene bleiben, neue sind leer */
export function resizeList(settings: ListSettings, count: number): ListSettings {
    const target = Math.min(Math.max(Math.trunc(count), 1), MAXIMUM_LIST_ITEMS);
    return { ...settings, items: Array.from({ length: target }, (_, index) => settings.items[index] ?? '') };
}

export function generateList(settings: ListSettings): string {
    const lines = [`\\begin{${settings.kind}}`];
    for (const item of settings.items) {
        const text = trimBlanks(item);
        lines.push(`${settings.indent}\\item${text === '' ? '' : ` ${text}`}`);
    }
    lines.push(`\\end{${settings.kind}}`);
    return joinLines(lines);
}
