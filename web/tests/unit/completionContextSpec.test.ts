import { describe, expect, it } from 'vitest';
import { applyCompletion } from '../../src/shared/core/completion/applier';
import { detectContext, lineStartOf, MAXIMUM_LOOK_BEHIND } from '../../src/shared/core/completion/context';
import { commandItem, createCompletionItem, rankItems, wordStarts } from '../../src/shared/core/completion/matcher';
import type { CompletionContext, CompletionItem, CompletionItemKind } from '../../src/shared/core/completion/types';
import { isInsideCode } from '../../src/shared/core/latex/environments';
import { loadSpec, type SpecCase } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/completion.json`, nur die Operationen dieser Module
// (Format: `notes` der Datei). Die übrigen Operationen prüfen die Tests der Kataloge und Optionen.
const OPERATIONS = ['detectContext', 'rank', 'apply'] as const;
const EXPECTED_CASE_COUNT = 61;
const CURSOR_MARK = '|';

type Operation = (typeof OPERATIONS)[number];
type Input = Record<string, unknown> & { readonly op: string };
type Expect = Record<string, unknown>;
interface ItemInput {
    readonly kind: CompletionItemKind;
    readonly text: string;
    readonly arguments?: string;
    readonly extra?: string;
}

const spec = loadSpec('completion');
const cases = spec.cases.filter((testCase) => OPERATIONS.includes((testCase.input as Input).op as Operation));

interface Marked {
    readonly text: string;
    readonly cursor: number;
}

function unmark(marked: string, mark = CURSOR_MARK): Marked {
    const cursor = marked.indexOf(mark);
    if (cursor === -1) throw new Error(`Keine Cursor-Marke in ${marked}`);
    return { text: marked.slice(0, cursor) + marked.slice(cursor + mark.length), cursor };
}

function contextOf(marked: string, mark = CURSOR_MARK): CompletionContext | null {
    const { text, cursor } = unmark(marked, mark);
    return detectContext(text, cursor, lineStartOf(text, cursor));
}

/** Kontext in der Form der Vektoren (`target` als Name, `targetName` daneben) */
function comparableContext(context: CompletionContext): Record<string, unknown> {
    const base = { kind: context.kind, prefix: context.prefix, range: context.range };
    if (context.kind === 'argument') return { ...base, argument: context.argument };
    if (context.kind === 'option') return { ...base, target: context.target.kind, targetName: context.target.name, key: context.key };
    return base;
}

function itemFrom(input: ItemInput): CompletionItem {
    if (input.kind === 'command') return commandItem(input.text, input.arguments ?? '');
    return createCompletionItem({ kind: input.kind, text: input.text, searchableExtra: input.extra ?? '' });
}

interface Applied {
    readonly result: string;
    readonly opensFollowUp: boolean;
}

function applyMarked(marked: string, item: CompletionItem, indentUnit?: string): Applied {
    const { text, cursor } = unmark(marked);
    const context = detectContext(text, cursor, lineStartOf(text, cursor));
    if (context === null) throw new Error(`Kein Kontext in ${marked}`);
    const edit = applyCompletion(item, context, text, indentUnit);
    const end = edit.range.location + edit.range.length;
    const replaced = text.slice(0, edit.range.location) + edit.text + text.slice(end);
    const caret = edit.selection.location;
    expect(edit.selection.length).toBe(0);
    return { result: replaced.slice(0, caret) + CURSOR_MARK + replaced.slice(caret), opensFollowUp: edit.opensFollowUp };
}

function checkDetect(input: Input, expected: Expect): void {
    const context = contextOf(String(input.marked));
    if (expected.context === null) {
        expect(context).toBeNull();
        return;
    }
    expect(context).not.toBeNull();
    const actual = comparableContext(context!);
    for (const [key, value] of Object.entries(expected.context as Expect)) expect(actual[key], key).toEqual(value);
}

function checkRank(input: Input, expected: Expect): void {
    const items = (input.items as ItemInput[]).map((item) => itemFrom({ ...item, kind: 'command' }));
    const limit = input.limit === undefined ? undefined : Number(input.limit);
    const ranked = rankItems(items, String(input.prefix), limit).map((item) => item.text);
    if (expected.texts !== undefined) expect(ranked).toEqual(expected.texts);
    if (expected.count !== undefined) expect(ranked).toHaveLength(Number(expected.count));
}

function checkApply(input: Input, expected: Expect): void {
    const applied = applyMarked(String(input.marked), itemFrom(input.item as ItemInput));
    expect(applied.result).toBe(expected.result);
    if (expected.opensFollowUp !== undefined) expect(applied.opensFollowUp).toBe(expected.opensFollowUp);
}

const CHECKS: Record<Operation, (input: Input, expected: Expect) => void> = {
    detectContext: checkDetect,
    rank: checkRank,
    apply: checkApply,
};

function runCase(testCase: SpecCase): void {
    const input = testCase.input as Input;
    CHECKS[input.op as Operation](input, testCase.expect as Expect);
}

describe('Vektoren completion.json (detectContext, rank, apply)', () => {
    it('enthält alle Fälle dieser Operationen', () => {
        expect(cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    it.each(cases)('$id: $name', (testCase) => runCase(testCase));
});

describe('Kontext: Randfälle', () => {
    it('Umlaute: Bereich in UTF-16, ein Umlaut beendet einen Befehlsnamen', () => {
        expect(contextOf('Größe \\ref{Bä|')).toEqual({
            kind: 'argument', argument: 'label', prefix: 'Bä', range: { location: 11, length: 2 },
        });
        expect(contextOf('\\grö|')).toBeNull();
        expect(contextOf('Füße \\sec|')?.range).toEqual({ location: 6, length: 3 });
    });

    it('Surrogatpaare zählen als zwei Einheiten, auch im Präfix', () => {
        const context = contextOf('😀 \\cite{a😀b|');
        expect(context?.prefix).toBe('a😀b');
        expect(context?.range).toEqual({ location: 9, length: 4 });
    });

    it('Cursor am Zeilenanfang: kein Kontext; die vorige Zeile wird nie gelesen', () => {
        expect(contextOf('\\ref{a\n|')).toBeNull();
        expect(contextOf('|\\ref{')).toBeNull();
        expect(contextOf('\\ref{\nfig|')).toBeNull();
        expect(contextOf('\\begin{figure}\r\n[|')).toBeNull();
        expect(contextOf('Text\r\n\\ref{a|')?.range).toEqual({ location: 11, length: 1 });
    });

    it('Kommentar-Zeile: auch nach \\\\%, aber nicht nach \\%; ein % in der Vorzeile zählt nicht', () => {
        expect(contextOf('% \\sec|')).toBeNull();
        expect(contextOf('a\\\\% \\ref{|')).toBeNull();
        expect(contextOf('\\% \\ref{|')?.kind).toBe('argument');
        expect(contextOf('% Kommentar\n\\ref{|')?.kind).toBe('argument');
    });

    it('Verbatim: die Erkennung ist zeilenweise, Code-Umgebungen filtert die Editor-Anbindung', () => {
        const marked = '\\begin{verbatim}\n\\ref{|';
        expect(contextOf(marked)?.kind).toBe('argument');
        const { text, cursor } = unmark(marked);
        expect(isInsideCode(text, cursor)).toBe(true);
        expect(contextOf('\\verb+\\sec#', '#')?.prefix).toBe('sec');
    });

    it(`liest höchstens ${MAXIMUM_LOOK_BEHIND} Zeichen zurück`, () => {
        const longWord = 'a'.repeat(MAXIMUM_LOOK_BEHIND);
        expect(contextOf(`\\ref{${longWord}|`)).toBeNull();
        expect(contextOf(`\\${longWord}|`)).toBeNull();
        expect(contextOf(`\\${longWord.slice(1)}|`)?.prefix).toHaveLength(MAXIMUM_LOOK_BEHIND - 1);
    });

    it('Cursor hinter dem Textende oder vor dem Zeilenanfang: kein Kontext', () => {
        expect(detectContext('\\sec', 5, 0)).toBeNull();
        expect(detectContext('\\sec', 2, 3)).toBeNull();
    });
});

describe('Rang und Übernahme: Randfälle', () => {
    it('Wortanfänge in UTF-16, Kombinationszeichen gehören zum Zeichen davor', () => {
        expect([...wordStarts('fig:😀ab')]).toEqual([4]);
        expect([...wordStarts('😀:ab')]).toEqual([3]);
        expect([...wordStarts('fooBar')]).toEqual([3]);
        expect([...wordStarts('e\u0301Bar')]).toEqual([2]);
        expect([...wordStarts('-\u0301x')]).toEqual([]);
    });

    it('Gleichstand: Codepunktreihenfolge, nicht UTF-16 (\\uFF21 vor 😀)', () => {
        const items = ['😀x', '\uFF21yx'].map((text) => createCompletionItem({ kind: 'label', text }));
        expect(rankItems(items, 'x').map((item) => item.text)).toEqual(['\uFF21yx', '😀x']);
    });

    it('Umlaute: Groß-/Kleinschreibung egal, Treffer im Zusatztext zuletzt', () => {
        const items = [
            createCompletionItem({ kind: 'citation', text: 'mueller2020', searchableExtra: 'Müller, Größe' }),
            createCompletionItem({ kind: 'citation', text: 'Größe' }),
        ];
        expect(rankItems(items, 'größe').map((item) => item.text)).toEqual(['Größe', 'mueller2020']);
    });

    it('Argument mit Emoji: schließt die Klammer, Cursor dahinter', () => {
        const label = createCompletionItem({ kind: 'label', text: 'x😀' });
        expect(applyMarked('\\ref{😀|}', label).result).toBe('\\ref{x😀}|');
    });

    it('Gerüst mit Leerzeichen-Einrückung und Einrückung der Zeile', () => {
        const figure = createCompletionItem({ kind: 'environment', text: 'enumerate' });
        expect(applyMarked('  \\begin{en|', figure, '    ').result).toBe('  \\begin{enumerate}\n      \\item |\n  \\end{enumerate}');
    });

    it('Gerüst entfällt, wenn die nächste Zeile (nach \\r\\n) schon \\end hat', () => {
        const figure = createCompletionItem({ kind: 'environment', text: 'figure' });
        expect(applyMarked('\\begin{fi|}\r\n  \\end{figure}', figure).result).toBe('\\begin{figure}|\r\n  \\end{figure}');
    });

    it('Befehl mit [ öffnet die Folgeliste, \\ref{} auch', () => {
        expect(applyMarked('\\re|', commandItem('ref', '{}')).opensFollowUp).toBe(true);
        expect(applyMarked('\\usepa|', commandItem('usepackage', '[]{}')).opensFollowUp).toBe(true);
    });
});
