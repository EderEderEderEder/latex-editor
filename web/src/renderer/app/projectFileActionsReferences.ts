// Datei-Aktionen (W2-9): Verweise (`\input`, `\include`, `\includegraphics`, `\bibliography` …) beim Umbenennen und
// Verschieben anpassen (Vorlage `FileActions.swift › referenceEdits/applyReferenceEdits`). Offene Dateien ändert der
// Editor (ein eigener Undo-Schritt; war die Datei vorher gespeichert, wird sie wieder gespeichert), alle anderen der Main
// auf der Platte. Für das App-Rückgängig merkt sich jede Datei ihre Änderungen: Rückgängig setzt genau den alten Text
// zurück (byte-gleich); steht an der Stelle inzwischen etwas anderes, wird für diese Datei neu berechnet.
import type { AbsolutePath, RendererApi, TextFile } from '../../shared/contract';
import { collectFiles } from '../../shared/core/fileTree';
import { computeReferenceEdits, graphicsDirectoriesIn } from '../../shared/core/referenceUpdater';
import type { FileReferenceEdits } from '../../shared/core/referenceUpdater';
import type { EditorStore } from '../stores/editor';
import type { ProjectView } from '../stores/project';
import type { SaveOutcome } from './fileActions';
import { fromRoot, mapPath, nameOf, relativeToRoot } from './projectFileActionsNames';

const TEX_EXTENSION = /\.tex$/i;
const SAVED_OUTCOMES: ReadonlySet<SaveOutcome> = new Set(['saved', 'unchanged']);

export const REFERENCE_TEXTS = {
    changedMeanwhile: 'die Stelle wurde inzwischen geändert',
    notSaved: 'nicht gespeichert',
    readFailed: (detail: string) => `nicht lesbar (${detail})`,
    writeFailed: (detail: string) => `nicht geschrieben (${detail})`,
    failure: (name: string, reason: string) => `${name}: ${reason}`,
    line: (name: string, line: number, oldText: string, newText: string) => `${name}:${line}   ${oldText}  →  ${newText}`,
} as const;

/** Ersetzt `[from, to)` durch `insert`, aber nur, wenn dort noch `expected` steht */
export interface TextEdit {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
    readonly expected: string;
}

export interface ReferenceDeps {
    readonly api: Pick<RendererApi, 'fs'>;
    readonly editor: EditorStore;
    /** Speichert eine offene Datei (wie Strg+S) */
    readonly save: (path: AbsolutePath) => Promise<SaveOutcome>;
}

/** Was eine Verschiebung von `source` nach `target` für die Verweise braucht (Stand beim Planen) */
export interface ReferenceContext {
    readonly root: AbsolutePath;
    readonly source: AbsolutePath;
    readonly target: AbsolutePath;
    /** Hauptdatei, solange der Eintrag bei `source` liegt */
    readonly mainAtSource: AbsolutePath;
    readonly graphicsDirectories: readonly string[];
}

export interface PlannedFile {
    /** Pfad der Datei, solange der Eintrag bei `source` liegt */
    readonly atSource: AbsolutePath;
    readonly edits: readonly TextEdit[];
    /** Je Änderung eine Zeile für die Rückfrage */
    readonly lines: readonly string[];
}

export interface ReferencePlan {
    readonly context: ReferenceContext;
    readonly files: readonly PlannedFile[];
}

/** Richtung einer Anwendung: der Eintrag liegt jetzt bei `to` (vorher bei `from`) */
export interface MoveDirection {
    readonly from: AbsolutePath;
    readonly to: AbsolutePath;
}

// ---------- Text-Änderungen ----------

export function matchesEdits(text: string, edits: readonly TextEdit[]): boolean {
    return edits.every((edit) => edit.to <= text.length && text.slice(edit.from, edit.to) === edit.expected);
}

export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
    let result = text;
    for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
        result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
    }
    return result;
}

/** Gegenänderungen: nach `applyTextEdits(text, edits)` stellt `applyTextEdits(…, invertTextEdits(edits))` `text` her */
export function invertTextEdits(edits: readonly TextEdit[]): TextEdit[] {
    let delta = 0;
    return [...edits].sort((a, b) => a.from - b.from).map((edit) => {
        const from = edit.from + delta;
        delta += edit.insert.length - (edit.to - edit.from);
        return { from, to: from + edit.insert.length, insert: edit.expected, expected: edit.insert };
    });
}

function textEditsOf(file: FileReferenceEdits): TextEdit[] {
    return file.edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert, expected: edit.oldText }));
}

// ---------- Texte lesen ----------

function texFilesOf(project: ProjectView): AbsolutePath[] {
    return collectFiles(project.tree.children)
        .filter((file) => file.isBuildFile !== true && TEX_EXTENSION.test(file.name))
        .map((file) => file.path);
}

interface CurrentText {
    readonly text: string;
    /** Plattenstand mit Hash (nur bei nicht offener Datei) */
    readonly disk: TextFile | null;
}

/** Aktueller Text: offene Datei aus dem Editor, sonst von der Platte */
async function readCurrent(deps: ReferenceDeps, path: AbsolutePath): Promise<CurrentText | string> {
    const session = deps.editor.getState().session(path);
    if (session !== undefined) return { text: session.state.doc.toString(), disk: null };
    const read = await deps.api.fs.readText(path);
    return read.ok ? { text: read.value.text, disk: read.value } : read.error.message;
}

async function textOrNull(deps: ReferenceDeps, path: AbsolutePath): Promise<string | null> {
    const current = await readCurrent(deps, path);
    return typeof current === 'string' ? null : current.text;
}

async function readTexts(deps: ReferenceDeps, paths: readonly AbsolutePath[]): Promise<Map<AbsolutePath, string>> {
    const texts = new Map<AbsolutePath, string>();
    const closed: AbsolutePath[] = [];
    for (const path of paths) {
        const session = deps.editor.getState().session(path);
        if (session === undefined) closed.push(path);
        else texts.set(path, session.state.doc.toString());
    }
    if (closed.length === 0) return texts;
    const read = await deps.api.fs.readMany(closed);
    if (!read.ok) return texts;
    for (const item of read.value) if (item.result.ok) texts.set(item.path, item.result.value.text);
    return texts;
}

// ---------- Planen ----------

function relativeTexts(root: string, texts: ReadonlyMap<AbsolutePath, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [path, text] of texts) {
        const relative = relativeToRoot(root, path);
        if (relative !== null) result[relative] = text;
    }
    return result;
}

function editsFor(context: ReferenceContext, mainFile: string, move: MoveDirection, texts: Record<string, string>) {
    const relative = (path: string): string => relativeToRoot(context.root, path) ?? path;
    return computeReferenceEdits({
        moving: relative(move.from), to: relative(move.to), mainFile: relative(mainFile),
        graphicsDirectories: context.graphicsDirectories, texts,
    });
}

function plannedFile(root: string, file: FileReferenceEdits): PlannedFile {
    const atSource = fromRoot(root, file.file);
    const name = nameOf(atSource);
    const lines = file.edits.map((edit) => REFERENCE_TEXTS.line(name, edit.line, edit.oldText, edit.insert));
    return { atSource, edits: textEditsOf(file), lines };
}

/** Verweise, die durch `source` → `target` ungültig würden; `null` ohne Hauptdatei oder ohne Treffer */
export async function planReferenceEdits(
    deps: ReferenceDeps, project: ProjectView, source: AbsolutePath, target: AbsolutePath,
): Promise<ReferencePlan | null> {
    const mainFile = project.mainFile;
    if (mainFile === null) return null;
    const texts = await readTexts(deps, texFilesOf(project));
    const graphicsDirectories = graphicsDirectoriesIn(texts.get(mainFile) ?? '');
    const context: ReferenceContext = { root: project.root, source, target, mainAtSource: mainFile, graphicsDirectories };
    const edits = editsFor(context, mainFile, { from: source, to: target }, relativeTexts(project.root, texts));
    const files = edits.map((file) => plannedFile(project.root, file));
    return files.length === 0 ? null : { context, files };
}

export function planLines(plan: ReferencePlan): string[] {
    return plan.files.flatMap((file) => file.lines);
}

export function planEditCount(plan: ReferencePlan): number {
    return plan.files.reduce((sum, file) => sum + file.edits.length, 0);
}

// ---------- Anwenden ----------

/** Neu berechnete Änderungen für eine Datei, wenn die gemerkten nicht mehr passen */
async function recomputedEdits(
    deps: ReferenceDeps, context: ReferenceContext, path: AbsolutePath, text: string, move: MoveDirection,
): Promise<TextEdit[]> {
    const relative = relativeToRoot(context.root, path);
    if (relative === null) return [];
    const mainFile = mapPath(context.mainAtSource, context.source, move.to);
    const mainText = mainFile === path ? text : await textOrNull(deps, mainFile);
    const graphicsDirectories = mainText === null ? context.graphicsDirectories : graphicsDirectoriesIn(mainText);
    const edits = editsFor({ ...context, graphicsDirectories }, mainFile, move, { [relative]: text });
    return edits.flatMap(textEditsOf);
}

async function writeOpenFile(deps: ReferenceDeps, path: AbsolutePath, newText: string): Promise<string | null> {
    const session = deps.editor.getState().session(path);
    if (session === undefined) return REFERENCE_TEXTS.notSaved;
    const wasDirty = session.isDirty;
    session.replaceText(newText);
    if (wasDirty) return null;
    return SAVED_OUTCOMES.has(await deps.save(path)) ? null : REFERENCE_TEXTS.notSaved;
}

async function writeClosedFile(deps: ReferenceDeps, disk: TextFile, newText: string): Promise<string | null> {
    const written = await deps.api.fs.writeText(disk.path, newText, disk.encoding, disk.eol, disk.hash);
    return written.ok ? null : REFERENCE_TEXTS.writeFailed(written.error.message);
}

export interface FileEditResult {
    /** Tatsächlich angewendete Änderungen (leer, wenn nichts geschah) */
    readonly applied: readonly TextEdit[];
    readonly failure: string | null;
}

/** Wendet `edits` auf die Datei an `path` an; passt der Text nicht mehr, wird für `move` neu berechnet */
export async function applyFileEdits(
    deps: ReferenceDeps, context: ReferenceContext, path: AbsolutePath, edits: readonly TextEdit[], move: MoveDirection,
): Promise<FileEditResult> {
    const failed = (reason: string): FileEditResult => ({ applied: [], failure: REFERENCE_TEXTS.failure(nameOf(path), reason) });
    const current = await readCurrent(deps, path);
    if (typeof current === 'string') return failed(REFERENCE_TEXTS.readFailed(current));
    const usable = matchesEdits(current.text, edits) ? edits : await recomputedEdits(deps, context, path, current.text, move);
    if (usable.length === 0) return failed(REFERENCE_TEXTS.changedMeanwhile);
    const newText = applyTextEdits(current.text, usable);
    if (current.disk !== null) {
        const problem = await writeClosedFile(deps, current.disk, newText);
        return problem === null ? { applied: usable, failure: null } : failed(problem);
    }
    // Im Editor ist die Änderung auch dann geschehen, wenn das anschließende Speichern scheitert
    const problem = await writeOpenFile(deps, path, newText);
    return { applied: usable, failure: problem === null ? null : failed(problem).failure };
}
