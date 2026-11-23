// Automatische Teilprüfungen im Renderer: Sandbox (e), CSP (f), Zwischenablage (d), Ablage (c).
import { appendLog, type CheckResult } from './log';

const violations: string[] = [];
document.addEventListener('securitypolicyviolation', (event) => {
    violations.push(`${event.violatedDirective} -> ${event.blockedURI || '(inline/eval)'}`);
});
export function getViolations(): string[] {
    return [...violations];
}

const GIF_BASE64 = 'R0lGODlhAQABAAAAACwAAAAAAQABAAACAkQBADs=';
const MINIMAL_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

export function runSandboxCheck(): CheckResult[] {
    const w = window as unknown as Record<string, unknown>;
    const absent = ['require', 'process', 'module', 'Buffer', 'global', '__dirname', 'ipcRenderer'].filter((n) => typeof w[n] !== 'undefined');
    return [
        { name: 'Sandbox aktiv (Preload meldet)', ok: window.spike.isSandboxed, detail: String(window.spike.isSandboxed) },
        { name: 'contextIsolation aktiv (Preload meldet)', ok: window.spike.isContextIsolated, detail: String(window.spike.isContextIsolated) },
        { name: 'Renderer ohne require/process/module/Buffer/global', ok: absent.length === 0, detail: absent.length === 0 ? 'alle undefined' : `vorhanden: ${absent.join(', ')}` },
        { name: 'window.spike zeigt nur freigegebene Funktionen', ok: !('ipcRenderer' in window.spike), detail: Object.keys(window.spike).join(', ') },
    ];
}

async function attempt(name: string, expectAllowed: boolean, action: () => Promise<unknown>): Promise<CheckResult> {
    try {
        await action();
        return { name, ok: expectAllowed, detail: 'erlaubt' };
    } catch (error) {
        return { name, ok: !expectAllowed, detail: `blockiert (${(error as Error).name})` };
    }
}

function imageLoads(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('img'));
        image.src = src;
    });
}

function runWorker(url: string, options?: WorkerOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(url, options);
        worker.onmessage = (event) => { worker.terminate(); resolve(JSON.stringify(event.data)); };
        worker.onerror = () => { worker.terminate(); reject(new Error('Worker')); };
        worker.postMessage(1);
    });
}

function inlineScriptBlocked(): Promise<void> {
    return new Promise((resolve, reject) => {
        (window as unknown as Record<string, unknown>).__inline = false;
        const script = document.createElement('script');
        script.textContent = 'window.__inline = true';
        document.head.append(script);
        setTimeout(() => ((window as unknown as Record<string, unknown>).__inline === true ? resolve() : reject(new Error('Inline blockiert'))), 50);
    });
}

export async function runCspCheck(): Promise<CheckResult[]> {
    const gif = new Blob([Uint8Array.from(atob(GIF_BASE64), (c) => c.charCodeAt(0))], { type: 'image/gif' });
    const blobUrl = URL.createObjectURL(gif);
    const blobWorker = URL.createObjectURL(new Blob(['postMessage("hi")'], { type: 'text/javascript' }));
    const before = violations.length;
    const results = [
        await attempt('Inline-Skript (erwartet: blockiert)', false, inlineScriptBlocked),
        await attempt('eval/new Function (erwartet: blockiert)', false, async () => new Function('return 1')()),
        await attempt('img data: (erwartet: erlaubt)', true, () => imageLoads(`data:image/gif;base64,${GIF_BASE64}`)),
        await attempt('img blob: (erwartet: erlaubt)', true, () => imageLoads(blobUrl)),
        await attempt('Worker blob: klassisch (erwartet: erlaubt)', true, () => runWorker(blobWorker)),
        await attempt('Modul-Worker aus eigenem Paket (erwartet: erlaubt)', true, () => runWorker(new URL('./probeWorker.js', document.baseURI).href, { type: 'module' })),
        await attempt('fetch blob: (erwartet: blockiert, connect-src)', false, () => fetch(blobUrl)),
        await attempt('fetch data: (erwartet: blockiert, connect-src)', false, () => fetch(`data:text/plain,x`)),
        await attempt('fetch https://example.invalid (erwartet: blockiert)', false, () => fetch('https://example.invalid/')),
        await attempt('WebAssembly.compile im Renderer (Info: ohne wasm-unsafe-eval)', false, () => WebAssembly.compile(MINIMAL_WASM)),
    ];
    appendLog('auto', `CSP-Verstöße während der Prüfung: ${violations.slice(before).join(' | ')}`);
    return results;
}

export async function probeWorkerReport(): Promise<string> {
    return runWorker(new URL('./probeWorker.js', document.baseURI).href, { type: 'module' });
}

export async function runClipboardCheck(): Promise<CheckResult[]> {
    const original = await window.spike.clipboardRead();
    const probe = 'S5 äöü {}[]\\@~| \tTab';
    const results = [
        await attempt('navigator.clipboard.writeText (Info)', true, () => navigator.clipboard.writeText(probe)),
        await attempt('navigator.clipboard.readText (Info: bei denyAll erwartet abgelehnt)', true, () => navigator.clipboard.readText()),
    ];
    await window.spike.clipboardWrite(probe);
    const back = await window.spike.clipboardRead();
    results.push({ name: 'Zwischenablage über IPC (Main: clipboard) schreiben/lesen', ok: back === probe, detail: JSON.stringify(back) });
    await window.spike.clipboardWrite(original);
    return results;
}

export async function runDropFromInput(): Promise<{ inputPath: string; dropPath: string; syntheticPath: string }> {
    const input = document.getElementById('fileInput') as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) throw new Error('keine Datei im Eingabefeld');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const zone = document.getElementById('dropzone') as HTMLElement;
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    const dropPath = lastDropPath;
    return { inputPath: window.spike.getPathForFile(file), dropPath, syntheticPath: window.spike.getPathForFile(new File(['x'], 'x.txt')) };
}

let lastDropPath = '';
export function installDropZone(): void {
    const zone = document.getElementById('dropzone') as HTMLElement;
    zone.addEventListener('dragover', (event) => event.preventDefault());
    zone.addEventListener('drop', (event) => {
        event.preventDefault();
        const files = [...(event.dataTransfer?.files ?? [])];
        lastDropPath = files.map((f) => window.spike.getPathForFile(f)).join(';');
        appendLog('dnd', `drop: ${files.length} Datei(en), Pfad(e): ${lastDropPath}`);
    });
}
