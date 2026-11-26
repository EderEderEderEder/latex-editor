// Messungen ohne Fenster (Spike S8): Ladezeit/Speicher von nspell + dictionary-de/-de-at, Zeit je 1000 Wörter,
// Zusammensetzungen, Fehlalarme auf einer HgbDemo-Kopie in Stufen. Aufruf aus web/ (nach build.mts):
//   SPELL_SPIKE_MODULES=<Ordner> SPELL_SPIKE_DEMO=<Kopie von HgbDemo> node --expose-gc spikes/spell/out/nodeBench.mjs <Bezeichnung>
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { getStandardVocabulary } from '../../../src/shared/core/spelling/technicalVocabulary';
import { SpellChecker, type Hunspell, type Verdict } from './checker';
import { withoutCompoundOnlyEntries } from './dictionaryFix';
import { INVALID_COMPOUNDS, SINGLE_WORDS, SUGGEST_WORDS, VALID_COMPOUNDS } from './corpus';
import { findWords, type WordOccurrence } from './words';

const LOAD_RUNS = 3;
const TIMING_RUNS = 5;
const WORDS_PER_BLOCK = 1000;
const BYTES_PER_MB = 1024 * 1024;
interface DictionaryVariant {
    readonly name: string;
    /** `.dic` ohne ONLYINCOMPOUND-Einträge (Umgehung des nspell-Fehlers, `dictionaryFix.ts`) */
    readonly cleaned: boolean;
}

const VARIANTS: readonly DictionaryVariant[] = [
    { name: 'dictionary-de', cleaned: false },
    { name: 'dictionary-de', cleaned: true },
    { name: 'dictionary-de-at', cleaned: true },
];
const TEX_EXTENSION = '.tex';

const spikeDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultsDirectory = join(spikeDirectory, 'results');
/** Zusatzkorpus mit viel deutschem Fachtext (Markdown, nur gelesen) */
const PLAN_FILE = join(spikeDirectory, '../../../shared/PLAN-WEBUI.md');

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined) throw new Error(`${name} fehlt`);
    return value;
}

function heapMB(): number {
    (globalThis as { gc?: () => void }).gc?.();
    return process.memoryUsage().heapUsed / BYTES_PER_MB;
}

async function readDictionary(variant: DictionaryVariant): Promise<{ aff: string; dic: string; readMs: number; removed: number }> {
    const folder = join(requiredEnv('SPELL_SPIKE_MODULES'), 'node_modules', variant.name);
    const start = performance.now();
    const aff = await readFile(join(folder, 'index.aff'), 'utf8');
    const rawDic = await readFile(join(folder, 'index.dic'), 'utf8');
    const { dic, removed } = variant.cleaned ? withoutCompoundOnlyEntries(aff, rawDic) : { dic: rawDic, removed: 0 };
    return { aff, dic, readMs: performance.now() - start, removed };
}

interface LoadResult {
    readonly name: string;
    readonly cleaned: boolean;
    readonly removedEntries: number;
    readonly readMs: number;
    readonly buildMs: number[];
    readonly heapMB: number;
}

async function measureLoad(variant: DictionaryVariant): Promise<{ result: LoadResult; hunspell: Hunspell }> {
    const { aff, dic, readMs, removed } = await readDictionary(variant);
    const buildMs: number[] = [];
    let hunspell: Hunspell | null = null;
    let heapDelta = 0;
    for (let run = 0; run < LOAD_RUNS; run++) {
        hunspell = null;
        const before = heapMB();
        const start = performance.now();
        hunspell = nspell(aff, dic);
        buildMs.push(performance.now() - start);
        heapDelta = heapMB() - before;
    }
    if (hunspell === null) throw new Error('kein Wörterbuch');
    return { result: { ...variant, removedEntries: removed, readMs, buildMs, heapMB: heapDelta }, hunspell };
}

async function texFiles(folder: string): Promise<string[]> {
    const entries = await readdir(folder, { recursive: true });
    return entries.filter((entry) => entry.endsWith(TEX_EXTENSION)).sort().map((entry) => join(folder, entry));
}

async function demoWords(): Promise<WordOccurrence[]> {
    const words: WordOccurrence[] = [];
    for (const file of await texFiles(requiredEnv('SPELL_SPIKE_DEMO'))) words.push(...findWords(await readFile(file, 'utf8')));
    return words;
}

type StageName = 'alleWoerter' | 'ohneSyntax' | 'plusVokabular' | 'plusZerlegung';

interface StageResult {
    readonly stage: StageName;
    readonly checkedWords: number;
    readonly flaggedWords: number;
    readonly flaggedUnique: string[];
}

function flagged(words: readonly WordOccurrence[], checker: SpellChecker): WordOccurrence[] {
    return words.filter((occurrence) => checker.verdict(occurrence.word, occurrence.followedByDot) === 'unknown');
}

function stageResult(stage: StageName, words: readonly WordOccurrence[], checker: SpellChecker): StageResult {
    const hits = flagged(words, checker);
    return { stage, checkedWords: words.length, flaggedWords: hits.length, flaggedUnique: [...new Set(hits.map((hit) => hit.word))] };
}

function falsePositiveStages(words: readonly WordOccurrence[], hunspell: Hunspell): StageResult[] {
    const prose = words.filter((occurrence) => !occurrence.inSyntax);
    const vocabulary = getStandardVocabulary();
    return [
        stageResult('alleWoerter', words, new SpellChecker(hunspell, { vocabulary: null, splitCompounds: false })),
        stageResult('ohneSyntax', prose, new SpellChecker(hunspell, { vocabulary: null, splitCompounds: false })),
        stageResult('plusVokabular', prose, new SpellChecker(hunspell, { vocabulary, splitCompounds: false })),
        stageResult('plusZerlegung', prose, new SpellChecker(hunspell, { vocabulary, splitCompounds: true })),
    ];
}

interface TimingResult {
    readonly words: number;
    readonly coldMsPer1000: number;
    readonly warmMsPer1000: number;
}

/** Kalt = neuer Zwischenspeicher, warm = zweiter Durchgang; schnellster von TIMING_RUNS */
function timePer1000(words: readonly WordOccurrence[], hunspell: Hunspell): TimingResult {
    let cold = Number.POSITIVE_INFINITY;
    let warm = Number.POSITIVE_INFINITY;
    for (let run = 0; run < TIMING_RUNS; run++) {
        const checker = new SpellChecker(hunspell, { vocabulary: getStandardVocabulary(), splitCompounds: true });
        cold = Math.min(cold, timeWords(words, checker));
        warm = Math.min(warm, timeWords(words, checker));
    }
    const scale = WORDS_PER_BLOCK / words.length;
    return { words: words.length, coldMsPer1000: cold * scale, warmMsPer1000: warm * scale };
}

function timeWords(words: readonly WordOccurrence[], checker: SpellChecker): number {
    const start = performance.now();
    for (const occurrence of words) checker.verdict(occurrence.word, occurrence.followedByDot);
    return performance.now() - start;
}

function verdicts(words: readonly string[], hunspell: Hunspell): Record<string, Verdict> {
    const checker = new SpellChecker(hunspell, { vocabulary: getStandardVocabulary(), splitCompounds: true });
    return Object.fromEntries(words.map((word) => [word, checker.verdict(word)]));
}

function dictionaryOnly(words: readonly string[], hunspell: Hunspell): Record<string, boolean> {
    return Object.fromEntries(words.map((word) => [word, hunspell.correct(word)]));
}

function suggestTimes(hunspell: Hunspell): Record<string, { ms: number; suggestions: string[] }> {
    const entries = SUGGEST_WORDS.map((word) => {
        const start = performance.now();
        const suggestions = hunspell.suggest(word);
        return [word, { ms: performance.now() - start, suggestions: suggestions.slice(0, 5) }] as const;
    });
    return Object.fromEntries(entries);
}

async function planWords(): Promise<WordOccurrence[]> {
    // Markdown ist kein LaTeX: nur Wörter außerhalb von `Code` zählen grob, Syntaxfilter des Tokenizers ignoriert.
    const text = (await readFile(PLAN_FILE, 'utf8')).replace(/`[^`]*`/g, ' ');
    return findWords(text).map((occurrence) => ({ ...occurrence, inSyntax: false }));
}

async function benchDictionary(variant: DictionaryVariant, demo: WordOccurrence[], plan: WordOccurrence[]): Promise<object> {
    const { result, hunspell } = await measureLoad(variant);
    const prose = demo.filter((occurrence) => !occurrence.inSyntax);
    return {
        load: result,
        timingDemoProse: timePer1000(prose, hunspell),
        timingPlan: timePer1000(plan, hunspell),
        demoStages: falsePositiveStages(demo, hunspell),
        planStages: falsePositiveStages(plan, hunspell).slice(1),
        validCompounds: { dictionary: dictionaryOnly(VALID_COMPOUNDS, hunspell), full: verdicts(VALID_COMPOUNDS, hunspell) },
        invalidCompounds: { dictionary: dictionaryOnly(INVALID_COMPOUNDS, hunspell), full: verdicts(INVALID_COMPOUNDS, hunspell) },
        singleWords: dictionaryOnly(SINGLE_WORDS, hunspell),
        suggest: suggestTimes(hunspell),
    };
}

async function main(): Promise<void> {
    const label = process.argv[2] ?? 'node';
    const demo = await demoWords();
    const plan = await planWords();
    const report: Record<string, object> = { runtime: { node: process.version, electron: process.versions['electron'] ?? null } };
    for (const variant of VARIANTS) {
        report[`${variant.name}${variant.cleaned ? '-bereinigt' : '-roh'}`] = await benchDictionary(variant, demo, plan);
    }
    await mkdir(resultsDirectory, { recursive: true });
    await writeFile(join(resultsDirectory, `bench-${label}.json`), JSON.stringify(report, null, 4));
    console.log(`Ergebnis: results/bench-${label}.json`);
}

await main();
