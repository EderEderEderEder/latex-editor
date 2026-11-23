// Ablauf des Spikes S2 (Node): vorbereiten → PDFKit-Referenz → pdf.js in Electron (Playwright) → auswerten.
//   node build/run.mjs [Wiederholungen]
// Ergebnisse: results/results.json und results/table.md im Spike-Ordner.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron } from "playwright";
import { evaluate, summarizeTimings } from "./compare.mjs";
import type { MarkEvaluation } from "./compare.mjs";
import { markInputs, prepareDocuments, workDirectory } from "./prepare.mjs";
import type { TestDocument } from "./prepare.mjs";
import type { MarkInput, MarkOutput, SpikeRequest, SpikeResponse } from "./types.mjs";

const runProcess = promisify(execFile);
const DEFAULT_REPETITIONS = 7;
const TEXT_LAYER_SCALE = 1.5;
const REFERENCE_BUFFER = 32 * 1024 * 1024;
const spikeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function referenceBinary(): Promise<string> {
    const binary = path.join(workDirectory, "pdfkitReference");
    if (existsSync(binary)) return binary;
    const cache = path.join(workDirectory, "swiftcache");
    await runProcess("swiftc", ["-O", "-module-cache-path", cache, path.join(spikeDirectory, "reference", "pdfkitReference.swift"), "-o", binary]);
    return binary;
}

async function pdfKitReference(inputs: MarkInput[], documents: TestDocument[]): Promise<MarkOutput[]> {
    const withPaths = inputs.map((input) => ({ ...input, pdf: documents.find((document) => document.key === input.pdf)?.pdf ?? "" }));
    const file = path.join(workDirectory, "reference-input.json");
    await writeFile(file, JSON.stringify(withPaths));
    const { stdout } = await runProcess(await referenceBinary(), ["resolve", file], { maxBuffer: REFERENCE_BUFFER });
    return JSON.parse(stdout) as MarkOutput[];
}

async function measureWithPdfJs(request: SpikeRequest): Promise<{ response: SpikeResponse; console: string[] }> {
    const electronPath = createRequire(import.meta.url)("electron") as string;
    const application = await _electron.launch({ executablePath: electronPath, args: [path.join(spikeDirectory, "build", "main.mjs")] });
    const messages: string[] = [];
    try {
        const page = await application.firstWindow();
        page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
        await page.waitForFunction(() => window.spikeRun !== undefined);
        const response = await page.evaluate(async (input) => {
            if (!window.spikeRun) throw new Error("spikeRun fehlt");
            return window.spikeRun(input);
        }, request);
        return { response, console: messages };
    } finally {
        const pid = application.process().pid;
        await application.close();
        stopIfAlive(pid);
    }
}

/** Nur die eigene Electron-PID, falls `close()` sie nicht beendet hat */
function stopIfAlive(pid: number | undefined): void {
    if (pid === undefined) return;
    try {
        process.kill(pid, 0);
    } catch {
        return;
    }
    process.kill(pid, "SIGTERM");
    console.log(`Electron-Prozess ${pid} beendet`);
}

async function pdfPayload(documents: TestDocument[]): Promise<Record<string, string>> {
    const payload: Record<string, string> = {};
    for (const document of documents) payload[document.key] = (await readFile(document.pdf)).toString("base64");
    return payload;
}

async function main(): Promise<void> {
    const repetitions = Number(process.argv[2] ?? DEFAULT_REPETITIONS);
    const documents = await prepareDocuments(spikeDirectory);
    const { marks, inputs } = await markInputs(spikeDirectory, documents);
    const reference = await pdfKitReference(inputs, documents);
    const request: SpikeRequest = { pdfs: await pdfPayload(documents), marks: inputs, repetitions, scale: TEXT_LAYER_SCALE };
    const { response, console: messages } = await measureWithPdfJs(request);
    const evaluations = response.runs.map((run) => ({
        variant: run.variant,
        timing: summarizeTimings(run),
        notes: run.notes,
        marks: marks.map((mark, index) => evaluate(mark, run.outputs[index] ?? emptyOutput(mark.id), reference[index] ?? emptyOutput(mark.id))),
    }));
    const markdown = table(evaluations);
    await writeResults({ environment: response.environment, inputs, reference, runs: response.runs, evaluations, console: messages }, markdown);
    console.log(JSON.stringify(response.environment));
    console.log(markdown);
}

function emptyOutput(id: string): MarkOutput {
    return { id, precision: "orphaned", segments: [], text: "" };
}

interface Evaluated {
    variant: string;
    timing: ReturnType<typeof summarizeTimings>;
    notes: string[];
    marks: MarkEvaluation[];
}

async function writeResults(results: object, markdown: string): Promise<void> {
    const directory = path.join(spikeDirectory, "results");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
    await writeFile(path.join(directory, "table.md"), `${markdown}\n`);
}

function summaryLine(evaluation: Evaluated): string {
    const count = (verdict: string): number => evaluation.marks.filter((mark) => mark.verdict === verdict).length;
    const wordCases = evaluation.marks.filter((mark) => mark.referencePrecision === "words").length;
    const exact = count("wortgenau");
    const t = evaluation.timing;
    return `| ${evaluation.variant} | ${exact}/${wordCases} (${((100 * exact) / Math.max(wordCases, 1)).toFixed(0)} %) | ${count("visuell")} | ${count("Rückfall wie Swift")} | ${count("daneben")} | ${t.meanPerPage.toFixed(2)} | ${t.maxPerPage.toFixed(2)} | ${t.textContentMean.toFixed(2)} | ${t.fastestTotal.toFixed(0)}–${t.slowestTotal.toFixed(0)} | ${t.resolveFastest.toFixed(2)} |`;
}

function detailLine(mark: MarkEvaluation): string {
    return `| ${mark.id} | ${mark.category} | ${mark.referencePrecision}${mark.referenceTrusted ? "" : " (?)"} | ${mark.precision} | ${mark.startDelta.toFixed(2)} | ${mark.endDelta.toFixed(2)} | ${mark.verdict} | ${mark.reason} |`;
}

function table(evaluations: Evaluated[]): string {
    const lines = [
        "| Variante | wortgenau (≤ 1,5 pt) | visuell (≤ 3 pt) | Rückfall wie Swift | daneben | ms/Seite Mittel | ms/Seite max | davon getTextContent | Summe aller Seiten min–max | Zuordnen aller Markierungen |",
        "|---|---|---|---|---|---|---|---|---|---|",
        ...evaluations.map(summaryLine),
    ];
    for (const evaluation of evaluations) {
        lines.push("", `### ${evaluation.variant}`, ...evaluation.notes, "", "| Id | Fall | PDFKit | pdf.js | Δ Anfang pt | Δ Ende pt | Urteil | Grund |", "|---|---|---|---|---|---|---|---|");
        lines.push(...evaluation.marks.map(detailLine));
    }
    return lines.join("\n");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
