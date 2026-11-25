// Kleines Kontextmenü (WAI-ARIA `menu`): an einer Bildschirmstelle, Pfeiltasten/Pos1/Ende wandern, Enter/Leertaste
// wählen, Escape, Tab und Klick daneben schließen. Beim Schließen geht der Fokus dorthin zurück, wo er vorher war.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useDismiss } from './FileTypeMenu';
import type { ContextMenuItem } from './contextMenuItem';
export type { ContextMenuItem } from './contextMenuItem';
import './dialogs/dialogs.css';

export interface ContextMenuProps {
    readonly x: number;
    readonly y: number;
    readonly label: string;
    readonly items: readonly ContextMenuItem[];
    readonly onClose: () => void;
    /** Bekommt nach dem Schließen den Fokus zurück */
    readonly returnFocus?: HTMLElement | null;
}

const VIEWPORT_MARGIN_PX = 4;

type Item = Extract<ContextMenuItem, { kind: 'item' }>;

function enabledIndexes(items: readonly ContextMenuItem[]): number[] {
    return items.flatMap((item, index) => (item.kind === 'item' && item.disabled !== true ? [index] : []));
}

/** Nächster wählbarer Eintrag in Richtung `step` (zyklisch) */
function nextIndex(items: readonly ContextMenuItem[], current: number, step: 1 | -1): number {
    const enabled = enabledIndexes(items);
    if (enabled.length === 0) return -1;
    const position = enabled.indexOf(current);
    if (position < 0) return step === 1 ? (enabled[0] ?? -1) : (enabled.at(-1) ?? -1);
    return enabled[(position + step + enabled.length) % enabled.length] ?? -1;
}

/** Hält das Menü im Fenster (rechts/unten nicht abgeschnitten) */
function useClampedPosition(ref: RefObject<HTMLDivElement | null>, x: number, y: number) {
    const [position, setPosition] = useState({ left: x, top: y });
    useLayoutEffect(() => {
        const element = ref.current;
        if (element === null) return;
        const { width, height } = element.getBoundingClientRect();
        const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN_PX));
        const top = Math.max(VIEWPORT_MARGIN_PX, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN_PX));
        setPosition({ left, top });
    }, [ref, x, y]);
    return position;
}

function menuKeyAction(event: KeyboardEvent, items: readonly ContextMenuItem[], active: number): number | 'close' | null {
    switch (event.key) {
        case 'ArrowDown': return nextIndex(items, active, 1);
        case 'ArrowUp': return nextIndex(items, active, -1);
        case 'Home': return nextIndex(items, -1, 1);
        case 'End': return nextIndex(items, -1, -1);
        case 'Tab': return 'close';
        default: return null;
    }
}

function MenuEntry({ item, index, active, choose }: { item: Item; index: number; active: number; choose: (item: Item) => void }) {
    return (
        <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            data-index={index}
            tabIndex={index === active ? 0 : -1}
            disabled={item.disabled === true}
            onClick={() => choose(item)}
        >
            <span>{item.label}</span>
            {item.shortcut !== undefined && <span className="context-menu-shortcut" aria-hidden="true">{item.shortcut}</span>}
        </button>
    );
}

export function ContextMenu({ x, y, label, items, onClose, returnFocus }: ContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(() => nextIndex(items, -1, 1));
    const position = useClampedPosition(ref, x, y);
    const close = useCallback((): void => {
        onClose();
        returnFocus?.focus();
    }, [onClose, returnFocus]);
    useDismiss(ref, true, close);
    useEffect(() => {
        ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
    }, [active]);
    const choose = (item: Item): void => {
        close();
        item.onSelect();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        const action = menuKeyAction(event, items, active);
        if (action === null) return;
        event.preventDefault();
        if (action === 'close') close();
        else setActive(action);
    };
    return (
        <div ref={ref} className="context-menu" role="menu" aria-label={label} style={position} onKeyDown={onKeyDown}>
            {items.map((item, index) =>
                item.kind === 'separator'
                    ? <div key={`separator-${index}`} role="separator" className="context-menu-separator" />
                    : <MenuEntry key={item.label} item={item} index={index} active={active} choose={choose} />,
            )}
        </div>
    );
}
