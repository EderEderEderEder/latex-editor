// Einfügen-Fenster (W4-10): was das Fenster vom Projekt braucht (Vorlage `ProjectCatalog.scan` und `reloadCatalog`):
// Labels und Literaturschlüssel kommen aus dem Projektindex der Vervollständigung (`completionIndex*.ts`), dazu der
// Stand der vorderen `.tex`-Datei (frisch Getipptes steht noch nicht im Index), die Bilder aus dem Dateibaum,
// `\graphicspath` und die Literaturdatei aus der Hauptdatei.
import type { DirectoryNode, FileNode, RendererApi } from '../../shared/contract';
import { bibTarget } from '../../shared/core/bib/sourceBuilder';
import { graphicsDirectories, labelsInText } from '../../shared/core/insertion';
import type { EditorStore } from '../stores/editor';
import type { ProjectStore, ProjectView } from '../stores/project';
import { relativeWithin } from './completionIndexLogic';
import type { CompletionIndexSnapshot, LabelItem } from './completionIndexLogic';
import { EMPTY_INSERT_CATALOG } from './insertLogic';
import type { BibliographyTarget, InsertCatalog, ProjectImage } from './insertLogic';

/** Was `\includegraphics` mit pdfLaTeX einbinden kann (Bild-Import im Main erlaubt genau diese) */
export const INSERTABLE_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'pdf']);
const TEX_EXTENSION = '.tex';
const SEPARATOR = '/';
const BACKSLASH = /\\/g;

export interface InsertCatalogDeps {
    readonly api: Pick<RendererApi, 'fs'>;
    readonly editor: EditorStore;
    readonly project: ProjectStore;
    readonly completionIndex: () => CompletionIndexSnapshot;
}

export function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isTexName(name: string): boolean {
    return name.toLowerCase().endsWith(TEX_EXTENSION);
}

function collectFiles(node: DirectoryNode, files: FileNode[]): FileNode[] {
    for (const child of node.children) {
        if (child.kind === 'directory') collectFiles(child, files);
        else if (child.isBuildFile !== true) files.push(child);
    }
    return files;
}

function imagesOf(project: ProjectView, files: readonly FileNode[]): ProjectImage[] {
    const images: ProjectImage[] = [];
    for (const file of files) {
        const relative = relativeWithin(project.root, file.path);
        if (relative === null || !INSERTABLE_IMAGE_EXTENSIONS.has(extensionOf(file.name))) continue;
        images.push({ path: file.path, relative });
    }
    return images.sort((left, right) => left.relative.localeCompare(right.relative, undefined, { numeric: true }));
}

/** Text der Hauptdatei: aus dem offenen Tab (auch Ungespeichertes), sonst von der Platte; `null` ohne Hauptdatei */
async function mainTextOf(deps: InsertCatalogDeps, mainFile: string | null): Promise<string | null> {
    if (mainFile === null) return null;
    const session = deps.editor.getState().session(mainFile);
    if (session !== undefined && !session.isDisposed) return session.state.doc.toString();
    const result = await deps.api.fs.readText(mainFile);
    return result.ok ? result.value.text : null;
}

function directoryOf(path: string): string {
    const normalized = path.replace(BACKSLASH, SEPARATOR);
    return normalized.slice(0, Math.max(0, normalized.lastIndexOf(SEPARATOR)));
}

/** Die Literaturdatei, in die neue Quellen kommen (`bibTarget` rechnet mit Pfaden relativ zur Hauptdatei) */
function bibliographyOf(project: ProjectView, files: readonly FileNode[], mainText: string | null): BibliographyTarget | null {
    const base = project.mainFile === null ? project.root : directoryOf(project.mainFile);
    const byRelative = new Map<string, FileNode>();
    for (const file of files) {
        const relative = relativeWithin(base, file.path);
        if (relative !== null) byRelative.set(relative, file);
    }
    const target = bibTarget({ mainText, projectFiles: [...byRelative.keys()] });
    const file = target === null ? undefined : byRelative.get(target);
    return file === undefined ? null : { path: file.path, name: file.name };
}

/** Labels des Index plus die der vorderen `.tex`-Datei, die der Index (entprellt) noch nicht kennt */
function labelsWithActiveFile(deps: InsertCatalogDeps, indexed: readonly LabelItem[]): LabelItem[] {
    const labels = [...indexed];
    const session = deps.editor.getState().activeSession();
    if (session === null || !isTexName(session.file.name)) return sorted(labels);
    const known = new Set(labels.map((entry) => entry.label));
    for (const entry of labelsInText(session.state.doc.toString(), session.file.name)) {
        if (known.has(entry.label)) continue;
        known.add(entry.label);
        labels.push(entry);
    }
    return sorted(labels);
}

function sorted(labels: LabelItem[]): LabelItem[] {
    return labels.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

export async function loadInsertCatalog(deps: InsertCatalogDeps): Promise<InsertCatalog> {
    const index = deps.completionIndex();
    const base: InsertCatalog = {
        ...EMPTY_INSERT_CATALOG,
        labels: labelsWithActiveFile(deps, index.labels),
        citations: [...index.citations].sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true })),
    };
    const project = deps.project.getState().current;
    if (project === null) return base;
    const files = collectFiles(project.tree, []);
    const mainText = await mainTextOf(deps, project.mainFile);
    return {
        ...base,
        projectRoot: project.root,
        images: imagesOf(project, files),
        graphicsDirectories: mainText === null ? [] : graphicsDirectories(mainText),
        bibliography: bibliographyOf(project, files, mainText),
    };
}
