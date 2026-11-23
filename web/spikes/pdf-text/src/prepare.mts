// Vorbereitung (Node): Testdokumente in $TMPDIR kopieren und dort kompilieren, Testmarkierungen über das
// `synctex`-Programm (nur im Spike; die App bekommt einen eigenen Parser, S3) in Seiten und Rechtecke übersetzen.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { wordsOf } from "./matcher.mjs";
import type { MarkInput, Rect, SideInput } from "./types.mjs";

const run = promisify(execFile);
const TEX_BIN = "/Library/TeX/texbin";
const MAXIMUM_STORED_WORDS = 3;
const LATEXMK_TIMEOUT_MS = 300_000;

export const workDirectory = path.join(os.tmpdir(), "s2-pdftext");

export interface TestDocument {
    key: string;
    directory: string;
    mainFile: string;
    pdf: string;
}

export interface TestMark {
    id: string;
    doc: string;
    category: string;
    start: { file: string; line: number };
    end: { file: string; line: number };
    text: string;
}

/** latexmk erkennt selbst (über Prüfsummen), ob sich etwas geändert hat */
async function compile(document: TestDocument): Promise<void> {
    const env = { ...process.env, PATH: `${TEX_BIN}:${process.env.PATH ?? ""}` };
    await run(`${TEX_BIN}/latexmk`, ["-pdf", "-synctex=1", "-interaction=nonstopmode", "-halt-on-error", document.mainFile],
        { cwd: document.directory, env, timeout: LATEXMK_TIMEOUT_MS });
}

/** Kopien anlegen (nie im Original kompilieren) und bauen */
export async function prepareDocuments(spikeDirectory: string): Promise<TestDocument[]> {
    const demoSource = path.resolve(spikeDirectory, "../../../shared/Testdaten/HgbDemo");
    const demo = path.join(workDirectory, "HgbDemo");
    const test = path.join(workDirectory, "test");
    if (!existsSync(demo)) await cp(demoSource, demo, { recursive: true });
    await mkdir(test, { recursive: true });
    await cp(path.join(spikeDirectory, "testdoc", "s2test.tex"), path.join(test, "s2test.tex"));
    const documents: TestDocument[] = [
        { key: "hgb", directory: demo, mainFile: "main.tex", pdf: path.join(demo, "main.pdf") },
        { key: "test", directory: test, mainFile: "s2test.tex", pdf: path.join(test, "s2test.pdf") },
    ];
    for (const document of documents) await compile(document);
    return documents;
}

interface SyncTeXRecord {
    page: number;
    rect: Rect;
}

function parseViewOutput(output: string): SyncTeXRecord[] {
    return output.split("Output:").slice(1).flatMap((block) => {
        const value = (name: string): number => Number(new RegExp(`^${name}:(-?[\\d.]+)`, "m").exec(block)?.[1] ?? NaN);
        const [page, h, v, width, height] = [value("Page"), value("h"), value("v"), value("W"), value("H")];
        if ([page, h, v, width, height].some(Number.isNaN)) return [];
        return [{ page, rect: { x: h, y: v - height, width, height } }];
    });
}

function union(rects: Rect[]): Rect {
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Wie `SyncTeXIndex.forward` in Swift: alle Zeilenboxen der Quellzeile auf der ersten Seite, vereinigt */
async function forward(document: TestDocument, file: string, line: number): Promise<{ page: number; rect: Rect }> {
    const { stdout } = await run(`${TEX_BIN}/synctex`, ["view", "-i", `${line}:0:${file}`, "-o", document.pdf], { cwd: document.directory });
    const records = parseViewOutput(stdout).filter((record) => record.rect.width > 0);
    if (records.length === 0) throw new Error(`SyncTeX kennt ${file}:${line} nicht`);
    const page = Math.min(...records.map((record) => record.page));
    return { page, rect: union(records.filter((record) => record.page === page).map((record) => record.rect)) };
}

async function sideOf(document: TestDocument, file: string, line: number, words: string[]): Promise<SideInput> {
    const box = await forward(document, file, line);
    return { page: box.page, rect: box.rect, words };
}

/** Wörter wie `MarkCreator.makeMark`: die ersten bzw. letzten drei Wörter der Auswahl */
export async function markInputs(spikeDirectory: string, documents: TestDocument[]): Promise<{ marks: TestMark[]; inputs: MarkInput[] }> {
    const marks = JSON.parse(await readFile(path.join(spikeDirectory, "marks.json"), "utf8")) as TestMark[];
    const inputs: MarkInput[] = [];
    for (const mark of marks) {
        const document = documents.find((candidate) => candidate.key === mark.doc);
        if (!document) throw new Error(`Unbekanntes Dokument ${mark.doc}`);
        const words = wordsOf(mark.text);
        const start = await sideOf(document, mark.start.file, mark.start.line, words.slice(0, MAXIMUM_STORED_WORDS));
        const end = await sideOf(document, mark.end.file, mark.end.line, words.slice(-MAXIMUM_STORED_WORDS));
        inputs.push({ id: mark.id, pdf: mark.doc, start, end });
    }
    return { marks, inputs };
}
