/**
 * Optionen in `[…]`: liest sie aus `.cls`/`.sty` des Projekts (`\DeclareOption{x}`, `x.code = …`,
 * `\@RegisterClassOption{key}{value}`, `.default:n`, Kommentare `% key=a|b|c`; für die HgbThesis `theme=` aus
 * `hgbtheme-*.sty` und `degree=` aus `\hgbDefineDegree{…}`) und liefert die Vorschläge zu einem Ziel.
 */
import { maskComments } from '../latex/comments';
import { EMPTY_OPTIONS, OPTION_CATALOG, type PackageOptions } from './catalog';
import type { OptionTarget } from './types';

/** Datei mit Name (mit Endung, ggf. mit Pfad) und Text */
export interface StyleFile {
    readonly name: string;
    readonly text: string;
}

/** Ein Vorschlag aus `optionItems`; die Hülle als `CompletionItem` (Art `option`) baut der Aufrufer */
export interface OptionSuggestion {
    readonly text: string;
    readonly detail: string;
}

type KeyValues = Record<string, string[]>;

const DECLARE_OPTION = /\\DeclareOption\{([^}#\\]+)\}/g;
const KEY_CODE = /^\s*([A-Za-z]+)\.code\s*=/;
const KEY_DEFAULT = /^\s*([A-Za-z]+)\.default:n/gm;
const REGISTERED = /\\@RegisterClassOption\{([A-Za-z]+)\}\{([^}]+)\}/g;
const COMMENT_VALUES = /%\s*([A-Za-z]+)=([A-Za-z0-9]+(?:\|[A-Za-z0-9]+)+)/g;
const DEGREE = /\\hgbDefineDegree\{([A-Za-z-]+)\}/g;
const LINE_BREAK = /\r\n|\r|\n/;
const DEPRECATED_MARKER = 'WarnDeprecatedOption';
const THEME_PREFIX = 'hgbtheme-';
const BOOLEAN_VALUES: readonly string[] = ['true', 'false'];
const SHOWN_VALUES = 3;

function has(record: object, key: string): boolean {
    return Object.hasOwn(record, key);
}

/** Dateiname ohne Pfad und ohne letzte Endung */
function baseName(path: string): string {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

function groups(expression: RegExp, text: string): string[][] {
    return [...text.matchAll(expression)].map((match) => match.slice(1).map((group) => group ?? ''));
}

/** Schlüssel aus `name.code = …` in Reihenfolge; veraltet ist einer, dessen Definition `\@WarnDeprecatedOption` enthält */
function declaredKeys(masked: string): string[] {
    const keys: string[] = [];
    const deprecated = new Set<string>();
    let current: string | undefined;
    for (const line of masked.split(LINE_BREAK)) {
        const key = KEY_CODE.exec(line)?.[1];
        if (key !== undefined) {
            current = key;
            if (!keys.includes(key)) keys.push(key);
        }
        if (current !== undefined && line.includes(DEPRECATED_MARKER)) deprecated.add(current);
    }
    return keys.filter((key) => !deprecated.has(key));
}

/** Optionen einer einzelnen Datei (Schlüssel ohne Werte aus Kommentaren und Vorlagenwissen) */
export function optionsInText(text: string): PackageOptions {
    const masked = maskComments(text);
    const keys: KeyValues = {};
    for (const key of declaredKeys(masked)) keys[key] ??= [];
    for (const [key = ''] of groups(KEY_DEFAULT, masked)) {
        if (has(keys, key) && keys[key]?.length === 0) keys[key] = [...BOOLEAN_VALUES];
    }
    for (const [key = '', value = ''] of groups(REGISTERED, masked)) {
        if (has(keys, key)) keys[key]?.push(value);
    }
    const flags = groups(DECLARE_OPTION, masked).map(([flag = '']) => flag);
    return { flags, keys, details: {} };
}

/** `% key=a|b|c` in Kommentaren: Schlüssel → Werte, der erste Fund je Schlüssel gilt */
function commentValueLists(text: string): KeyValues {
    const lists: KeyValues = {};
    for (const [key = '', values = ''] of groups(COMMENT_VALUES, text)) {
        if (!has(lists, key)) lists[key] = values.split('|');
    }
    return lists;
}

/** Werte, die nur die HgbThesis kennt: Themen aus den Dateinamen, Studiengänge aus `\hgbDefineDegree` */
function hgbThesisValues(files: readonly StyleFile[]): KeyValues {
    const values: KeyValues = {};
    const themes = files.map((file) => baseName(file.name))
        .filter((name) => name.startsWith(THEME_PREFIX))
        .map((name) => name.slice(THEME_PREFIX.length))
        .sort();
    if (themes.length > 0) values.theme = themes;
    const degrees = files.flatMap((file) => groups(DEGREE, maskComments(file.text)).map(([degree = '']) => degree));
    if (degrees.length > 0) values.degree = degrees;
    return values;
}

function globalValueLists(files: readonly StyleFile[]): KeyValues {
    const merged: KeyValues = {};
    for (const file of files) {
        for (const [key, values] of Object.entries(commentValueLists(file.text))) {
            if (!has(merged, key)) merged[key] = values;
        }
    }
    return merged;
}

function isEmptyOptions(options: PackageOptions): boolean {
    return options.flags.length === 0 && Object.keys(options.keys).length === 0;
}

/** Leere Werteliste durch Wissen der Vorlage oder Kommentarlisten ersetzen */
function fillEmptyKeys(options: PackageOptions, hgb: KeyValues, global: KeyValues): PackageOptions {
    const keys: KeyValues = {};
    for (const [key, values] of Object.entries(options.keys)) {
        const fallback = has(hgb, key) ? hgb[key] : has(global, key) ? global[key] : undefined;
        keys[key] = values.length === 0 && fallback !== undefined ? [...fallback] : [...values];
    }
    return { ...options, keys };
}

/** Name (Dateiname ohne Endung) → Optionen, für alle Klassen- und Paketdateien; Dateien ohne Optionen fehlen */
export function scanOptions(files: readonly StyleFile[]): ReadonlyMap<string, PackageOptions> {
    const global = globalValueLists(files);
    const hgb = hgbThesisValues(files);
    const result = new Map<string, PackageOptions>();
    for (const file of files) {
        const options = fillEmptyKeys(optionsInText(file.text), hgb, global);
        if (!isEmptyOptions(options)) result.set(baseName(file.name), options);
    }
    return result;
}

function appendNew(base: readonly string[], extra: readonly string[]): string[] {
    return [...base, ...extra.filter((value) => !base.includes(value))];
}

/** Vereinigt beide: Schalter und Werte von `other` ergänzen fehlende, Hinweise von `base` gewinnen */
export function mergeOptions(base: PackageOptions, other: PackageOptions): PackageOptions {
    const keys: KeyValues = {};
    for (const [key, values] of Object.entries(base.keys)) keys[key] = [...values];
    for (const [key, values] of Object.entries(other.keys)) keys[key] = appendNew(has(keys, key) ? (keys[key] ?? []) : [], values);
    return { flags: appendNew(base.flags, other.flags), keys, details: { ...other.details, ...base.details } };
}

function lookup(scanned: ReadonlyMap<string, PackageOptions>, name: string): PackageOptions {
    return scanned.get(name) ?? EMPTY_OPTIONS;
}

/** Alle Optionen zu einem Ziel: eingebaut, bei Klassen und Paketen vereinigt mit dem, was die Projektdateien erklären */
export function optionsFor(target: OptionTarget, scanned: ReadonlyMap<string, PackageOptions>): PackageOptions {
    switch (target.kind) {
        case 'graphics': return OPTION_CATALOG.graphics;
        case 'floatPlacement': return OPTION_CATALOG.floatPlacement;
        case 'boxPosition': return OPTION_CATALOG.boxPosition;
        case 'citation': return OPTION_CATALOG.citation;
        case 'documentClass': {
            const builtIn = OPTION_CATALOG.standardClasses.includes(target.name) ? OPTION_CATALOG.standardClass : EMPTY_OPTIONS;
            return mergeOptions(lookup(scanned, target.name), builtIn);
        }
        case 'package': {
            const builtIn = has(OPTION_CATALOG.packages, target.name) ? OPTION_CATALOG.packages[target.name] : undefined;
            return mergeOptions(lookup(scanned, target.name), builtIn ?? EMPTY_OPTIONS);
        }
    }
}

function valueSummary(values: readonly string[]): string {
    const shown = values.slice(0, SHOWN_VALUES).join(', ');
    return values.length > SHOWN_VALUES ? `${shown}, …` : shown;
}

/** Mit `key`: dessen Werte; ohne: Schlüssel (als `key=`, sortiert) und danach Schalter */
export function optionItems(
    target: OptionTarget,
    scanned: ReadonlyMap<string, PackageOptions>,
    key: string | null = null,
): OptionSuggestion[] {
    const options = optionsFor(target, scanned);
    if (key !== null) {
        const values = has(options.keys, key) ? (options.keys[key] ?? []) : [];
        return values.map((text) => ({ text, detail: key }));
    }
    const keys = Object.keys(options.keys).sort().map((name) => ({
        text: `${name}=`,
        detail: has(options.details, name) ? (options.details[name] ?? '') : valueSummary(options.keys[name] ?? []),
    }));
    const flags = options.flags.map((flag) => ({ text: flag, detail: has(options.details, flag) ? (options.details[flag] ?? '') : '' }));
    return [...keys, ...flags];
}
