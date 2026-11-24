// Pfadzeile über dem Editor: Include-Kette von der Hauptdatei bis zur gezeigten Datei (`includeChain`), Namen relativ
// zum Projekt. Reine Umwandlung ohne DOM.
export interface PathBarSegment {
    readonly path: string;
    /** Pfad relativ zum Projekt mit `/`, außerhalb des Projekts der Anzeigename */
    readonly label: string;
}

const SEPARATORS = /[\\/]+/g;
const TRAILING_SEPARATORS = /[\\/]+$/;

/** Pfad relativ zum Projekt (mit `/`), `null` außerhalb oder ohne Projekt */
export function relativeToProject(root: string | null, path: string): string | null {
    if (root === null) return null;
    const prefix = root.replace(TRAILING_SEPARATORS, '').replace(SEPARATORS, '/');
    const normalized = path.replace(SEPARATORS, '/');
    if (!normalized.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) return null;
    return normalized.slice(prefix.length + 1);
}

/**
 * Segmente der Zeile. Eine Datei außerhalb des Projekts (Dialog-Kennung als Schlüssel) steht allein mit ihrem
 * Anzeigenamen; ohne Kette (Datei nicht eingebunden) steht die Datei allein; ohne Datei bleibt die Zeile leer.
 */
export function pathBarSegments(
    chain: readonly string[], active: { readonly path: string; readonly title: string } | null, root: string | null,
): PathBarSegment[] {
    if (active === null) return [];
    if (relativeToProject(root, active.path) === null) return [{ path: active.path, label: active.title }];
    const paths = chain.length > 0 ? chain : [active.path];
    return paths.map((path) => ({ path, label: relativeToProject(root, path) ?? path.split(/[\\/]/).at(-1) ?? path }));
}
