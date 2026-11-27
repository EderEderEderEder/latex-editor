import type { GitError, GitErrorKind, GitFileState } from '../shared/contract';
import { isPathWithin, type PathPlatform } from './paths';

// Reine Git-Logik ohne Prozesse (W6-2, Vorlage `swift/Sources/LatexEditor/Model/GitStatus.swift`, `Git.swift`,
// `GitStore.swift`; Vektoren `shared/spec/git-status.json`): Parser für `git status --porcelain=v2 -z --branch`,
// deutsche Meldungen zu Git-Fehlern, Pfade in `.git` und die Zuordnung Repository-Pfad → Projektpfad.

/** Zweig-Zeilen aus `git status --branch`; `head` null = losgelöster HEAD, `commit` null = noch kein Commit */
export interface GitBranchInfo {
    readonly head: string | null;
    readonly commit: string | null;
    readonly upstream: string | null;
    readonly ahead: number;
    readonly behind: number;
}

/** Eine Datei aus `git status`, Pfade relativ zur Wurzel des Repositorys mit `/`; Zustand null = unverändert */
export interface GitStatusRecord {
    readonly path: string;
    readonly originalPath: string | null;
    readonly indexKind: GitFileState | null;
    readonly worktreeKind: GitFileState | null;
}

export interface GitStatusSnapshot {
    readonly branch: GitBranchInfo;
    readonly entries: readonly GitStatusRecord[];
}

export interface GitChange {
    readonly path: string;
    readonly originalPath: string | null;
    readonly kind: GitFileState;
}

const RECORD_SEPARATOR = '\u0000';
const HEADER_PREFIX = '# ';
const RENAMED_PREFIX = '2 ';
const HEADER_PART_COUNT = 3;
// Feste Felder vor dem Pfad: `1 XY sub mH mI mW hH hI pfad`, `2 … Xscore pfad`, `u XY sub m1 m2 m3 mW h1 h2 h3 pfad`
const ORDINARY_FIELD_COUNT = 8;
const RENAMED_FIELD_COUNT = 9;
const UNMERGED_FIELD_COUNT = 10;
const STATUS_CODE_LENGTH = 2;
const UNTRACKED_PATH_START = 2;
const INITIAL_COMMIT = '(initial)';
const DETACHED_HEAD = '(detached)';
const SHORT_COMMIT_LENGTH = 7;
const NO_BRANCH_NAME = '–';

const STATUS_CODES: Readonly<Record<string, GitFileState>> = {
    M: 'modified',
    T: 'typeChanged',
    A: 'added',
    D: 'deleted',
    R: 'renamed',
    C: 'copied',
    U: 'conflicted',
};

const EMPTY_BRANCH: GitBranchInfo = { head: null, commit: null, upstream: null, ahead: 0, behind: 0 };

function kindForCode(code: string): GitFileState | null {
    return Object.hasOwn(STATUS_CODES, code) ? (STATUS_CODES[code] ?? null) : null;
}

// Wie Swift `split(maxSplits:omittingEmptySubsequences: false)`: der Rest nach `fieldCount` Leerzeichen ist der Pfad.
function splitFields(record: string, fieldCount: number): { fields: string[]; path: string } | null {
    const fields: string[] = [];
    let start = 0;
    for (let index = 0; index < fieldCount; index++) {
        const space = record.indexOf(' ', start);
        if (space < 0) return null;
        fields.push(record.slice(start, space));
        start = space + 1;
    }
    return { fields, path: record.slice(start) };
}

function parseChanged(record: string, fieldCount: number, originalPath: string | null): GitStatusRecord | null {
    const split = splitFields(record, fieldCount);
    const codes = split?.fields[1];
    if (split === null || codes === undefined || codes.length !== STATUS_CODE_LENGTH) return null;
    return {
        path: split.path,
        originalPath,
        indexKind: kindForCode(codes.charAt(0)),
        worktreeKind: kindForCode(codes.charAt(1)),
    };
}

function parseEntry(record: string): GitStatusRecord | null {
    switch (record.charAt(0)) {
        case '1':
            return parseChanged(record, ORDINARY_FIELD_COUNT, null);
        case 'u': {
            const split = splitFields(record, UNMERGED_FIELD_COUNT);
            return split === null ? null : { path: split.path, originalPath: null, indexKind: null, worktreeKind: 'conflicted' };
        }
        case '?':
            return { path: record.slice(UNTRACKED_PATH_START), originalPath: null, indexKind: null, worktreeKind: 'untracked' };
        default:
            // `!` (ignoriert) und Unbekanntes
            return null;
    }
}

function parseAheadBehind(value: string, branch: GitBranchInfo): GitBranchInfo {
    let { ahead, behind } = branch;
    for (const part of value.split(' ').filter((piece) => piece !== '')) {
        const number = Number(part.slice(1));
        if (part.length < 2 || !Number.isInteger(number)) continue;
        if (part.startsWith('+')) ahead = number;
        if (part.startsWith('-')) behind = number;
    }
    return { ...branch, ahead, behind };
}

function parseHeader(record: string, branch: GitBranchInfo): GitBranchInfo {
    const words = record.split(' ').filter((part) => part !== '');
    if (words.length < HEADER_PART_COUNT) return branch;
    // Höchstens zweimal teilen: der Wert darf Leerzeichen enthalten (z. B. `+2 -1`).
    const key = words[1] ?? '';
    const value = record.slice(record.indexOf(key) + key.length).trim();
    switch (key) {
        case 'branch.oid':
            return { ...branch, commit: value === INITIAL_COMMIT ? null : value };
        case 'branch.head':
            return { ...branch, head: value === DETACHED_HEAD ? null : value };
        case 'branch.upstream':
            return { ...branch, upstream: value };
        case 'branch.ab':
            return parseAheadBehind(value, branch);
        default:
            return branch;
    }
}

/** Liest die rohe Ausgabe von `git status --porcelain=v2 -z --branch --untracked-files=all` (schon als UTF-8-Text) */
export function parseStatus(output: string): GitStatusSnapshot {
    const records = output.split(RECORD_SEPARATOR).filter((record) => record !== '');
    let branch = EMPTY_BRANCH;
    const entries: GitStatusRecord[] = [];
    for (let index = 0; index < records.length; index++) {
        const record = records[index] ?? '';
        if (record.startsWith(HEADER_PREFIX)) {
            branch = parseHeader(record, branch);
            continue;
        }
        let entry: GitStatusRecord | null;
        if (record.startsWith(RENAMED_PREFIX)) {
            // Der ursprüngliche Pfad folgt als eigener Eintrag und wird immer verbraucht.
            index += 1;
            entry = parseChanged(record, RENAMED_FIELD_COUNT, records[index] ?? null);
        } else {
            entry = parseEntry(record);
        }
        if (entry !== null) entries.push(entry);
    }
    return { branch, entries };
}

export function stagedChanges(snapshot: GitStatusSnapshot): GitChange[] {
    return snapshot.entries.flatMap((entry) =>
        entry.indexKind === null ? [] : [{ path: entry.path, originalPath: entry.originalPath, kind: entry.indexKind }],
    );
}

export function unstagedChanges(snapshot: GitStatusSnapshot): GitChange[] {
    return snapshot.entries.flatMap((entry) => {
        if (entry.worktreeKind === null) return [];
        const originalPath = entry.worktreeKind === 'renamed' ? entry.originalPath : null;
        return [{ path: entry.path, originalPath, kind: entry.worktreeKind }];
    });
}

export function hasCommits(branch: GitBranchInfo): boolean {
    return branch.commit !== null;
}

export function displayName(branch: GitBranchInfo): string {
    if (branch.head !== null) return branch.head;
    if (branch.commit !== null) return branch.commit.slice(0, SHORT_COMMIT_LENGTH);
    return NO_BRANCH_NAME;
}

// ---------- Meldungen (git läuft mit LC_ALL=C, also auf Englisch) ----------

interface MessageRule {
    readonly patterns: readonly string[];
    readonly kind: GitErrorKind;
    readonly message: (trimmed: string) => string;
}

export const GIT_MESSAGES = {
    identity:
        'Git kennt deinen Namen und deine E-Mail-Adresse noch nicht. Bitte einmalig im Terminal setzen:\n\n'
        + 'git config --global user.name "Vorname Nachname"\ngit config --global user.email "name@example.com"',
    lock: 'Ein anderer Git-Vorgang läuft gerade (index.lock existiert). Bitte kurz warten und erneut versuchen.',
    nothingToCommit: 'Es gibt nichts zu committen.',
    auth:
        'Die Anmeldung beim Remote ist fehlgeschlagen. Die App kann nicht nach Passwörtern fragen.\n'
        + 'Bitte einmal im Terminal „git push“ (bzw. „git pull“) im Projektordner ausführen und sich anmelden. '
        + 'Danach liegt die Anmeldung im Schlüsselbund, und die App kann sie benutzen.',
    unreachable: (detail: string) => `Der Remote ist nicht erreichbar. Besteht eine Internetverbindung?\n\n${detail}`,
    rejected: 'Der Remote hat Commits, die lokal noch fehlen. Erst Pull, dann Push.',
    diverged:
        'Lokaler Stand und Remote sind auseinandergelaufen: Beide haben neue Commits. '
        + 'Die App holt nur Änderungen, die sich ohne Zusammenführen übernehmen lassen. '
        + 'Zusammenführen bitte im Terminal („git pull“).',
    noUpstream: 'Für diesen Branch ist noch kein Remote-Branch eingerichtet. Zuerst Push ausführen.',
    noRemote: 'Für dieses Repository ist kein Remote eingerichtet.',
    overwritten: 'Lokale Änderungen würden überschrieben. Bitte zuerst committen oder verwerfen.',
    invalidBranch: 'Ungültiger Branch-Name (keine Leerzeichen, kein „..“, nicht mit „-“ beginnen).',
    branchExists: 'Ein Branch mit diesem Namen existiert bereits.',
    failed: 'Git ist fehlgeschlagen.',
    reported: (detail: string) => `Git meldet:\n${detail}`,
} as const;

const TAB = '\t';

function overwrittenMessage(trimmed: string): string {
    const files = trimmed.split('\n').filter((line) => line.startsWith(TAB)).map((line) => line.trim());
    return files.length === 0 ? GIT_MESSAGES.overwritten : `${GIT_MESSAGES.overwritten}\n\n${files.join('\n')}`;
}

const fixed = (text: string) => () => text;

// Reihenfolge wie Swift `GitError.userMessage`: die erste zutreffende Regel gewinnt.
const MESSAGE_RULES: readonly MessageRule[] = [
    { patterns: ['Author identity unknown', 'Please tell me who you are', 'empty ident name'], kind: 'gitFailed', message: fixed(GIT_MESSAGES.identity) },
    { patterns: ['index.lock'], kind: 'gitFailed', message: fixed(GIT_MESSAGES.lock) },
    { patterns: ['nothing to commit', 'nothing added to commit'], kind: 'nothingToCommit', message: fixed(GIT_MESSAGES.nothingToCommit) },
    {
        patterns: ['Authentication failed', 'could not read Username', 'could not read Password', 'terminal prompts disabled', 'Permission denied (publickey'],
        kind: 'authRequired',
        message: fixed(GIT_MESSAGES.auth),
    },
    {
        patterns: ['Could not resolve host', 'Network is unreachable', 'Operation timed out', 'Connection refused', 'Connection timed out', 'Failed to connect', 'too slow', 'Could not read from remote'],
        kind: 'network',
        message: GIT_MESSAGES.unreachable,
    },
    { patterns: ['[rejected]', 'fetch first', 'non-fast-forward'], kind: 'nonFastForward', message: fixed(GIT_MESSAGES.rejected) },
    { patterns: ['Not possible to fast-forward', 'Diverging branches', 'have diverged'], kind: 'nonFastForward', message: fixed(GIT_MESSAGES.diverged) },
    { patterns: ['There is no tracking information', 'has no upstream branch'], kind: 'noUpstream', message: fixed(GIT_MESSAGES.noUpstream) },
    {
        patterns: ['No configured push destination', 'No remote repository specified', 'does not appear to be a git repository'],
        kind: 'gitFailed',
        message: fixed(GIT_MESSAGES.noRemote),
    },
    { patterns: ['would be overwritten by', 'untracked working tree files would be'], kind: 'gitFailed', message: overwrittenMessage },
    { patterns: ['is not a valid branch name'], kind: 'gitFailed', message: fixed(GIT_MESSAGES.invalidBranch) },
    { patterns: ['already exists'], kind: 'gitFailed', message: fixed(GIT_MESSAGES.branchExists) },
];

/** Übersetzt eine Git-Meldung (stderr, ggf. mit stdout) in einen `GitError` mit deutschem Text */
export function gitErrorFor(message: string): GitError {
    const trimmed = message.trim();
    const rule = MESSAGE_RULES.find((candidate) => candidate.patterns.some((pattern) => trimmed.includes(pattern)));
    if (rule !== undefined) return { kind: rule.kind, message: rule.message(trimmed) };
    return { kind: 'gitFailed', message: trimmed === '' ? GIT_MESSAGES.failed : GIT_MESSAGES.reported(trimmed) };
}

export function userMessage(message: string): string {
    return gitErrorFor(message).message;
}

// ---------- Pfade in `.git` (für die Überwachung, W6-4) ----------

const RELEVANT_GIT_FILES: ReadonlySet<string> = new Set(['index', 'HEAD', 'packed-refs', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'config']);
const LOCK_SUFFIX = '.lock';
const REFS_PREFIX = 'refs/';
const PRIVATE_PREFIX = '/private';
const GIT_DIRECTORY_SEGMENT = '/.git/';
const GIT_DIRECTORY_SUFFIX = '/.git';

/** Nur Index, HEAD, Refs und Konfiguration ändern den Status; Objekte, Logs und Sperren nicht */
export function isRelevantInternalPath(path: string): boolean {
    if (path.endsWith(LOCK_SUFFIX)) return false;
    return RELEVANT_GIT_FILES.has(path) || path.startsWith(REFS_PREFIX);
}

// macOS: dieselben Ordner heißen `/var/…` und `/private/var/…`.
function gitDirectoryVariants(gitDirectory: string): string[] {
    const other = gitDirectory.startsWith(PRIVATE_PREFIX + '/') ? gitDirectory.slice(PRIVATE_PREFIX.length) : PRIVATE_PREFIX + gitDirectory;
    return [gitDirectory, other];
}

/** Pfad relativ zum `.git`-Ordner (POSIX-Pfade), `null` für Dateien außerhalb */
export function pathInsideGitDirectory(path: string, gitDirectory: string): string | null {
    for (const variant of gitDirectoryVariants(gitDirectory)) {
        if (path === variant) return '';
        if (path.startsWith(variant + '/')) return path.slice(variant.length + 1);
    }
    const last = path.lastIndexOf(GIT_DIRECTORY_SEGMENT);
    if (last >= 0) return path.slice(last + GIT_DIRECTORY_SEGMENT.length);
    return path.endsWith(GIT_DIRECTORY_SUFFIX) ? '' : null;
}

// ---------- Projekt in einem Unterordner des Repositorys ----------

const GIT_PATH_SEPARATOR = '/';

/** Projektordner relativ zur Wurzel mit `/`, `null`, wenn er die Wurzel ist oder nicht darunter liegt. Beide Pfade schon aufgelöst. */
export function projectPrefix(root: string, projectRoot: string, platform: PathPlatform): string | null {
    if (!isPathWithin(projectRoot, root, platform)) return null;
    const relative = platform.path.relative(root, projectRoot);
    if (relative === '') return null;
    return relative.split(platform.path.sep).join(GIT_PATH_SEPARATOR);
}

function unicodeForm(text: string, platform: PathPlatform): string {
    return platform.unicodeInsensitive ? text.normalize('NFC') : text;
}

function startsWithPrefix(path: string, head: string, platform: PathPlatform): boolean {
    if (platform.caseSensitive) return path.startsWith(head);
    return path.slice(0, head.length).toLowerCase() === head.toLowerCase();
}

/** Absoluter Pfad im Projekt (in der Form von `projectRoot`) zu einem Repository-Pfad, `null` außerhalb des Projekts */
export function projectPathFor(repositoryPath: string, projectRoot: string, prefix: string | null, platform: PathPlatform): string | null {
    let relative = repositoryPath;
    if (prefix !== null) {
        // Unter macOS/Windows zählen Groß-/Kleinschreibung (und unter macOS die Unicode-Form) nicht.
        const head = unicodeForm(prefix + GIT_PATH_SEPARATOR, platform);
        const candidate = unicodeForm(repositoryPath, platform);
        if (!startsWithPrefix(candidate, head, platform)) return null;
        relative = candidate.slice(head.length);
    }
    const joined = platform.path.join(projectRoot, ...relative.split(GIT_PATH_SEPARATOR));
    // Git liefert nie `..`; trotzdem nichts außerhalb des Projekts herausgeben.
    return isPathWithin(joined, projectRoot, platform) ? joined : null;
}
