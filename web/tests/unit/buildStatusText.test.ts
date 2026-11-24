import { describe, expect, it } from 'vitest';
import { BUILD_STATUS_TEXTS, buildStatusOf, formatDuration } from '../../src/renderer/app/buildStatusText';
import type { BuildStatusInput } from '../../src/renderer/app/buildStatusText';
import { EMPTY_ISSUE_COUNTS } from '../../src/renderer/app/issueNavigation';

const TOOLS = { latexmk: '/bin/latexmk', git: null, synctexRef: null, distro: 'texlive' as const, problems: [] };

const base: BuildStatusInput = {
    hasMainFile: true, state: 'idle', isSaving: false, isCleaning: false, tools: TOOLS, startFailure: null,
    lastResult: null, counts: EMPTY_ISSUE_COUNTS,
};

const statusOf = (change: Partial<BuildStatusInput>) => buildStatusOf({ ...base, ...change });
const result = (change: Partial<NonNullable<BuildStatusInput['lastResult']>> = {}) =>
    ({ ok: true, cancelled: false, durationMs: 3200, ...change });

describe('Statustexte des Builds', () => {
    it('formatiert die Dauer mit deutschem Komma', () => {
        expect(formatDuration(3200)).toBe('3,2 s');
        expect(formatDuration(0)).toBe('0,0 s');
        expect(formatDuration(-5)).toBe('0,0 s');
        expect(formatDuration(75_040)).toBe('75,0 s');
    });

    it('Bereit vor dem ersten Lauf', () => {
        expect(statusOf({})).toMatchObject({ kind: 'idle', text: 'Bereit' });
    });

    it('läuft: Kompiliert …, vorgemerkt, Abbruch, Speichern, Aufräumen', () => {
        expect(statusOf({ state: 'running' })).toMatchObject({ kind: 'running', text: 'Kompiliert …' });
        expect(statusOf({ state: 'queued' }).kind).toBe('queued');
        expect(statusOf({ state: 'cancelling' }).text).toBe(BUILD_STATUS_TEXTS.cancelling);
        expect(statusOf({ isSaving: true }).kind).toBe('saving');
        expect(statusOf({ isCleaning: true, state: 'running' }).kind).toBe('cleaning');
    });

    it('Ergebnis: Fertig in 3,2 s, mit Warnungen, Fehler, Abgebrochen', () => {
        expect(statusOf({ lastResult: result() })).toMatchObject({ kind: 'success', text: 'Fertig in 3,2 s' });
        const warned = statusOf({ lastResult: result(), counts: { error: 0, warning: 2, badBox: 0 } });
        expect(warned.text).toBe('Fertig in 3,2 s · 2 Warnungen');
        expect(statusOf({ lastResult: result({ ok: false }) })).toMatchObject({ kind: 'failed', text: 'Fehler' });
        const failed = statusOf({ lastResult: result({ ok: false }), counts: { error: 3, warning: 0, badBox: 0 } });
        expect(failed.text).toBe('3 Fehler');
        expect(statusOf({ lastResult: result({ ok: false, cancelled: true }) })).toMatchObject({ kind: 'cancelled', text: 'Abgebrochen' });
    });

    it('latexmk fehlt: Text und Installationshinweis aus den Problemen von tools:detect', () => {
        const tools = { ...TOOLS, latexmk: null, problems: [{ tool: 'latexmk' as const, message: 'MacTeX installieren' }] };
        expect(statusOf({ tools })).toEqual({ kind: 'unavailable', text: 'latexmk nicht gefunden', detail: 'MacTeX installieren' });
        expect(statusOf({ tools: { ...tools, problems: [] } }).detail).toBe(BUILD_STATUS_TEXTS.installHint);
    });

    it('ohne Hauptdatei: Erklärung statt Ergebnis; ein laufender Build geht vor', () => {
        expect(statusOf({ hasMainFile: false })).toMatchObject({ kind: 'noMainFile', detail: BUILD_STATUS_TEXTS.noMainFileDetail });
        expect(statusOf({ hasMainFile: false, state: 'running' }).kind).toBe('running');
    });

    it('abgelehnter Start zeigt die Meldung des Mains', () => {
        expect(statusOf({ startFailure: 'kaputt' })).toMatchObject({ kind: 'startFailed', detail: 'kaputt' });
    });
});
