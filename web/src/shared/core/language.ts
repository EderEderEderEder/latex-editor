// Sprache einer Datei für die Einfärbung (LaTeX oder BibTeX). Reine Logik ohne DOM, Node oder Electron.

export type SyntaxLanguage = 'bibtex' | 'latex';

const FILE_EXTENSION_SEPARATOR = '.';
const BIB_EXTENSION = 'bib';
const PATH_SEPARATORS = /[\\/]/;

/** Sprache nach Dateiendung (ohne Beachtung der Groß-/Kleinschreibung): `.bib` ist BibTeX, alles andere LaTeX. */
export function languageFromPath(path: string): SyntaxLanguage {
    const name = path.split(PATH_SEPARATORS).pop() ?? '';
    const dotIndex = name.lastIndexOf(FILE_EXTENSION_SEPARATOR);
    if (dotIndex <= 0) return 'latex';
    return name.slice(dotIndex + 1).toLowerCase() === BIB_EXTENSION ? 'bibtex' : 'latex';
}
