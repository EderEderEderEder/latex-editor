import { describe, expect, it } from 'vitest';
import {
    candidateDirectories,
    detectDistribution,
    detectTools,
    type Environment,
    pathDirectories,
    readEnv,
    TOOL_MESSAGES,
    type ToolsContext,
    type ToolsFileSystem,
} from '../../src/main/tools';

// Künstliches Dateisystem: ausführbare Dateien und Ordnerinhalte als Listen (Windows ohne Groß/klein-Unterschied).
function fakeFileSystem(executables: readonly string[], directories: Record<string, string[]> = {}, windows = false): ToolsFileSystem {
    const key = (target: string): string => (windows ? target.toLowerCase() : target);
    const files = new Set(executables.map(key));
    const listing = new Map(Object.entries(directories).map(([dir, names]) => [key(dir), names]));
    return {
        isExecutableFile: async (target) => files.has(key(target)),
        listDirectory: async (target) => listing.get(key(target)) ?? [],
    };
}

function windowsContext(env: Environment, executables: string[], directories: Record<string, string[]> = {}): ToolsContext {
    return { platform: 'win32', env, fs: fakeFileSystem(executables, directories, true) };
}

const WINDOWS_ENV: Environment = {
    Path: 'C:\\Windows\\system32;"C:\\Program Files\\Tool";.;relativ\\bin',
    LOCALAPPDATA: 'C:\\Users\\Max\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
};
const MIKTEX_USER_BIN = 'C:\\Users\\Max\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64';
const GIT_FOR_WINDOWS = 'C:\\Program Files\\Git\\cmd\\git.exe';

describe('Umgebung und PATH', () => {
    it('liest Windows-Variablen ohne Rücksicht auf Groß-/Kleinschreibung, Unix genau', () => {
        expect(readEnv({ Path: 'a' }, 'PATH', 'win32')).toBe('a');
        expect(readEnv({ Path: 'a' }, 'PATH', 'darwin')).toBeUndefined();
    });

    it('teilt PATH, entfernt Anführungszeichen und übergeht relative Einträge', () => {
        expect(pathDirectories(WINDOWS_ENV, 'win32')).toEqual(['C:\\Windows\\system32', 'C:\\Program Files\\Tool']);
        expect(pathDirectories({ PATH: '/usr/bin::./x:/opt/bin' }, 'linux')).toEqual(['/usr/bin', '/opt/bin']);
    });
});

describe('Werkzeugsuche Windows', () => {
    it('findet MiKTeX unter LOCALAPPDATA, meldet fehlendes Perl und findet Git für Windows', async () => {
        const context = windowsContext(WINDOWS_ENV, [`${MIKTEX_USER_BIN}\\latexmk.exe`, `${MIKTEX_USER_BIN}\\synctex.exe`, GIT_FOR_WINDOWS]);
        const info = await detectTools(context);
        expect(info.latexmk).toBe(`${MIKTEX_USER_BIN}\\latexmk.exe`);
        expect(info.synctexRef).toBe(`${MIKTEX_USER_BIN}\\synctex.exe`);
        expect(info.distro).toBe('miktex');
        expect(info.git).toBe(GIT_FOR_WINDOWS);
        expect(info.problems).toEqual([{ tool: 'perl', message: TOOL_MESSAGES.perlMissing }]);
    });

    it('MiKTeX mit Strawberry Perl: kein Problem', async () => {
        const perl = 'C:\\Strawberry\\perl\\bin\\perl.exe';
        const context = windowsContext(WINDOWS_ENV, [`${MIKTEX_USER_BIN}\\latexmk.exe`, perl, GIT_FOR_WINDOWS]);
        expect((await detectTools(context)).problems).toEqual([]);
    });

    it('TeX Live: neuestes Jahr zuerst, Ordner windows vor win32, kein Perl nötig', async () => {
        const directories = { 'C:\\texlive': ['2023', '2025', 'texmf-local'] };
        const latexmk = 'C:\\texlive\\2025\\bin\\windows\\latexmk.exe';
        const context = windowsContext(WINDOWS_ENV, ['C:\\texlive\\2023\\bin\\windows\\latexmk.exe', latexmk], directories);
        const info = await detectTools(context);
        expect(info.latexmk).toBe(latexmk);
        expect(info.distro).toBe('texlive');
        expect(info.problems.map((problem) => problem.tool)).toEqual(['git']);
    });

    it('PATH hat Vorrang vor bekannten Orten', async () => {
        const own = 'C:\\Program Files\\Tool\\latexmk.exe';
        const context = windowsContext(WINDOWS_ENV, [own, `${MIKTEX_USER_BIN}\\latexmk.exe`]);
        expect((await detectTools(context)).latexmk).toBe(own);
    });

    it('nur latexmk.bat vorhanden: kein Treffer, Meldung zum Skript', async () => {
        const script = 'C:\\Program Files\\Tool\\latexmk.bat';
        const info = await detectTools(windowsContext(WINDOWS_ENV, [script, GIT_FOR_WINDOWS]));
        expect(info.latexmk).toBeNull();
        expect(info.distro).toBeNull();
        expect(info.problems).toEqual([{ tool: 'latexmk', message: TOOL_MESSAGES.scriptOnly('latexmk', script) }]);
    });

    it('nichts installiert: verständliche Meldungen für latexmk und Git', async () => {
        const info = await detectTools(windowsContext({}, []));
        expect(info.problems).toEqual([
            { tool: 'latexmk', message: TOOL_MESSAGES.latexmkMissingWindows },
            { tool: 'git', message: TOOL_MESSAGES.gitMissing },
        ]);
    });

    it('Program Files ohne Umgebungsvariable: Standardpfad für MiKTeX und Git', async () => {
        const directories = await candidateDirectories('git', windowsContext({}, []));
        expect(directories).toEqual(['C:\\Program Files\\Git\\cmd']);
        const tex = await candidateDirectories('latexmk', windowsContext({}, []));
        expect(tex).toEqual(['C:\\Program Files\\MiKTeX\\miktex\\bin\\x64']);
    });
});

describe('Werkzeugsuche macOS', () => {
    const macEnv: Environment = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };

    it('MacTeX über /Library/TeX/texbin, obwohl PATH es nicht enthält (GUI-App)', async () => {
        const context: ToolsContext = { platform: 'darwin', env: macEnv, fs: fakeFileSystem(['/Library/TeX/texbin/latexmk', '/usr/local/bin/git']) };
        const info = await detectTools(context);
        expect(info.latexmk).toBe('/Library/TeX/texbin/latexmk');
        expect(info.distro).toBe('mactex');
        expect(info.git).toBe('/usr/local/bin/git');
        expect(info.problems).toEqual([]);
    });

    it('nie /usr/bin/git, auch wenn es im PATH liegt; Homebrew unter /opt/homebrew', async () => {
        const onlySystem: ToolsContext = { platform: 'darwin', env: macEnv, fs: fakeFileSystem(['/usr/bin/git']) };
        const info = await detectTools(onlySystem);
        expect(info.git).toBeNull();
        expect(info.problems).toContainEqual({ tool: 'git', message: TOOL_MESSAGES.gitMissingMac });
        const brew: ToolsContext = { platform: 'darwin', env: macEnv, fs: fakeFileSystem(['/usr/bin/git', '/opt/homebrew/bin/git']) };
        expect((await detectTools(brew)).git).toBe('/opt/homebrew/bin/git');
    });

    it('TeX Live ohne MacTeX unter /usr/local/texlive/<Jahr>/bin/<Arch>', async () => {
        const latexmk = '/usr/local/texlive/2025/bin/universal-darwin/latexmk';
        const directories = { '/usr/local/texlive': ['2025'], '/usr/local/texlive/2025/bin': ['universal-darwin'] };
        const context: ToolsContext = { platform: 'darwin', env: macEnv, fs: fakeFileSystem([latexmk], directories) };
        const info = await detectTools(context);
        expect(info.latexmk).toBe(latexmk);
        expect(info.distro).toBe('texlive');
        expect(info.problems.map((problem) => problem.message)).toEqual([TOOL_MESSAGES.gitMissingMac]);
    });

    it('fehlendes MacTeX ergibt die Meldung wie in der Swift-Version', async () => {
        const info = await detectTools({ platform: 'darwin', env: macEnv, fs: fakeFileSystem(['/usr/local/bin/git']) });
        expect(info.problems).toEqual([{ tool: 'latexmk', message: TOOL_MESSAGES.latexmkMissingMac }]);
    });
});

describe('Werkzeugsuche Linux', () => {
    it('latexmk und Git aus PATH (/usr/bin/git ist unter Linux in Ordnung)', async () => {
        const fs = fakeFileSystem(['/usr/bin/latexmk', '/usr/bin/git']);
        const info = await detectTools({ platform: 'linux', env: { PATH: '/usr/local/bin:/usr/bin' }, fs });
        expect(info).toEqual({ latexmk: '/usr/bin/latexmk', git: '/usr/bin/git', synctexRef: null, distro: 'unknown', problems: [] });
    });

    it('TeX Live unter /usr/local/texlive, Perl wird nicht geprüft', async () => {
        const latexmk = '/usr/local/texlive/2024/bin/x86_64-linux/latexmk';
        const directories = { '/usr/local/texlive': ['2024'], '/usr/local/texlive/2024/bin': ['x86_64-linux'] };
        const info = await detectTools({ platform: 'linux', env: {}, fs: fakeFileSystem([latexmk], directories) });
        expect(info.latexmk).toBe(latexmk);
        expect(info.distro).toBe('texlive');
        expect(info.problems.map((problem) => problem.tool)).toEqual(['git']);
    });
});

describe('detectDistribution', () => {
    it.each([
        ['C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\latexmk.exe', 'win32', 'miktex'],
        ['C:\\texlive\\2025\\bin\\windows\\latexmk.exe', 'win32', 'texlive'],
        ['/Library/TeX/texbin/latexmk', 'darwin', 'mactex'],
        ['/usr/local/texlive/2025/bin/x86_64-linux/latexmk', 'linux', 'texlive'],
        ['/usr/bin/latexmk', 'linux', 'unknown'],
    ] as const)('%s → %s', (latexmk, platform, expected) => {
        expect(detectDistribution(latexmk, platform)).toBe(expected);
    });
});
