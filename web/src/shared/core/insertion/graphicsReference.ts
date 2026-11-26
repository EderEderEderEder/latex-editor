const SEPARATOR = '/';
const PARENT = '..';

/** POSIX-Pfad ohne `.`, `..` und doppelte Trenner (wie `standardizedFileURL`) */
export function normalizePosixPath(path: string): string {
    const isAbsolute = path.startsWith(SEPARATOR);
    const parts: string[] = [];
    for (const part of path.split(SEPARATOR)) {
        if (part === '' || part === '.') continue;
        if (part !== PARENT) parts.push(part);
        else if (parts.length > 0 && parts[parts.length - 1] !== PARENT) parts.pop();
        else if (!isAbsolute) parts.push(PARENT);
    }
    return (isAbsolute ? SEPARATOR : '') + parts.join(SEPARATOR);
}

/**
 * Pfad für `\includegraphics`: relativ zum Projekt, ohne das erste passende `\graphicspath`-Verzeichnis;
 * außerhalb des Projekts nur der Dateiname. Erwartet POSIX-Pfade (Aufrufer wandeln Windows-Pfade um).
 */
export function graphicsReference(file: string, projectRoot: string, directories: readonly string[]): string {
    const root = normalizePosixPath(projectRoot);
    const rootPrefix = root.endsWith(SEPARATOR) ? root : root + SEPARATOR;
    const full = normalizePosixPath(file);
    if (!full.startsWith(rootPrefix)) return full.slice(full.lastIndexOf(SEPARATOR) + 1);
    const relative = full.slice(rootPrefix.length);
    const directory = directories.find((candidate) => relative.startsWith(candidate));
    return directory === undefined ? relative : relative.slice(directory.length);
}
