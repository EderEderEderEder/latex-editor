import { constants as fsConstants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AbsolutePath, TexDistribution, ToolName, ToolProblem, ToolsInfo } from '../shared/contract';

// Sucht latexmk, Git und synctex (Kanal `tools:detect`). Ohne Electron; Plattform, Umgebung und
// Dateisystem kommen als Parameter, damit Windows-Fälle auch unter macOS in Vitest prüfbar sind.

type PathModule = typeof path.posix;
export type Environment = Readonly<Record<string, string | undefined>>;

export interface ToolsFileSystem {
    isExecutableFile(target: string): Promise<boolean>;
    // Namen der Einträge; fehlt der Ordner, eine leere Liste.
    listDirectory(target: string): Promise<readonly string[]>;
}

export interface ToolsContext {
    readonly platform: NodeJS.Platform;
    readonly env: Environment;
    readonly fs: ToolsFileSystem;
}

interface ExecutableSearch {
    readonly found: AbsolutePath | null;
    // Windows: nur als .bat/.cmd vorhanden, lässt sich ohne Shell nicht starten.
    readonly scriptOnly: AbsolutePath | null;
}

const MACOS_TEXBIN = '/Library/TeX/texbin';
const UNIX_TEXLIVE_ROOT = '/usr/local/texlive';
const MACOS_GIT_DIRECTORIES = ['/usr/local/bin', '/opt/homebrew/bin'];
// Unter macOS ist /usr/bin/git nur ein Platzhalter von xcode-select, der einen Installationsdialog öffnen kann.
const MACOS_FORBIDDEN_GIT = '/usr/bin/git';
const WINDOWS_TEXLIVE_ROOT = 'C:\\texlive';
// Seit TeX Live 2023 heißt der Ordner `windows`, davor `win32`.
const WINDOWS_TEXLIVE_BIN_NAMES = ['windows', 'win32'];
const WINDOWS_PROGRAM_FILES_DEFAULT = 'C:\\Program Files';
const WINDOWS_STRAWBERRY_PERL = 'C:\\Strawberry\\perl\\bin';
const WINDOWS_EXECUTABLE_EXTENSION = '.exe';
const WINDOWS_SCRIPT_EXTENSIONS = ['.cmd', '.bat'];
const YEAR_DIRECTORY = /^\d{4}$/;

export const TOOL_MESSAGES = {
    latexmkMissingWindows: 'latexmk wurde nicht gefunden. Bitte MiKTeX oder TeX Live installieren und die App neu starten.',
    latexmkMissingMac: 'MacTeX wurde nicht gefunden: latexmk fehlt in /Library/TeX/texbin. Bitte MacTeX installieren und die App neu starten.',
    latexmkMissingLinux: 'latexmk wurde nicht gefunden. Bitte TeX Live (mit latexmk) installieren und die App neu starten.',
    perlMissing: 'MiKTeX braucht für latexmk ein Perl, es wurde aber keines gefunden. Bitte Strawberry Perl installieren oder TeX Live verwenden (bringt Perl mit).',
    gitMissing: 'Git wurde nicht gefunden. Die Git-Funktionen bleiben aus, bis Git installiert ist.',
    gitMissingMac: 'Git wurde nicht gefunden (gesucht in /usr/local/bin und /opt/homebrew/bin). Die Git-Funktionen bleiben aus.',
    scriptOnly: (tool: string, file: string) =>
        `${tool} liegt nur als Skript vor (${file}). Skripte (.bat/.cmd) startet die App aus Sicherheitsgründen nicht, es wird eine .exe gebraucht.`,
} as const;

export function isWindowsPlatform(platform: NodeJS.Platform): boolean {
    return platform === 'win32';
}

function pathModuleFor(platform: NodeJS.Platform): PathModule {
    return isWindowsPlatform(platform) ? path.win32 : path.posix;
}

// Windows-Umgebungsvariablen sind unabhängig von Groß-/Kleinschreibung (`Path`, `PATH`).
export function readEnv(env: Environment, name: string, platform: NodeJS.Platform): string | undefined {
    if (!isWindowsPlatform(platform)) return env[name];
    const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
    return key === undefined ? undefined : env[key];
}

export function pathDirectories(env: Environment, platform: NodeJS.Platform): AbsolutePath[] {
    const value = readEnv(env, 'PATH', platform) ?? '';
    const pathModule = pathModuleFor(platform);
    return value
        .split(pathModule.delimiter)
        .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
        // Relative Einträge (z. B. `.`) würden vom Arbeitsordner abhängen: übergehen.
        .filter((entry) => entry !== '' && pathModule.isAbsolute(entry));
}

async function texLiveYearDirectories(root: string, context: ToolsContext): Promise<string[]> {
    const pathModule = pathModuleFor(context.platform);
    const years = (await context.fs.listDirectory(root)).filter((name) => YEAR_DIRECTORY.test(name));
    return years.sort().reverse().map((year) => pathModule.join(root, year, 'bin'));
}

async function windowsTexDirectories(context: ToolsContext): Promise<string[]> {
    const { env, platform } = context;
    const localAppData = readEnv(env, 'LOCALAPPDATA', platform);
    const programFiles = readEnv(env, 'ProgramFiles', platform) ?? WINDOWS_PROGRAM_FILES_DEFAULT;
    const miktexBin = ['miktex', 'bin', 'x64'];
    const directories: string[] = [];
    if (localAppData !== undefined) directories.push(path.win32.join(localAppData, 'Programs', 'MiKTeX', ...miktexBin));
    directories.push(path.win32.join(programFiles, 'MiKTeX', ...miktexBin));
    for (const binDirectory of await texLiveYearDirectories(WINDOWS_TEXLIVE_ROOT, context)) {
        directories.push(...WINDOWS_TEXLIVE_BIN_NAMES.map((name) => path.win32.join(binDirectory, name)));
    }
    return directories;
}

async function unixTexDirectories(context: ToolsContext): Promise<string[]> {
    const directories = context.platform === 'darwin' ? [MACOS_TEXBIN] : [];
    for (const binDirectory of await texLiveYearDirectories(UNIX_TEXLIVE_ROOT, context)) {
        const architectures = await context.fs.listDirectory(binDirectory);
        directories.push(...[...architectures].sort().map((name) => path.posix.join(binDirectory, name)));
    }
    return directories;
}

function windowsGitDirectories(context: ToolsContext): string[] {
    const { env, platform } = context;
    const programFiles = readEnv(env, 'ProgramFiles', platform) ?? WINDOWS_PROGRAM_FILES_DEFAULT;
    const localAppData = readEnv(env, 'LOCALAPPDATA', platform);
    const directories = [path.win32.join(programFiles, 'Git', 'cmd')];
    if (localAppData !== undefined) directories.push(path.win32.join(localAppData, 'Programs', 'Git', 'cmd'));
    return directories;
}

// Reihenfolge: PATH zuerst (Wahl des Nutzers), dann bekannte Orte. Ausnahme Git unter macOS: Homebrew zuerst.
export async function candidateDirectories(tool: ToolName, context: ToolsContext): Promise<string[]> {
    const fromPath = pathDirectories(context.env, context.platform);
    const windows = isWindowsPlatform(context.platform);
    if (tool === 'git') {
        if (windows) return unique([...fromPath, ...windowsGitDirectories(context)], context.platform);
        if (context.platform === 'darwin') return unique([...MACOS_GIT_DIRECTORIES, ...fromPath], context.platform);
        return unique(fromPath, context.platform);
    }
    if (tool === 'perl') {
        return unique(windows ? [...fromPath, WINDOWS_STRAWBERRY_PERL] : fromPath, context.platform);
    }
    const known = windows ? await windowsTexDirectories(context) : await unixTexDirectories(context);
    return unique([...fromPath, ...known], context.platform);
}

function unique(directories: readonly string[], platform: NodeJS.Platform): string[] {
    const seen = new Set<string>();
    const pathModule = pathModuleFor(platform);
    return directories.filter((directory) => {
        const key = pathModule.normalize(directory);
        const comparable = isWindowsPlatform(platform) ? key.toLowerCase() : key;
        if (seen.has(comparable)) return false;
        seen.add(comparable);
        return true;
    });
}

function isForbiddenExecutable(file: string, tool: ToolName, platform: NodeJS.Platform): boolean {
    return platform === 'darwin' && tool === 'git' && path.posix.normalize(file) === MACOS_FORBIDDEN_GIT;
}

export async function findExecutable(tool: ToolName, context: ToolsContext): Promise<ExecutableSearch> {
    const pathModule = pathModuleFor(context.platform);
    const windows = isWindowsPlatform(context.platform);
    let scriptOnly: AbsolutePath | null = null;
    for (const directory of await candidateDirectories(tool, context)) {
        const file = pathModule.join(directory, windows ? tool + WINDOWS_EXECUTABLE_EXTENSION : tool);
        if (isForbiddenExecutable(file, tool, context.platform)) continue;
        if (await context.fs.isExecutableFile(file)) return { found: file, scriptOnly: null };
        if (windows && scriptOnly === null) scriptOnly = await findWindowsScript(directory, tool, context);
    }
    return { found: null, scriptOnly };
}

async function findWindowsScript(directory: string, tool: ToolName, context: ToolsContext): Promise<AbsolutePath | null> {
    for (const extension of WINDOWS_SCRIPT_EXTENSIONS) {
        const file = path.win32.join(directory, tool + extension);
        if (await context.fs.isExecutableFile(file)) return file;
    }
    return null;
}

export function detectDistribution(latexmk: AbsolutePath | null, platform: NodeJS.Platform): TexDistribution | null {
    if (latexmk === null) return null;
    const normalized = latexmk.replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/miktex/')) return 'miktex';
    if (platform === 'darwin' && normalized.startsWith(MACOS_TEXBIN.toLowerCase() + '/')) return 'mactex';
    if (normalized.includes('/texlive/')) return 'texlive';
    return 'unknown';
}

function latexmkMissingMessage(platform: NodeJS.Platform): string {
    if (isWindowsPlatform(platform)) return TOOL_MESSAGES.latexmkMissingWindows;
    return platform === 'darwin' ? TOOL_MESSAGES.latexmkMissingMac : TOOL_MESSAGES.latexmkMissingLinux;
}

function missingProblem(tool: ToolName, search: ExecutableSearch, fallbackMessage: string): ToolProblem[] {
    if (search.found !== null) return [];
    const message = search.scriptOnly === null ? fallbackMessage : TOOL_MESSAGES.scriptOnly(tool, search.scriptOnly);
    return [{ tool, message }];
}

// MiKTeX liefert latexmk.exe ohne Perl aus; TeX Live für Windows bringt sein eigenes Perl mit.
async function perlProblems(distro: TexDistribution | null, context: ToolsContext): Promise<ToolProblem[]> {
    if (!isWindowsPlatform(context.platform) || distro !== 'miktex') return [];
    const perl = await findExecutable('perl', context);
    return missingProblem('perl', perl, TOOL_MESSAGES.perlMissing);
}

export async function detectTools(context: ToolsContext = defaultToolsContext()): Promise<ToolsInfo> {
    const latexmk = await findExecutable('latexmk', context);
    const git = await findExecutable('git', context);
    const synctex = await findExecutable('synctex', context);
    const distro = detectDistribution(latexmk.found, context.platform);
    const gitMessage = context.platform === 'darwin' ? TOOL_MESSAGES.gitMissingMac : TOOL_MESSAGES.gitMissing;
    const problems = [
        ...missingProblem('latexmk', latexmk, latexmkMissingMessage(context.platform)),
        ...(await perlProblems(distro, context)),
        ...missingProblem('git', git, gitMessage),
    ];
    return { latexmk: latexmk.found, git: git.found, synctexRef: synctex.found, distro, problems };
}

async function isExecutableOnHost(target: string): Promise<boolean> {
    try {
        const info = await stat(target);
        if (!info.isFile()) return false;
        // Unter Windows gibt es kein Ausführungsrecht; dort entscheidet die Endung (.exe).
        if (!isWindowsPlatform(process.platform)) await access(target, fsConstants.X_OK);
        return true;
    } catch {
        return false;
    }
}

async function listDirectoryOnHost(target: string): Promise<readonly string[]> {
    try {
        return await readdir(target);
    } catch {
        return [];
    }
}

export const NODE_TOOLS_FILE_SYSTEM: ToolsFileSystem = {
    isExecutableFile: isExecutableOnHost,
    listDirectory: listDirectoryOnHost,
};

export function defaultToolsContext(): ToolsContext {
    return { platform: process.platform, env: process.env, fs: NODE_TOOLS_FILE_SYSTEM };
}
