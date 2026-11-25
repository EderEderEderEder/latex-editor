/**
 * Eingebaute Kataloge der Autovervollständigung: Befehle, Umgebungen, Tabelle Befehl → Argumentart und Optionen
 * von Standardklassen und Paketen. Die Daten stehen in `catalog.json` (Swift: `CommandCatalog.swift`,
 * `OptionCatalog.swift`, `CompletionContext.argumentCommands`) und werden zur Bauzeit eingebunden.
 */
import catalogData from './catalog.json';
import type { ArgumentKind } from './types';

/** Befehl mit Argument-Gerüst; derselbe Name kann mehrfach mit anderem Gerüst vorkommen (`cite{}`, `cite[]{}`) */
export interface CatalogCommand {
    readonly name: string;
    readonly arguments: string;
    readonly detail: string;
}

/** Optionen einer Klasse, eines Pakets oder eines Befehls: Schalter ohne Wert und Schlüssel mit möglichen Werten (leer = freier Wert) */
export interface PackageOptions {
    readonly flags: readonly string[];
    readonly keys: Readonly<Record<string, readonly string[]>>;
    /** Kurzer Hinweis je Schalter oder Schlüssel */
    readonly details: Readonly<Record<string, string>>;
}

export interface OptionCatalogData {
    readonly graphics: PackageOptions;
    readonly floatPlacement: PackageOptions;
    readonly boxPosition: PackageOptions;
    readonly citation: PackageOptions;
    readonly standardClass: PackageOptions;
    readonly standardClasses: readonly string[];
    readonly packages: Readonly<Record<string, PackageOptions>>;
}

interface CatalogData {
    readonly commands: readonly CatalogCommand[];
    readonly environments: readonly string[];
    readonly argumentCommands: Readonly<Record<ArgumentKind, readonly string[]>>;
    readonly options: OptionCatalogData;
}

const data = catalogData as unknown as CatalogData;

export const COMMANDS: readonly CatalogCommand[] = data.commands;
export const ENVIRONMENTS: readonly string[] = data.environments;
export const OPTION_CATALOG: OptionCatalogData = data.options;
export const EMPTY_OPTIONS: PackageOptions = { flags: [], keys: {}, details: {} };

/** Befehlsname (ohne `\` und `*`) → Art des Arguments, in dem ein Vorschlag erscheint (`\ref{` → label) */
export const ARGUMENT_COMMANDS: ReadonlyMap<string, ArgumentKind> = buildArgumentCommands();

function buildArgumentCommands(): ReadonlyMap<string, ArgumentKind> {
    const commands = new Map<string, ArgumentKind>();
    for (const [kind, names] of Object.entries(data.argumentCommands)) {
        for (const name of names) commands.set(name, kind as ArgumentKind);
    }
    return commands;
}

export interface CommandInsertion {
    /** Name plus Argument-Gerüst (ohne `\`) */
    readonly insertion: string;
    /** Cursor nach dem Einfügen, relativ zum Anfang von `insertion` (UTF-16); null = dahinter */
    readonly cursorOffset: number | null;
}

/** Einfügetext eines Befehls; der Cursor steht hinter dem ersten `{` oder `[` des Gerüsts */
export function commandInsertion(name: string, scaffold = ''): CommandInsertion {
    const firstArgument = scaffold.search(/[{[]/);
    return {
        insertion: name + scaffold,
        cursorOffset: firstArgument === -1 ? null : name.length + firstArgument + 1,
    };
}
