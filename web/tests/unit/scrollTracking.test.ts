import { describe, expect, it } from 'vitest';
import { ScrollMemory } from '../../src/renderer/app/scrollMemory';
import { connectScrollMemory } from '../../src/renderer/app/scrollTracking';
import { createEditorStore } from '../../src/renderer/stores/editor';

describe('ScrollMemory', () => {
    it('merkt Positionen und meldet nur echte Änderungen', () => {
        const memory = new ScrollMemory();
        let notified = 0;
        memory.onChange(() => notified++);
        memory.record('/p/a.tex', 10);
        memory.record('/p/a.tex', 10);
        expect(memory.get('/p/a.tex')).toBe(10);
        expect(memory.get('/p/neu.tex')).toBe(0);
        expect(notified).toBe(1);
    });

    it('eine wartende Position gilt, bis sie abgeholt ist; der Start des Views bei 0 überschreibt sie nicht', () => {
        const memory = new ScrollMemory();
        memory.setPending('/p/a.tex', 300);
        memory.record('/p/a.tex', 0);
        expect(memory.get('/p/a.tex')).toBe(300);
        expect(memory.takePending('/p/a.tex')).toBe(300);
        expect(memory.takePending('/p/a.tex')).toBeUndefined();
        memory.record('/p/a.tex', 20);
        expect(memory.get('/p/a.tex')).toBe(20);
    });

    it('retain vergisst geschlossene Tabs', () => {
        const memory = new ScrollMemory();
        memory.record('/p/a.tex', 5);
        memory.setPending('/p/b.tex', 7);
        memory.retain(new Set(['/p/a.tex']));
        expect(memory.get('/p/a.tex')).toBe(5);
        expect(memory.get('/p/b.tex')).toBe(0);
    });
});

describe('Scroll-Verfolgung', () => {
    function setup() {
        const scrollDOM = new EventTarget() as EventTarget & { scrollTop: number };
        scrollDOM.scrollTop = 0;
        const sessionView = { view: { scrollDOM }, session: null as { path: string } | null };
        const store = createEditorStore();
        const memory = new ScrollMemory();
        const frames: (() => void)[] = [];
        const disconnect = connectScrollMemory({
            sessionView: sessionView as never,
            store,
            memory,
            nextFrame: (callback) => frames.push(callback),
            cancelFrame: () => undefined,
        });
        const runFrames = (): void => frames.splice(0).forEach((callback) => callback());
        return { scrollDOM, sessionView, store, memory, runFrames, disconnect };
    }

    it('merkt die Position des gezeigten Tabs bei Scroll-Ereignissen', () => {
        const { scrollDOM, sessionView, memory } = setup();
        sessionView.session = { path: '/p/a.tex' };
        scrollDOM.scrollTop = 240;
        scrollDOM.dispatchEvent(new Event('scroll'));
        expect(memory.get('/p/a.tex')).toBe(240);
    });

    it('stellt die wartende Position beim ersten Anzeigen des aktiven Tabs ein', () => {
        const { scrollDOM, sessionView, store, memory, runFrames } = setup();
        memory.setPending('/p/a.tex', 300);
        store.getState().open({ path: '/p/a.tex', name: 'a.tex', text: 'x', encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 }, { asPreview: false });
        sessionView.session = { path: '/p/a.tex' };
        runFrames();
        expect(scrollDOM.scrollTop).toBe(300);
        expect(memory.takePending('/p/a.tex')).toBeUndefined();
    });

    it('wartet, wenn der View den Tab noch nicht zeigt', () => {
        const { scrollDOM, sessionView, store, memory, runFrames } = setup();
        memory.setPending('/p/a.tex', 300);
        store.getState().open({ path: '/p/a.tex', name: 'a.tex', text: 'x', encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 }, { asPreview: false });
        sessionView.session = { path: '/p/andere.tex' };
        runFrames();
        expect(scrollDOM.scrollTop).toBe(0);
        expect(memory.get('/p/a.tex')).toBe(300);
    });

    it('nach dem Abmelden passiert nichts mehr', () => {
        const { scrollDOM, sessionView, memory, disconnect } = setup();
        disconnect();
        sessionView.session = { path: '/p/a.tex' };
        scrollDOM.dispatchEvent(new Event('scroll'));
        expect(memory.get('/p/a.tex')).toBe(0);
    });
});
