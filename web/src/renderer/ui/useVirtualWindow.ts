import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { computeVirtualWindow } from '../app/virtualWindow';
import type { VirtualWindow } from '../app/virtualWindow';

const EMPTY_WINDOW: VirtualWindow = { start: 0, end: 0, totalHeight: 0 };

function sameWindow(a: VirtualWindow, b: VirtualWindow): boolean {
    return a.start === b.start && a.end === b.end && a.totalHeight === b.totalHeight;
}

interface VirtualListOptions {
    readonly rowHeight: number;
    readonly rowCount: number;
    readonly overscan: number;
}

/** Sichtfenster einer Liste mit fester Zeilenhöhe; rendert neu nur, wenn sich die Zeilen im Fenster ändern */
export function useVirtualWindow(ref: RefObject<HTMLElement | null>, options: VirtualListOptions): VirtualWindow {
    const { rowHeight, rowCount, overscan } = options;
    const [visible, setVisible] = useState<VirtualWindow>(EMPTY_WINDOW);
    const update = useCallback((): void => {
        const element = ref.current;
        if (element === null) return;
        const next = computeVirtualWindow({
            scrollTop: element.scrollTop, viewportHeight: element.clientHeight, rowHeight, rowCount, overscan,
        });
        setVisible((previous) => (sameWindow(previous, next) ? previous : next));
    }, [ref, rowHeight, rowCount, overscan]);
    useLayoutEffect(update, [update]);
    useEffect(() => {
        const element = ref.current;
        if (element === null) return undefined;
        element.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => {
            element.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, [ref, update]);
    return visible;
}
