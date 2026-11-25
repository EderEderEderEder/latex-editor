// Gemeinsame Typen der Autovervollständigung (Vorlage: swift/Sources/LatexEditor/Completion/).
// Alle Offsets und Längen sind UTF-16-Einheiten (JavaScript-String-Indizes).
// Fabriken für Einträge (`createCompletionItem`, `commandItem`) liegen in `matcher.ts`.

/** Bereich im Dokument (UTF-16), wie `NSRange` in Swift */
export interface TextRange {
    readonly location: number;
    readonly length: number;
}

/** Welche Art Argument gerade getippt wird (bestimmt die Vorschläge) */
export type ArgumentKind =
    | "label"
    | "citation"
    | "acronym"
    | "graphics"
    | "input"
    | "beginEnvironment"
    | "endEnvironment";

/** Wessen Optionen in `[…]` gerade getippt werden */
export type OptionTargetKind =
    | "graphics"
    | "floatPlacement"
    | "boxPosition"
    | "citation"
    | "documentClass"
    | "package";

/**
 * Ziel einer Option. `name` ist bei `documentClass`/`package` der Name aus `]{name}` hinter dem Cursor
 * (leer, solange er noch nicht dasteht), sonst immer "".
 */
export interface OptionTarget {
    readonly kind: OptionTargetKind;
    readonly name: string;
}

interface ContextBase {
    /** Bereits Getipptes (ohne `\`, bzw. ab `{` oder `,`) */
    readonly prefix: string;
    /** Bereich des Getippten; wird beim Übernehmen ersetzt */
    readonly range: TextRange;
}

export interface CommandContext extends ContextBase {
    readonly kind: "command";
}

export interface ArgumentContext extends ContextBase {
    readonly kind: "argument";
    readonly argument: ArgumentKind;
}

export interface OptionContext extends ContextBase {
    readonly kind: "option";
    readonly target: OptionTarget;
    /** Schlüssel vor dem `=`, wenn ein Wert getippt wird, sonst null */
    readonly key: string | null;
}

/** Wo der Cursor steht: Befehl, Argument eines bekannten Befehls oder Option in `[…]` */
export type CompletionContext = CommandContext | ArgumentContext | OptionContext;

export type CompletionItemKind =
    | "command"
    | "environment"
    | "label"
    | "citation"
    | "acronym"
    | "image"
    | "file"
    | "option";

/** Ein Vorschlag in der Liste */
export interface CompletionItem {
    readonly kind: CompletionItemKind;
    /** Angezeigt und gefiltert (Befehle ohne `\`) */
    readonly text: string;
    /** Zusatz rechts, z. B. Titel bei Zitaten oder Datei:Zeile bei Labels */
    readonly detail: string;
    /** Ersetzt das Getippte; bei Befehlen z. B. `section{}` */
    readonly insertion: string;
    /** Cursor danach, relativ zum Anfang von `insertion`; null = dahinter */
    readonly cursorOffset: number | null;
    /** Kleingeschrieben, für die Suche */
    readonly searchKey: string;
    /** Positionen, an denen ein Wort beginnt (nach `:` `-` `_` `/` `.` Leerzeichen oder bei Binnengroßbuchstabe) */
    readonly wordStarts: ReadonlySet<number>;
    /** UTF-16-Länge von `text` (Sortierkriterium) */
    readonly length: number;
    /** Weiterer durchsuchbarer Text (bei Zitaten Autoren, Titel, Jahr), kleingeschrieben */
    readonly extraSearchText: string;
}

/** Eingabe für `createCompletionItem` */
export interface CompletionItemInit {
    readonly kind: CompletionItemKind;
    readonly text: string;
    readonly detail?: string;
    readonly insertion?: string;
    readonly cursorOffset?: number | null;
    readonly searchableExtra?: string;
}

/** Ergebnis der Übernahme eines Eintrags: `range` durch `text` ersetzen, dann `selection` setzen */
export interface CompletionEdit {
    readonly range: TextRange;
    readonly text: string;
    readonly selection: TextRange;
    /** Folgeliste sofort zeigen (z. B. nach `\begin{}` oder `width=`) */
    readonly opensFollowUp: boolean;
}
