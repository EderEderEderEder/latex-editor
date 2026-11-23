// Prüfseite (Renderer): Oberfläche zum Anklicken und `window.checks` für Playwright.
import type { EditorView } from '@codemirror/view';
import { createEditor } from './editor';
import { compositionRecords, keyRecords, attachCompositionLogger, attachKeyLogger } from './inputLogging';
import { installDropZone, getViolations, probeWorkerReport, runClipboardCheck, runCspCheck, runDropFromInput, runSandboxCheck } from './autoChecks';
import { appendLog, describe, lines, type CheckResult } from './log';
import { loadOnce, measure, prepareWorker, type Variant } from './pdfTransport';

const PASTE_REPORT = 'clipboard';
const area = (id: string): HTMLTextAreaElement => document.getElementById(id) as HTMLTextAreaElement;
const editor: EditorView = createEditor(document.getElementById('editor') as HTMLElement);

attachKeyLogger(area('altgrText'), 'textarea');
attachKeyLogger(editor.contentDOM, 'codemirror');
attachCompositionLogger(area('imeText'), 'textarea');
attachCompositionLogger(editor.contentDOM, 'codemirror');
installDropZone();
area('pasteText').addEventListener('paste', (event) => {
    const data = event.clipboardData;
    appendLog(PASTE_REPORT, `paste types=${JSON.stringify(data?.types)} text/plain=${JSON.stringify(data?.getData('text/plain'))}`);
});

async function pdfSummary(variant: Variant, runs: number): Promise<string> {
    const { pdfPath } = await window.spike.getConfig();
    const times = await measure(variant, pdfPath, runs);
    return `${variant}: schnellster ${Math.min(...times).toFixed(1)} ms, Läufe ${times.map((t) => t.toFixed(0)).join('/')}`;
}

async function showResults(results: CheckResult[]): Promise<void> {
    for (const result of results) appendLog('auto', describe(result));
}

const checks = {
    config: () => window.spike.getConfig(),
    sandbox: () => runSandboxCheck(),
    csp: () => runCspCheck(),
    probeWorker: () => probeWorkerReport(),
    clipboard: () => runClipboardCheck(),
    drop: () => runDropFromInput(),
    violations: () => getViolations(),
    prepareWorker,
    loadOnce,
    measure,
    pdfSummary,
    focusTextarea: () => area('altgrText').focus(),
    focusEditor: () => editor.focus(),
    focusIme: () => area('imeText').focus(),
    focusImeEditor: () => editor.focus(),
    focusPaste: () => area('pasteText').focus(),
    textareaValue: () => area('altgrText').value,
    imeValue: () => area('imeText').value,
    pasteValue: () => area('pasteText').value,
    editorValue: () => editor.state.doc.toString(),
    keyRecords: () => keyRecords,
    compositionRecords: () => compositionRecords,
    logLines: () => lines,
    reset: () => {
        area('altgrText').value = '';
        area('imeText').value = '';
        area('pasteText').value = '';
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '' } });
    },
};
(window as unknown as { checks: typeof checks }).checks = checks;

async function runAllInPage(): Promise<void> {
    await showResults(runSandboxCheck());
    await showResults(await runCspCheck());
    await showResults(await runClipboardCheck());
    await prepareWorker();
    appendLog('auto', await pdfSummary('ipc', 5));
    appendLog('auto', await pdfSummary('protocolRange', 5));
    (document.getElementById('summary') as HTMLElement).textContent = 'fertig, Ergebnis im Feld (e)/(f)/(g)';
}

document.getElementById('runAll')?.addEventListener('click', () => void runAllInPage());
document.getElementById('btnSandbox')?.addEventListener('click', () => void showResults(runSandboxCheck()));
document.getElementById('btnCsp')?.addEventListener('click', () => void runCspCheck().then(showResults));
document.getElementById('btnClip')?.addEventListener('click', () => void runClipboardCheck().then(showResults));
document.getElementById('btnDrop')?.addEventListener('click', () => void runDropFromInput().then((r) => appendLog('dnd', JSON.stringify(r))));
document.getElementById('btnPdf')?.addEventListener('click', () => void prepareWorker().then(async () => {
    for (const variant of ['ipc', 'protocolRange', 'protocolFull'] as const) appendLog('auto', await pdfSummary(variant, 5));
}));
void window.spike.getConfig().then((config) => {
    (document.getElementById('info') as HTMLElement).textContent = `Seite ${config.pageName}, UA ${navigator.userAgent}`;
});
