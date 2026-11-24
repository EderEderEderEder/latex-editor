import { describe, expect, it } from 'vitest';
import { LINUX_PATHS, MACOS_PATHS, WINDOWS_PATHS, rebaseToProjectRoot } from '../../src/main/paths';

describe('rebaseToProjectRoot', () => {
    it('bildet den aufgelösten Pfad (macOS /private/var) auf die Projektform ab', () => {
        const result = rebaseToProjectRoot('/private/var/folders/x/p/chapters/a.tex', '/private/var/folders/x/p', '/var/folders/x/p', MACOS_PATHS);
        expect(result).toBe('/var/folders/x/p/chapters/a.tex');
    });

    it('lässt Pfade außerhalb der Wurzel unverändert', () => {
        expect(rebaseToProjectRoot('/usr/share/texmf/x.sty', '/private/var/p', '/var/p', LINUX_PATHS)).toBe('/usr/share/texmf/x.sty');
    });

    it('liefert für die Wurzel selbst die Projektform', () => {
        expect(rebaseToProjectRoot('/real/p', '/real/p', '/link/p', LINUX_PATHS)).toBe('/link/p');
    });

    it('beachtet unter Windows Groß-/Kleinschreibung des Laufwerks und Trenner', () => {
        const result = rebaseToProjectRoot('C:\\Users\\Max\\Arbeit\\kapitel\\a.tex', 'c:\\users\\max\\arbeit', 'C:\\Users\\Max\\Arbeit', WINDOWS_PATHS);
        expect(result).toBe('C:\\Users\\Max\\Arbeit\\kapitel\\a.tex');
    });

    it('bildet unter Windows einen aufgelösten Kurzpfad-Unterschied auf die Projektform ab', () => {
        const result = rebaseToProjectRoot('D:\\real\\p\\a.tex', 'D:\\real\\p', 'D:\\link\\p', WINDOWS_PATHS);
        expect(result).toBe('D:\\link\\p\\a.tex');
    });
});
