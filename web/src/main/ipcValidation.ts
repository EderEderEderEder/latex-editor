import type { JsonValue, RequestArgs, RequestChannel } from '../shared/contract';

// Grundprüfung der Argumentform je Kanal. Inhaltliche Prüfungen (Pfad liegt im Projekt,
// Dateiname erlaubt …) machen die Fachhandler.

export type Guard<T> = (value: unknown) => value is T;
type GuardedType<G> = G extends Guard<infer T> ? T : never;
// `-?`: auch für optionale Argumente muss ein Wächter da sein (er akzeptiert dann `undefined`).
type ArgGuards<Args extends readonly unknown[]> = { readonly [K in keyof Args]-?: Guard<Args[K]> };
type ArgSchemas = { readonly [C in RequestChannel]: ArgGuards<RequestArgs<C>> };

// Längster Pfad, den Windows mit `\\?\` zulässt.
const MAX_PATH_LENGTH = 32_767;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_JSON_DEPTH = 32;
const MIN_LINE_OR_PAGE = 1;
const MAX_GRANT_ID_LENGTH = 64;
const GRANT_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export const isString: Guard<string> = (value): value is string => typeof value === 'string';

export const isNonEmptyString: Guard<string> = (value): value is string =>
    typeof value === 'string' && value.length > 0 && !value.includes('\0');

export const isPath: Guard<string> = (value): value is string =>
    isNonEmptyString(value) && value.length <= MAX_PATH_LENGTH;

// Nur die Form; ob der Main die Kennung vergeben hat, prüft `GrantStore.resolve`.
export const isGrantId: Guard<string> = (value): value is string =>
    typeof value === 'string' && value.length <= MAX_GRANT_ID_LENGTH && GRANT_ID_PATTERN.test(value);

export const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === 'boolean';

export const isFiniteNumber: Guard<number> = (value): value is number =>
    typeof value === 'number' && Number.isFinite(value);

export const isLineOrPage: Guard<number> = (value): value is number =>
    Number.isSafeInteger(value) && (value as number) >= MIN_LINE_OR_PAGE;

export function literal<const Values extends readonly string[]>(...values: Values): Guard<Values[number]> {
    return (value): value is Values[number] => typeof value === 'string' && values.includes(value);
}

export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
    return (value): value is T | undefined => value === undefined || guard(value);
}

export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
    return (value): value is T[] =>
        Array.isArray(value) && value.length <= MAX_ARRAY_LENGTH && value.every((item) => guard(item));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

// Unbekannte Schlüssel werden abgelehnt, fehlende nur, wenn ihr Wächter `undefined` ablehnt.
export function objectOf<Shape extends Record<string, Guard<unknown>>>(
    shape: Shape,
): Guard<{ [K in keyof Shape]: GuardedType<Shape[K]> }> {
    return (value): value is { [K in keyof Shape]: GuardedType<Shape[K]> } => {
        if (!isPlainObject(value)) return false;
        if (Object.keys(value).some((key) => !Object.hasOwn(shape, key))) return false;
        return Object.entries(shape).every(([key, guard]) => guard(value[key]));
    };
}

function isJsonAtDepth(value: unknown, depth: number): boolean {
    if (depth > MAX_JSON_DEPTH) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => isJsonAtDepth(item, depth + 1));
    if (!isPlainObject(value)) return false;
    return Object.values(value).every((item) => isJsonAtDepth(item, depth + 1));
}

export const isJsonValue: Guard<JsonValue> = (value): value is JsonValue => isJsonAtDepth(value, 0);

const isPathList = arrayOf(isPath);
const isGrantIdList = arrayOf(isGrantId);
const isEncoding = literal('utf8', 'latin1');
const isLineEnding = literal('lf', 'crlf');
const isFileFilter = objectOf({ name: isString, extensions: arrayOf(isNonEmptyString) });
const isFileFilters = optional(arrayOf(isFileFilter));

const isPickFilesOptions = objectOf({
    title: optional(isString),
    filters: isFileFilters,
    multiple: optional(isBoolean),
});

const isSaveAsOptions = objectOf({
    title: optional(isString),
    defaultPath: optional(isPath),
    filters: isFileFilters,
});

const isSearchOptions = objectOf({ caseSensitive: isBoolean, wholeWord: isBoolean, regex: isBoolean });
const isBuildOptions = objectOf({ engine: literal('pdflatex', 'xelatex', 'lualatex') });
const isGitBlobSpec = objectOf({ path: isPath, revision: literal('HEAD', 'index') });

const isRecoveryEntry = objectOf({
    path: isPath,
    text: isString,
    savedAt: isFiniteNumber,
});

export const ARG_SCHEMAS: ArgSchemas = {
    'app:ping': [],
    'tools:detect': [],
    'project:open': [isGrantId],
    'project:recent': [],
    'dialog:openProject': [],
    'dialog:pickFiles': [isPickFilesOptions],
    'dialog:saveAs': [isSaveAsOptions],
    'drop:grant': [isPathList],
    'fs:readText': [isPath],
    'fs:readMany': [isPathList],
    'fs:writeText': [isPath, isString, isEncoding, isLineEnding, optional(isNonEmptyString)],
    'fs:create': [isPath, isNonEmptyString, literal('file', 'directory')],
    'fs:rename': [isPath, isNonEmptyString],
    'fs:move': [isPath, isPath],
    'fs:duplicate': [isPath],
    'fs:import': [isGrantIdList, isPath],
    'fs:trash': [isPath],
    'fs:restore': [isNonEmptyString],
    'search:project': [isNonEmptyString, isSearchOptions, isPathList],
    'build:start': [isPath, isBuildOptions],
    'build:cancel': [],
    'build:clean': [isPath],
    'synctex:forward': [isPath, isLineOrPage],
    'synctex:backward': [isLineOrPage, isFiniteNumber, isFiniteNumber],
    'git:status': [],
    'git:blob': [isGitBlobSpec],
    'git:stage': [isPathList],
    'git:unstage': [isPathList],
    'git:commit': [isNonEmptyString],
    'git:fetch': [],
    'git:pullFf': [],
    'git:push': [],
    'git:branches': [],
    'git:checkout': [isNonEmptyString],
    'git:create': [isNonEmptyString],
    'git:resetPlan': [],
    'git:resetApply': [isNonEmptyString],
    'marks:load': [],
    'marks:save': [isString],
    'recovery:save': [isRecoveryEntry],
    'recovery:list': [],
    'recovery:delete': [isPath],
    'settings:get': [],
    'settings:set': [isNonEmptyString, isJsonValue],
    'image:import': [isGrantId, isPath],
    'pdf:open': [isPath],
};

export function areArgsValid(channel: RequestChannel, args: readonly unknown[]): boolean {
    const guards: readonly Guard<unknown>[] = ARG_SCHEMAS[channel];
    if (args.length > guards.length) return false;
    return guards.every((guard, index) => guard(args[index]));
}
