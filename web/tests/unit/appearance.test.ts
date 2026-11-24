import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextFile } from '../../src/shared/contract';
import {
    DEFAULT_APPEARANCE, appearanceCssVariables, appearanceEffects, appearanceFromSettings, sameAppearance,
    setCurrentAppearance,
} from '../../src/renderer/editor/appearance';
import { createAppearanceUpdater, connectAppearance } from '../../src/renderer/editor/appearanceController';
import type { AppearanceHost, SettingsSource } from '../../src/renderer/editor/appearanceController';
import { EditorSession } from '../../src/renderer/editor/session';
import { typingSettings } from '../../src/renderer/editor/typing';
import {
    selectColorScheme, selectThemeMode, syntaxCssFor, themeCompartment,
} from '../../src/renderer/editor/themeController';
import { TOKEN_CLASS_BY_KIND } from '../../src/renderer/editor/language';
import { defaultSettings } from '../../src/renderer/stores/settingsSchema';
import type { EditorSettingsValues } from '../../src/renderer/stores/settingsSchema';

const settings = (changes: Partial<EditorSettingsValues> = {}): EditorSettingsValues => ({ ...defaultSettings(), ...changes });

function file(path: string, text: string): TextFile {
    return { path, text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

afterEach(() => {
    setCurrentAppearance(DEFAULT_APPEARANCE);
});

describe('Theme-Auswahl', () => {
    it('kennt die vier Schemata und fällt sonst auf Standard zurück', () => {
        expect(selectColorScheme('solarized')).toBe('solarized');
        expect(selectColorScheme('highContrast')).toBe('highContrast');
        expect(selectColorScheme('gibt-es-nicht')).toBe('standard');
        expect(selectColorScheme('')).toBe('standard');
    });

    it('wählt hell oder dunkel nach prefers-color-scheme', () => {
        expect(selectThemeMode(true)).toBe('dark');
        expect(selectThemeMode(false)).toBe('light');
    });

    it('baut das Syntax-CSS mit den Farben des Modus', () => {
        const light = syntaxCssFor('standard', 'light');
        const dark = syntaxCssFor('standard', 'dark');
        expect(light).not.toBe(dark);
        for (const className of Object.values(TOKEN_CLASS_BY_KIND)) expect(dark).toContain(`.${className}`);
    });
});

describe('Darstellung aus den Einstellungen', () => {
    it('übersetzt Einrückung, Klammern, Zeilenumbruch und Schema', () => {
        const values = appearanceFromSettings(
            settings({ indentation: 'twoSpaces', autoClosesBrackets: false, wrapsLines: false, colorScheme: 'classic', tabWidth: 8 }),
            true,
        );
        expect(values).toMatchObject({
            indentUnit: '  ', autoClosesBrackets: false, wrapsLines: false, scheme: 'classic', mode: 'dark', tabWidth: 8,
        });
        expect(appearanceFromSettings(settings({ indentation: 'tab' }), false).indentUnit).toBe('\t');
    });

    it('rechnet Schrift × Zoom, Zeilenabstand und Oberflächenzoom in CSS-Variablen', () => {
        const variables = appearanceCssVariables(
            settings({ fontSize: 13, editorZoom: 150, lineSpacing: 'wide', interfaceZoom: 115, fontFamily: 'Fira Code' }),
        );
        expect(variables).toEqual({
            '--editor-font-family': 'Fira Code', '--editor-font-size': '19.5px', '--editor-line-height': '1.75', '--ui-scale': '1.15',
        });
        expect(appearanceCssVariables(settings())['--editor-font-family']).toContain('monospace');
    });

    it('liefert nur Effekte für geänderte Gruppen', () => {
        expect(appearanceEffects(DEFAULT_APPEARANCE, DEFAULT_APPEARANCE)).toHaveLength(0);
        expect(appearanceEffects(DEFAULT_APPEARANCE, { ...DEFAULT_APPEARANCE, mode: 'dark' })).toHaveLength(1);
        expect(appearanceEffects(DEFAULT_APPEARANCE, { ...DEFAULT_APPEARANCE, wrapsLines: false, tabWidth: 2 })).toHaveLength(2);
    });

    it('setCurrentAppearance meldet nur echte Änderungen', () => {
        expect(setCurrentAppearance({ ...DEFAULT_APPEARANCE })).toBe(false);
        expect(setCurrentAppearance({ ...DEFAULT_APPEARANCE, mode: 'dark' })).toBe(true);
        expect(sameAppearance(DEFAULT_APPEARANCE, { ...DEFAULT_APPEARANCE })).toBe(true);
    });
});

describe('Sitzung: Darstellung ohne Neuaufbau', () => {
    it('trägt die Theme-Erweiterung und folgt einem Wechsel, ohne Text und Verlauf anzufassen', () => {
        const session = new EditorSession(file('/p/a.tex', 'Text'));
        session.dispatch({ changes: { from: 4, insert: '!' }, userEvent: 'input.type' });
        const state = session.state;
        expect(themeCompartment.get(state)).toBeDefined();
        expect(state.facet(EditorView.darkTheme)).toBe(false);

        setCurrentAppearance({ ...DEFAULT_APPEARANCE, mode: 'dark', tabWidth: 2, indentUnit: '  ', autoClosesBrackets: false });
        session.syncAppearance();
        expect(session.state.facet(EditorView.darkTheme)).toBe(true);
        expect(session.state.tabSize).toBe(2);
        expect(session.state.facet(indentUnit)).toBe('  ');
        expect(session.state.facet(typingSettings)).toEqual({ indentUnit: '  ', autoPairBrackets: false });
        expect(session.state.doc.toString()).toBe('Text!');
        expect(session.isDirty).toBe(true);
    });

    it('eine neue Sitzung bekommt gleich den aktuellen Stand', () => {
        setCurrentAppearance({ ...DEFAULT_APPEARANCE, mode: 'dark', wrapsLines: false });
        const session = new EditorSession(file('/p/b.tex', 'x'));
        expect(session.state.facet(EditorView.darkTheme)).toBe(true);
        expect(session.state.facet(EditorView.contentAttributes).some((attributes) => 'class' in attributes)).toBe(false);
    });

    it('der Zeilenumbruch wird über den Compartment geschaltet', () => {
        const wrapped = (state: EditorState): boolean =>
            state.facet(EditorView.contentAttributes).some((a) => typeof a === 'object' && String(a.class ?? '').includes('cm-lineWrapping'));
        const session = new EditorSession(file('/p/c.tex', 'x'));
        expect(wrapped(session.state)).toBe(true);
        setCurrentAppearance({ ...DEFAULT_APPEARANCE, wrapsLines: false });
        session.syncAppearance();
        expect(wrapped(session.state)).toBe(false);
    });

    it('syncAppearance ohne Änderung schickt nichts', () => {
        const session = new EditorSession(file('/p/d.tex', 'x'));
        const before = session.state;
        session.syncAppearance();
        expect(session.state).toBe(before);
    });
});

describe('Darstellungs-Controller', () => {
    function fakeHost() {
        const host = {
            css: [] as string[],
            variables: [] as Readonly<Record<string, string>>[],
            changed: 0,
            applySyntaxCss: (css: string) => host.css.push(css),
            applyCssVariables: (variables: Readonly<Record<string, string>>) => host.variables.push(variables),
            appearanceChanged: () => {
                host.changed += 1;
            },
        };
        return host satisfies AppearanceHost & Record<string, unknown>;
    }

    it('wendet beim ersten Mal alles an und danach nur Geändertes', () => {
        const host = fakeHost();
        const update = createAppearanceUpdater(host);
        update(settings(), false);
        expect([host.css.length, host.variables.length, host.changed]).toEqual([1, 1, 1]);
        update(settings(), false);
        expect([host.css.length, host.variables.length, host.changed]).toEqual([1, 1, 1]);
        update(settings({ editorZoom: 130 }), false);
        expect([host.css.length, host.variables.length, host.changed]).toEqual([1, 2, 2]);
        update(settings({ editorZoom: 130 }), true);
        expect([host.css.length, host.variables.length, host.changed]).toEqual([2, 2, 3]);
    });

    it('folgt dem Einstellungs-Store und dem Systemfarbschema und meldet sich ab', () => {
        const host = fakeHost();
        let values = settings();
        const listeners = new Set<() => void>();
        const source: SettingsSource = {
            getState: () => ({ values }),
            subscribe: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        };
        const mediaListeners: (() => void)[] = [];
        const media = {
            matches: false,
            addEventListener: (_type: 'change', listener: () => void) => {
                mediaListeners.push(listener);
            },
            removeEventListener: vi.fn(),
        };
        const disconnect = connectAppearance({ host, settings: source, media });
        expect(host.css).toHaveLength(1);

        values = settings({ colorScheme: 'solarized' });
        listeners.forEach((listener) => listener());
        expect(host.css).toHaveLength(2);

        media.matches = true;
        mediaListeners.forEach((listener) => listener());
        expect(host.css).toHaveLength(3);
        expect(host.css[2]).toContain(':root');

        disconnect();
        expect(listeners.size).toBe(0);
        expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    });
});
