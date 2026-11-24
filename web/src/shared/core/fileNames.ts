/**
 * Namen von Dateien und Ordnern im Projekt: Prüfung, neuer Name (`.tex` ergänzen), Umbenennen (Endung behalten),
 * Kopie- und Import-Namen. Rein und ohne Node; die Plattform kommt als Parameter (`PathPlatform` aus `main/paths`
 * passt strukturell). Verhalten nach `FileOperations` der Swift-Version.
 */
import { IpcFailure } from '../ipcResult';

/** Das Einzige, was die Namensregeln von der Plattform brauchen (Windows hat zusätzliche Verbote) */
export interface NamePlatform {
    readonly windows: boolean;
}

export type FileNameProblem =
    | 'empty'
    | 'dotName'
    | 'controlCharacter'
    | 'separator'
    | 'alternateDataStream'
    | 'reservedCharacter'
    | 'trailingDotOrSpace'
    | 'deviceName'
    | 'hidden'
    | 'tooLong';

// Wie Swift (`FileOperations.maximumNameLength`); NTFS und APFS erlaubten 255.
export const MAX_FILE_NAME_LENGTH = 120;
export const DEFAULT_FILE_EXTENSION = '.tex';

export const FILE_NAME_MESSAGES: Readonly<Record<FileNameProblem, string>> = {
    empty: 'Der Name darf nicht leer sein.',
    dotName: '„.“ und „..“ sind keine Namen.',
    controlCharacter: 'Der Name enthält Steuerzeichen.',
    separator: 'Der Name darf weder „/“ noch „\\“ enthalten.',
    alternateDataStream: 'Der Name darf keinen „:“ enthalten (Windows-Datenstrom).',
    reservedCharacter: 'Der Name darf keines der Zeichen < > : " | ? * enthalten.',
    trailingDotOrSpace: 'Der Name darf unter Windows nicht auf Punkt oder Leerzeichen enden.',
    deviceName: 'Der Name ist unter Windows ein Gerätename (z. B. CON, NUL, COM1).',
    hidden: 'Namen mit Punkt am Anfang sind versteckte Dateien und würden im Baum nicht erscheinen.',
    tooLong: `Der Name ist zu lang (höchstens ${MAX_FILE_NAME_LENGTH} Zeichen).`,
};

// Cc und Cf wie Swift `CharacterSet.controlCharacters` (auch Richtungszeichen, die Namen verfälscht anzeigen).
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
export const NAME_SEPARATORS = /[\\/]/;
export const STREAM_SEPARATOR = ':';
const WINDOWS_RESERVED_CHARACTERS = /[<>"|?*]/;
const TRAILING_DOT_OR_SPACE = /[. ]$/;
// Windows reserviert diese Namen auch mit Endung („nul.tex“, „COM1 .txt“) und mit hochgestellten Ziffern.
const WINDOWS_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i;
const DOT_NAMES: ReadonlySet<string> = new Set(['.', '..']);

function windowsDeviceStem(name: string): string {
    return (name.split('.')[0] ?? '').trimEnd();
}

function windowsNameProblem(name: string): FileNameProblem | null {
    if (WINDOWS_RESERVED_CHARACTERS.test(name)) return 'reservedCharacter';
    if (TRAILING_DOT_OR_SPACE.test(name)) return 'trailingDotOrSpace';
    if (WINDOWS_DEVICE_NAMES.test(windowsDeviceStem(name))) return 'deviceName';
    return null;
}

// Prüft einen einzelnen Namen (kein Pfad). Windows-Regeln nur mit `platform.windows`; „:“ und „\“ sind
// überall verboten (macOS zeigt „:“ als „/“, wie in Swift).
export function validateFileName(name: string, platform: NamePlatform): FileNameProblem | null {
    if (name.trim().length === 0) return 'empty';
    if (DOT_NAMES.has(name)) return 'dotName';
    if (CONTROL_CHARACTERS.test(name)) return 'controlCharacter';
    if (NAME_SEPARATORS.test(name)) return 'separator';
    if (name.includes(STREAM_SEPARATOR)) return platform.windows ? 'alternateDataStream' : 'reservedCharacter';
    const windowsProblem = platform.windows ? windowsNameProblem(name) : null;
    if (windowsProblem !== null) return windowsProblem;
    if (name.startsWith('.')) return 'hidden';
    if (name.length > MAX_FILE_NAME_LENGTH) return 'tooLong';
    return null;
}

/** Endung mit Punkt (`.tex`) des letzten Namensteils; leer bei „.versteckt“ und Namen ohne Punkt */
export function extensionOf(name: string): string {
    const lastName = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
    const dot = lastName.lastIndexOf('.');
    return dot <= 0 ? '' : lastName.slice(dot);
}

// Wie Swift `validateName`: Leerraum an den Rändern fällt weg, dann wird geprüft.
export function assertValidFileName(raw: string, platform: NamePlatform): string {
    const name = raw.trim();
    const problem = validateFileName(name, platform);
    if (problem !== null) throw new IpcFailure({ kind: 'invalidInput', message: FILE_NAME_MESSAGES[problem] });
    return name;
}

// Neue Datei ohne Endung bekommt `.tex` (wie Swift `newFileName`).
export function newFileName(raw: string, platform: NamePlatform): string {
    const name = assertValidFileName(raw, platform);
    return assertValidFileName(extensionOf(name) === '' ? name + DEFAULT_FILE_EXTENSION : name, platform);
}

// Umbenennen: Wer bei einer Datei die Endung weglässt, behält die bisherige (wie Swift `renamedFileName`).
// `original` darf ein ganzer Pfad sein.
export function renamedFileName(raw: string, original: string, isDirectory: boolean, platform: NamePlatform): string {
    const name = assertValidFileName(raw, platform);
    const originalExtension = extensionOf(original);
    const keepsName = isDirectory || originalExtension === '' || extensionOf(name) !== '';
    return assertValidFileName(keepsName ? name : name + originalExtension, platform);
}

export type NumberedName = (stem: string, extension: string, number: number) => string;

// „kapitel Kopie.tex“, „kapitel Kopie 2.tex“ … (Swift `duplicate`)
export const copyName: NumberedName = (stem, extension, number) =>
    number === 1 ? `${stem} Kopie${extension}` : `${stem} Kopie ${number}${extension}`;

// „bild.png“, „bild 2.png“ … (Swift `copyIn`)
export const importName: NumberedName = (stem, extension, number) =>
    number === 1 ? `${stem}${extension}` : `${stem} ${number}${extension}`;
