// Rahmen der Seitenleiste mit ziehbarem Teiler (180–480 px, Grenzen im Sidebar-Store). Die Breite steht im Store und
// als Inline-Stil; der Inhalt darf sie nie beeinflussen (`overflow: hidden`, feste Breite), damit sich der
// Editorbereich nur durch den Teiler ändert.
import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import {
    SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, sidebarStore, useSidebarStore,
} from '../stores/sidebar';

const KEY_STEP_PX = 16;
const KEY_STEP_LARGE_PX = 64;
export const SIDEBAR_RESIZER_LABEL = 'Breite der Seitenleiste';

interface DragStart {
    readonly pointerX: number;
    readonly width: number;
}

function keyWidth(key: string, width: number, isLarge: boolean): number | null {
    const step = isLarge ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
    switch (key) {
        case 'ArrowLeft': return width - step;
        case 'ArrowRight': return width + step;
        case 'Home': return SIDEBAR_MIN_WIDTH;
        case 'End': return SIDEBAR_MAX_WIDTH;
        default: return null;
    }
}

function Resizer({ width }: { readonly width: number }) {
    const drag = useRef<DragStart | null>(null);
    const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerX: event.clientX, width };
    };
    const onPointerMove = (event: PointerEvent): void => {
        if (drag.current === null) return;
        sidebarStore.getState().setWidth(drag.current.width + event.clientX - drag.current.pointerX);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        const next = keyWidth(event.key, width, event.shiftKey);
        if (next === null) return;
        event.preventDefault();
        sidebarStore.getState().setWidth(next);
    };
    return (
        <div
            className="sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={SIDEBAR_RESIZER_LABEL}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onDoubleClick={() => sidebarStore.getState().setWidth(SIDEBAR_DEFAULT_WIDTH)}
            onKeyDown={onKeyDown}
        />
    );
}

export function SidebarShell({ children }: { readonly children: ReactNode }) {
    const width = useSidebarStore((state) => state.width);
    return (
        <>
            <div className="sidebar-shell" style={{ width }}>
                {children}
            </div>
            <Resizer width={width} />
        </>
    );
}
