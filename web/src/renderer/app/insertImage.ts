// Einfügen-Fenster (W4-10): Bild wählen (aus dem Projekt, Dateidialog, Drag & Drop) und beim Einfügen nach `images/`
// kopieren (`image:import`, Gewährungen aus Dialog bzw. `drop:grant`). Den Pfad für `\includegraphics` macht
// `graphicsReference` (Vorlage `InsertStore.prepareImageReference`).
import { graphicsReference } from '../../shared/core/insertion';
import { unwrap } from '../../shared/ipcResult';
import { extensionOf, INSERTABLE_IMAGE_EXTENSIONS } from './insertCatalog';
import type { InsertDeps } from './insertDeps';
import { IMAGES_DIRECTORY, imageReferenceOf, INSERT_TEXTS, toPosixPath } from './insertLogic';
import type { ImageChoice, InsertCatalog, InsertSettings } from './insertLogic';

export const IMAGE_TEXTS = {
    pickTitle: 'Bild für das Dokument wählen',
    filterName: 'Bilder',
    unsupported: (name: string) => `„${name}“ hat ein Format, das pdfLaTeX nicht einbinden kann. Erlaubt sind PNG, JPG und PDF.`,
    notAccepted: (name: string) => `„${name}“ konnte nicht übernommen werden.`,
} as const;

const SEPARATOR = '/';
const WINDOWS_SEPARATOR = '\\';

export function isSupportedImageName(name: string): boolean {
    return INSERTABLE_IMAGE_EXTENSIONS.has(extensionOf(name));
}

export function messageOfError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Pfad im Projekt mit dem Trenner, den die Wurzel benutzt (Windows `\`) */
export function joinProjectPath(root: string, name: string): string {
    const separator = root.includes(WINDOWS_SEPARATOR) && !root.includes(SEPARATOR) ? WINDOWS_SEPARATOR : SEPARATOR;
    return root.endsWith(separator) ? root + name : root + separator + name;
}

function chooseImage(deps: InsertDeps, choice: ImageChoice): void {
    deps.insert.getState().update('imageChoice', () => choice);
    deps.insert.getState().setError(null);
}

/** Bild aus der Liste der Projektbilder (Pfad leer: Auswahl aufheben) */
export function chooseProjectImage(deps: InsertDeps, path: string): void {
    const image = deps.insert.getState().catalog.images.find((entry) => entry.path === path);
    if (image === undefined) {
        deps.insert.getState().update('imageChoice', () => null);
        return;
    }
    chooseImage(deps, { kind: 'project', path: image.path, name: image.relative.split(SEPARATOR).at(-1) ?? image.relative });
}

/** „Datei wählen …“: nativer Dialog; die Datei kommt als Gewährung, nie als Pfad */
export async function chooseImageFile(deps: InsertDeps): Promise<void> {
    try {
        const picked = unwrap(await deps.api.dialog.pickFiles({
            title: IMAGE_TEXTS.pickTitle,
            filters: [{ name: IMAGE_TEXTS.filterName, extensions: [...INSERTABLE_IMAGE_EXTENSIONS] }],
            multiple: false,
        }));
        const file = picked?.[0];
        if (file === undefined) return;
        if (!isSupportedImageName(file.name)) deps.insert.getState().setError(IMAGE_TEXTS.unsupported(file.name));
        else chooseImage(deps, { kind: 'external', grantId: file.grantId, name: file.name });
    } catch (error) {
        deps.insert.getState().setError(messageOfError(error));
    }
}

/** Drag & Drop: die erste brauchbare Datei wird gewährt (`drop:grant` im Preload) und gewählt */
export async function dropImageFiles(deps: InsertDeps, files: readonly File[]): Promise<void> {
    const supported = files.find((file) => isSupportedImageName(file.name));
    if (supported === undefined) {
        const first = files[0];
        if (first !== undefined) deps.insert.getState().setError(IMAGE_TEXTS.unsupported(first.name));
        return;
    }
    try {
        const result = unwrap(await deps.api.dragDrop.grantFiles([supported]));
        const granted = result.granted[0];
        if (granted === undefined) deps.insert.getState().setError(IMAGE_TEXTS.notAccepted(result.rejected[0] ?? supported.name));
        else chooseImage(deps, { kind: 'external', grantId: granted.grantId, name: granted.name });
    } catch (error) {
        deps.insert.getState().setError(messageOfError(error));
    }
}

/** Pfad für `\includegraphics`; ein Bild von außen wird dabei nach `images/` kopiert (gleicher Inhalt: vorhandene Datei) */
export async function prepareImageReference(deps: InsertDeps, settings: InsertSettings, catalog: InsertCatalog): Promise<string> {
    const choice = settings.imageChoice;
    const root = catalog.projectRoot;
    if (choice === null) throw new Error(INSERT_TEXTS.chooseImage);
    if (root === null) throw new Error(INSERT_TEXTS.imageNeedsProject);
    if (choice.kind === 'project') return imageReferenceOf(settings, catalog);
    const imported = unwrap(await deps.api.image.import(choice.grantId, joinProjectPath(root, IMAGES_DIRECTORY)));
    const posixRoot = toPosixPath(root);
    return graphicsReference([posixRoot, imported.relPath].join(SEPARATOR), posixRoot, catalog.graphicsDirectories);
}
