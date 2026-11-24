import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import type { DirectoryNode, EpochMillis, FileNode, TreeNode } from '../shared/contract';
import { findCommentStart } from '../shared/core/latex/comments';
import { IpcFailure } from '../shared/ipcResult';
import { comparisonKey, type PathPlatform } from './paths';
import { readTextFile, writeTextFile } from './textIo';

// Projekt laden (Dateibaum, Build-Dateien, Hauptdatei) und „Zuletzt geöffnet“. Nur `node:*`, alles asynchron.
// Verhalten wie die Swift-Version (FileTreeLoader, BuildArtifacts, MainFileDetector, RecentProjectList).

// ---------- Dateibaum ----------

export const MAX_TREE_DEPTH = 12;
export const MAX_TREE_ENTRIES = 20_000;
// Ordner, die nie in den Baum kommen (riesig, nie vom Nutzer bearbeitet); Vergleich in Kleinbuchstaben.
export const SKIPPED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(['node_modules']);

const HIDDEN_PREFIX = '.';

// Dateiknoten mit Kennzeichen; das UI blendet Build-Dateien aus (der Vertrag kennt das Feld noch nicht, ein
// `FileNode` bleibt es strukturell).
export interface ProjectFileNode extends FileNode {
    readonly isBuildFile: boolean;
}

export interface ScanResult {
    readonly tree: DirectoryNode;
    // Tiefen- oder Mengengrenze erreicht: der Baum ist unvollständig.
    readonly truncated: boolean;
}

export interface ScanLimits {
    readonly maxDepth: number;
    readonly maxEntries: number;
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = { maxDepth: MAX_TREE_DEPTH, maxEntries: MAX_TREE_ENTRIES };

const BUILD_EXTENSIONS: ReadonlySet<string> = new Set([
    'aux', 'log', 'toc', 'lof', 'lot', 'out', 'bbl', 'blg', 'bcf', 'fls', 'fdb_latexmk', 'nav', 'snm', 'vrb', 'idx',
    'ind', 'ilg', 'glo', 'gls', 'glg', 'acn', 'acr', 'alg', 'xdv', 'dvi', 'synctex', 'thm', 'loa', 'lol',
]);
const BUILD_SUFFIXES: readonly string[] = ['.synctex.gz', '.run.xml', '-blx.bib', '.synctex(busy)', '.bib.bak'];

export function fileExtensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isBuildFileName(name: string): boolean {
    const lower = name.toLowerCase();
    return BUILD_SUFFIXES.some((suffix) => lower.endsWith(suffix)) || BUILD_EXTENSIONS.has(fileExtensionOf(lower));
}

const nameCollator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

// Ordner zuerst, dann natürlich (kapitel2 vor kapitel10), Groß-/Kleinschreibung egal.
export function compareTreeNodes(first: TreeNode, second: TreeNode): number {
    if (first.kind !== second.kind) return first.kind === 'directory' ? -1 : 1;
    return nameCollator.compare(first.name, second.name) || (first.name < second.name ? -1 : first.name > second.name ? 1 : 0);
}

interface ScanState {
    readonly limits: ScanLimits;
    entries: number;
    truncated: boolean;
}

async function readEntries(directory: string): Promise<import('node:fs').Dirent[] | null> {
    try {
        return await fsp.readdir(directory, { withFileTypes: true });
    } catch {
        return null;
    }
}

function isSkipped(name: string, isDirectory: boolean): boolean {
    if (name.startsWith(HIDDEN_PREFIX)) return true;
    return isDirectory && SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

// Symlinks (auch Junctions) werden weder gefolgt noch gelistet: so führt kein Eintrag aus dem Projekt hinaus.
async function scanDirectory(path: string, name: string, depth: number, state: ScanState): Promise<DirectoryNode> {
    const children: TreeNode[] = [];
    const node: DirectoryNode = { kind: 'directory', name, path, children };
    if (depth >= state.limits.maxDepth) {
        state.truncated = true;
        return node;
    }
    const entries = await readEntries(path);
    for (const entry of entries ?? []) {
        if (isSkipped(entry.name, entry.isDirectory())) continue;
        if (!entry.isDirectory() && !entry.isFile()) continue;
        if (state.entries >= state.limits.maxEntries) {
            state.truncated = true;
            break;
        }
        state.entries++;
        const childPath = join(path, entry.name);
        children.push(
            entry.isDirectory()
                ? await scanDirectory(childPath, entry.name, depth + 1, state)
                : { kind: 'file', name: entry.name, path: childPath, isBuildFile: isBuildFileName(entry.name) } as ProjectFileNode,
        );
    }
    children.sort(compareTreeNodes);
    return node;
}

export async function scanProjectTree(root: string, limits: ScanLimits = DEFAULT_SCAN_LIMITS): Promise<ScanResult> {
    const state: ScanState = { limits, entries: 0, truncated: false };
    const tree = await scanDirectory(root, rootName(root), 0, state);
    return { tree, truncated: state.truncated };
}

function rootName(root: string): string {
    return root.split(/[\\/]/).filter((part) => part.length > 0).at(-1) ?? root;
}

// ---------- Hauptdatei ----------

export const MAIN_FILE_NAME = 'main.tex';
const HEADER_READ_LIMIT_BYTES = 64 * 1024;
const MAX_MAIN_FILE_CANDIDATES = 200;
const DOCUMENT_CLASS = '\\documentclass';

interface TexCandidate {
    readonly path: string;
    readonly name: string;
    readonly depth: number;
}

function collectTexFiles(directory: DirectoryNode, depth: number, found: TexCandidate[]): void {
    for (const child of directory.children) {
        if (child.kind === 'directory') collectTexFiles(child, depth + 1, found);
        else if (fileExtensionOf(child.name) === 'tex') found.push({ path: child.path, name: child.name, depth });
    }
}

// Flachere Dateien zuerst, auf einer Ebene `main.tex`, dann nach Namen.
function compareCandidates(first: TexCandidate, second: TexCandidate): number {
    if (first.depth !== second.depth) return first.depth - second.depth;
    const firstIsMain = first.name === MAIN_FILE_NAME;
    if (firstIsMain !== (second.name === MAIN_FILE_NAME)) return firstIsMain ? -1 : 1;
    return nameCollator.compare(first.name, second.name);
}

export function declaresDocumentClass(text: string): boolean {
    return text.split('\n').some((line) => {
        const commentStart = findCommentStart(line);
        const code = commentStart === null ? line : line.slice(0, commentStart);
        return code.trimStart().startsWith(DOCUMENT_CLASS);
    });
}

async function readHeader(path: string): Promise<string> {
    let handle: fsp.FileHandle | undefined;
    try {
        handle = await fsp.open(path, 'r');
        const buffer = Buffer.alloc(HEADER_READ_LIMIT_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, HEADER_READ_LIMIT_BYTES, 0);
        return buffer.toString('utf8', 0, bytesRead);
    } catch {
        return '';
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

// Erste `.tex` mit `\documentclass` (flach zuerst, `main.tex` zuerst), sonst `main.tex` im Projektordner, sonst `null`.
export async function detectMainFile(tree: DirectoryNode): Promise<string | null> {
    const candidates: TexCandidate[] = [];
    collectTexFiles(tree, 0, candidates);
    candidates.sort(compareCandidates);
    for (const candidate of candidates.slice(0, MAX_MAIN_FILE_CANDIDATES)) {
        if (declaresDocumentClass(await readHeader(candidate.path))) return candidate.path;
    }
    return candidates.find((candidate) => candidate.depth === 0 && candidate.name === MAIN_FILE_NAME)?.path ?? null;
}

// ---------- Zuletzt geöffnet ----------

export const RECENT_FILE_NAME = 'recent-projects.json';
export const RECENT_VERSION = 1;
export const MAX_RECENT_PROJECTS = 10;

export interface RecentEntry {
    readonly path: string;
    readonly openedAt: EpochMillis;
}

export interface RecentStoreOptions {
    readonly now?: () => Date;
}

function isRecentEntry(value: unknown): value is RecentEntry {
    if (typeof value !== 'object' || value === null) return false;
    const { path, openedAt } = value as Record<string, unknown>;
    return typeof path === 'string' && path.length > 0 && typeof openedAt === 'number' && Number.isFinite(openedAt);
}

// `null` = Datei unbrauchbar (kein JSON, falsche Form, neuere Version); einzelne kaputte Einträge entfallen.
function parseRecentFile(text: string): RecentEntry[] | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof raw !== 'object' || raw === null) return null;
    const { version, projects } = raw as Record<string, unknown>;
    if (version !== RECENT_VERSION || !Array.isArray(projects)) return null;
    return projects.filter(isRecentEntry);
}

export class RecentProjectsStore {
    private queue: Promise<unknown> = Promise.resolve();
    private readonly now: () => Date;

    constructor(
        private readonly directory: string,
        private readonly platform: PathPlatform,
        options: RecentStoreOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
    }

    get filePath(): string {
        return join(this.directory, RECENT_FILE_NAME);
    }

    // Neueste zuerst, höchstens `MAX_RECENT_PROJECTS`.
    list(): Promise<RecentEntry[]> {
        return this.serialized(() => this.load());
    }

    add(path: string): Promise<void> {
        return this.serialized(async () => {
            const key = comparisonKey(path, this.platform);
            const others = (await this.load()).filter((entry) => comparisonKey(entry.path, this.platform) !== key);
            await this.save([{ path, openedAt: this.now().getTime() }, ...others].slice(0, MAX_RECENT_PROJECTS));
        });
    }

    remove(path: string): Promise<void> {
        return this.serialized(async () => {
            const key = comparisonKey(path, this.platform);
            await this.save((await this.load()).filter((entry) => comparisonKey(entry.path, this.platform) !== key));
        });
    }

    // Aufrufe nacheinander, damit zwei `add` nicht gegeneinander schreiben; ein Fehler blockiert die Schlange nicht.
    private serialized<T>(task: () => Promise<T>): Promise<T> {
        const result = this.queue.then(task, task);
        this.queue = result.catch(() => undefined);
        return result;
    }

    private async load(): Promise<RecentEntry[]> {
        let text: string;
        try {
            text = (await readTextFile(this.filePath)).text;
        } catch (error) {
            if (error instanceof IpcFailure && error.error.kind === 'notFound') return [];
            throw error;
        }
        const entries = parseRecentFile(text);
        if (entries === null) {
            await this.setAside();
            return [];
        }
        return entries.slice(0, MAX_RECENT_PROJECTS);
    }

    private async setAside(): Promise<void> {
        const stamp = this.now().toISOString().replace(/[:.]/g, '-');
        await fsp.rename(this.filePath, join(this.directory, `recent-projects.defekt-${stamp}.json`));
    }

    private async save(entries: readonly RecentEntry[]): Promise<void> {
        await fsp.mkdir(this.directory, { recursive: true });
        const content = JSON.stringify({ version: RECENT_VERSION, projects: entries }, null, 4);
        await writeTextFile(this.filePath, content, 'utf8', 'lf');
    }
}

// Nur noch vorhandene Ordner; weggefallene bleiben in der Datei, bis sie aus den zehn herausfallen.
export async function existingRecentEntries(store: RecentProjectsStore): Promise<RecentEntry[]> {
    const existing: RecentEntry[] = [];
    for (const entry of await store.list()) {
        const info = await fsp.stat(entry.path).catch(() => null);
        if (info?.isDirectory() === true) existing.push(entry);
    }
    return existing;
}
