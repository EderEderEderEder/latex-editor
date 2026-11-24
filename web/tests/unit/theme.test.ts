import { describe, expect, it } from 'vitest';
import { TOKEN_CLASS_BY_KIND } from '../../src/renderer/editor/language';
import {
    COLOR_SCHEMES,
    buildEditorTheme,
    buildSyntaxCss,
    contrastRatio,
    resolvePalette,
    resolveThemeMode,
} from '../../src/renderer/editor/theme';
import type { ColorSchemeId, ThemeMode } from '../../src/renderer/editor/theme';

const MODES: readonly ThemeMode[] = ['light', 'dark'];
const TOKEN_KINDS = Object.keys(TOKEN_CLASS_BY_KIND);

/** Werte aus dem Swift-Vorbild, die den Mindestkontrast nicht erreichen: Schlüssel `schema/modus/token` -> Begründung */
const DOCUMENTED_EXCEPTIONS: Readonly<Record<string, string>> = {};

function exceptionKey(id: ColorSchemeId, mode: ThemeMode, token: string): string {
    return `${id}/${mode}/${token}`;
}

describe('Farbschemata', () => {
    it('heißen wie in Swift', () => {
        expect(COLOR_SCHEMES.map((scheme) => scheme.title)).toEqual(['Standard', 'Klassisch', 'Solarized', 'Hoher Kontrast']);
    });

    it('übernehmen Stichproben aus dem Swift-Vorbild', () => {
        expect(resolvePalette('standard', 'light').syntax.command).toBe('#1f5fbf');
        expect(resolvePalette('standard', 'dark').syntax.comment).toBe('#7f8a93');
        expect(resolvePalette('solarized', 'dark').background).toBe('#002b36');
        expect(resolvePalette('highContrast', 'dark').text).toBe('#ffffff');
    });

    it.each(COLOR_SCHEMES.flatMap((scheme) => MODES.map((mode) => [scheme.id, mode] as const)))(
        '%s/%s hat alle Token-Arten und gültige Farben',
        (id, mode) => {
            const palette = resolvePalette(id, mode);
            expect(Object.keys(palette.syntax).sort()).toEqual([...TOKEN_KINDS].sort());
            for (const color of Object.values(palette.syntax)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
        },
    );

    it('Mindestkontrast: Text und jede Token-Art gegen den Hintergrund (Hoher Kontrast 7:1, sonst 4,5:1)', () => {
        const failures: string[] = [];
        for (const scheme of COLOR_SCHEMES) {
            for (const mode of MODES) {
                const palette = resolvePalette(scheme.id, mode);
                const colors = { text: palette.text, ...palette.syntax };
                for (const [token, color] of Object.entries(colors)) {
                    const ratio = contrastRatio(color, palette.background);
                    const documented = exceptionKey(scheme.id, mode, token) in DOCUMENTED_EXCEPTIONS;
                    if (ratio < scheme.minimumContrast && !documented) {
                        failures.push(`${scheme.title} ${mode} ${token}: ${ratio.toFixed(2)}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('dokumentierte Ausnahmen sind noch nötig', () => {
        for (const key of Object.keys(DOCUMENTED_EXCEPTIONS)) {
            const [id, mode, token] = key.split('/') as [ColorSchemeId, ThemeMode, string];
            const scheme = COLOR_SCHEMES.find((candidate) => candidate.id === id)!;
            const palette = resolvePalette(id, mode);
            const color = token === 'text' ? palette.text : palette.syntax[token as keyof typeof palette.syntax];
            expect(contrastRatio(color, palette.background)).toBeLessThan(scheme.minimumContrast);
        }
    });

    it('Kontrastberechnung nach WCAG', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    });
});

describe('CSS und Theme-Erzeugung', () => {
    it('enthält jede cm-syntax-Klasse mit der Farbe der Palette', () => {
        for (const scheme of COLOR_SCHEMES) {
            for (const mode of MODES) {
                const palette = resolvePalette(scheme.id, mode);
                const css = buildSyntaxCss(palette);
                for (const [kind, className] of Object.entries(TOKEN_CLASS_BY_KIND)) {
                    expect(css).toContain(`.${className} {`);
                    expect(css).toContain(`--editor-syntax-${kind}: ${palette.syntax[kind as keyof typeof palette.syntax]};`);
                }
            }
        }
    });

    it('liefert nur die Farben der Unterstreichungen; die Form steht allein in diagnostics.ts', () => {
        const palette = resolvePalette('standard', 'light');
        const css = buildSyntaxCss(palette);
        for (const severity of ['hint', 'warning', 'error'] as const) {
            expect(css).toContain(`--editor-diagnostic-${severity}: ${palette.diagnostics[severity]};`);
            expect(css).not.toContain(`.cm-diagnostic-${severity}`);
        }
    });

    it('baut eine CodeMirror-Erweiterung je Schema und Modus', () => {
        for (const scheme of COLOR_SCHEMES) {
            for (const mode of MODES) expect(buildEditorTheme(resolvePalette(scheme.id, mode))).toBeDefined();
        }
    });

    it('wählt Hell/Dunkel nach Einstellung oder System', () => {
        expect(resolveThemeMode('system', true)).toBe('dark');
        expect(resolveThemeMode('system', false)).toBe('light');
        expect(resolveThemeMode('light', true)).toBe('light');
        expect(resolveThemeMode('dark', false)).toBe('dark');
    });
});
