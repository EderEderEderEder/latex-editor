/**
 * Reine Analyse-Logik des Renderer-Workers (ohne DOM und ohne Worker-Umgebung, daher direkt testbar).
 * Jede Antwort trägt `docId` und `version` der Anfrage, damit der Renderer veraltete Antworten verwirft.
 */
import { duplicateLabelEntries, type LabelEntry } from '../../shared/core/latex/duplicateLabels';
import { scanReferences } from '../../shared/core/latex/masking';
import { checkSyntax, type TextMark } from '../../shared/core/latex/syntaxChecker';
import { countWords } from '../../shared/core/latex/wordCounter';
import { type WritingHint, writingHints } from '../../shared/core/latex/writingHints';

/** Ergebnis der Schreibprüfung einer Datei: Hinweise (leer, wenn nicht angefordert) und Wörter des Fließtexts */
export interface WritingResult {
    readonly hints: WritingHint[];
    readonly words: number;
}

export type AnalysisRequest =
    | { readonly kind: 'check'; readonly docId: string; readonly version: number; readonly text: string }
    | {
        readonly kind: 'writing';
        readonly docId: string;
        readonly version: number;
        readonly text: string;
        /** `false`: nur zählen (Schreibhinweise sind ausgeschaltet oder die Datei ist keine LaTeX-Datei) */
        readonly includeHints: boolean;
    }
    | {
        readonly kind: 'labels';
        readonly docId: string;
        readonly version: number;
        readonly text: string;
        readonly file: string;
    }
    | {
        readonly kind: 'duplicates';
        readonly docId: string;
        readonly version: number;
        readonly entries: readonly LabelEntry[];
    };

export type AnalysisResponse =
    | { readonly kind: 'check'; readonly docId: string; readonly version: number; readonly marks: TextMark[] }
    | { readonly kind: 'writing'; readonly docId: string; readonly version: number; readonly result: WritingResult }
    | {
        readonly kind: 'labels';
        readonly docId: string;
        readonly version: number;
        readonly file: string;
        readonly entries: LabelEntry[];
    }
    | { readonly kind: 'duplicates'; readonly docId: string; readonly version: number; readonly entries: LabelEntry[] }
    | { readonly kind: 'error'; readonly docId: string; readonly version: number; readonly message: string };

const NEWLINE = '\n';

/** Alle `\label{…}` der Datei mit 1-basierter Zeile; die Zeilen werden in einem Durchlauf gezählt */
function labelEntries(text: string, file: string): LabelEntry[] {
    const entries: LabelEntry[] = [];
    let line = 1;
    let cursor = 0;
    for (const occurrence of scanReferences(text)) {
        if (occurrence.kind !== 'labelDefinition') continue;
        for (let found = text.indexOf(NEWLINE, cursor); found !== -1 && found < occurrence.start; ) {
            line++;
            cursor = found + 1;
            found = text.indexOf(NEWLINE, cursor);
        }
        entries.push({ label: occurrence.key, file, line });
    }
    return entries;
}

function writingResult(text: string, includeHints: boolean): WritingResult {
    return { hints: includeHints ? writingHints(text) : [], words: countWords(text) };
}

export function handleAnalysisRequest(request: AnalysisRequest): AnalysisResponse {
    const { docId, version } = request;
    switch (request.kind) {
        case 'check':
            return { kind: 'check', docId, version, marks: checkSyntax(request.text) };
        case 'writing':
            return { kind: 'writing', docId, version, result: writingResult(request.text, request.includeHints) };
        case 'labels':
            return { kind: 'labels', docId, version, file: request.file, entries: labelEntries(request.text, request.file) };
        case 'duplicates':
            return { kind: 'duplicates', docId, version, entries: duplicateLabelEntries(request.entries) };
    }
}
