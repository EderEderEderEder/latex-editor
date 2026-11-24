// Scrollposition je Tab für das Tab-Gedächtnis. Der Editor kennt sie nur im View (sichtbarer Tab) oder als
// CodeMirror-Wirkung (andere Tabs); hier steht eine einfache Zahl in Pixeln, die gespeichert und wiederhergestellt wird.
import type { AbsolutePath } from '../../shared/contract';

export class ScrollMemory {
    private readonly positions = new Map<AbsolutePath, number>();
    /** Wiederhergestellte Positionen, die noch auf den ersten Anzeigen des Tabs warten */
    private readonly pending = new Map<AbsolutePath, number>();
    private readonly listeners = new Set<() => void>();

    /** Aktuelle Position aus einem Scroll-Ereignis; solange eine wiederhergestellte wartet, zählt sie (der View startet bei 0) */
    record(path: AbsolutePath, scrollTop: number): void {
        if (this.pending.has(path) || this.positions.get(path) === scrollTop) return;
        this.positions.set(path, scrollTop);
        this.notify();
    }

    get(path: AbsolutePath): number {
        return this.pending.get(path) ?? this.positions.get(path) ?? 0;
    }

    setPending(path: AbsolutePath, scrollTop: number): void {
        this.pending.set(path, scrollTop);
        this.positions.delete(path);
    }

    /** Holt die wartende Position ab (einmalig); danach zählt wieder das Scrollen des Nutzers */
    takePending(path: AbsolutePath): number | undefined {
        const value = this.pending.get(path);
        if (value === undefined) return undefined;
        this.pending.delete(path);
        this.positions.set(path, value);
        return value;
    }

    /** Vergisst alle Tabs außer `open`, damit ein neu geöffneter Tab bei 0 beginnt */
    retain(open: ReadonlySet<AbsolutePath>): void {
        for (const path of [...this.positions.keys()]) if (!open.has(path)) this.positions.delete(path);
        for (const path of [...this.pending.keys()]) if (!open.has(path)) this.pending.delete(path);
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}

export const scrollMemory = new ScrollMemory();
