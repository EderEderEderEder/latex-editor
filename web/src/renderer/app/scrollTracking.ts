// Verbindet den sichtbaren Editor mit dem `ScrollMemory`: merkt die Scrollposition des gezeigten Tabs und stellt eine
// wiederhergestellte Position beim ersten Anzeigen des Tabs ein. Die Sitzungen selbst bleiben unberührt.
import type { SessionView } from '../editor/session';
import type { EditorStore } from '../stores/editor';
import type { ScrollMemory } from './scrollMemory';

export interface ScrollTrackingOptions {
    readonly sessionView: Pick<SessionView, 'view' | 'session'>;
    readonly store: EditorStore;
    readonly memory: ScrollMemory;
    /** Nach dem Umschalten des Views (Standard: `requestAnimationFrame`) */
    readonly nextFrame?: (callback: () => void) => number;
    readonly cancelFrame?: (handle: number) => void;
}

/** Gibt die Abmeldung zurück */
export function connectScrollMemory(options: ScrollTrackingOptions): () => void {
    const { sessionView, store, memory } = options;
    const nextFrame = options.nextFrame ?? ((callback) => window.requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
    const scrollDom = sessionView.view.scrollDOM;
    let frame: number | null = null;

    const record = (): void => {
        const path = sessionView.session?.path;
        if (path !== undefined) memory.record(path, scrollDom.scrollTop);
    };
    const restore = (): void => {
        frame = null;
        const path = store.getState().tabs.active;
        if (path === null || sessionView.session?.path !== path) return;
        const scrollTop = memory.takePending(path);
        if (scrollTop !== undefined) scrollDom.scrollTop = scrollTop;
    };
    const schedule = (): void => {
        if (frame !== null) cancelFrame(frame);
        frame = nextFrame(restore);
    };

    scrollDom.addEventListener('scroll', record, { passive: true });
    const unsubscribe = store.subscribe((state, previous) => {
        if (state.tabs.active !== previous.tabs.active) schedule();
    });
    schedule();
    return () => {
        unsubscribe();
        scrollDom.removeEventListener('scroll', record);
        if (frame !== null) cancelFrame(frame);
    };
}
