// Was unter RENDERER_CSP geht: CSP-Verstöße der ganzen Sitzung, WebAssembly, Laden der pdf.js-Hilfsdaten
// (pdf.js lädt `cMapUrl`/`standardFontDataUrl`/`wasmUrl` bei `file:` im Hauptthread per XMLHttpRequest).
const MINIMAL_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const ASSET_SAMPLES = ['./cmaps/Adobe-Japan1-UCS2.bcmap', './standard_fonts/FoxitSerif.pfb', './wasm/openjpeg.wasm'];

export interface Violation {
    directive: string;
    blocked: string;
    source: string;
}

const violations: Violation[] = [];

document.addEventListener('securitypolicyviolation', (event) => {
    const violation = { directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile };
    violations.push(violation);
    console.warn(`CSP-Verstoß: ${JSON.stringify(violation)}`);
});

export function collectedViolations(): Violation[] {
    return [...violations];
}

async function wasmWorks(): Promise<string> {
    try {
        await WebAssembly.compile(MINIMAL_WASM);
        return 'ja';
    } catch (error) {
        return `nein (${(error as Error).name})`;
    }
}

function xhrBytes(url: string): Promise<string> {
    return new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.responseType = 'arraybuffer';
        request.onload = () => resolve(`Status ${request.status}, ${(request.response as ArrayBuffer | null)?.byteLength ?? 0} Bytes`);
        request.onerror = () => resolve('Fehler');
        request.send();
    });
}

async function fetchBytes(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        return `Status ${response.status}, ${(await response.arrayBuffer()).byteLength} Bytes`;
    } catch (error) {
        return `Fehler (${(error as Error).message})`;
    }
}

export async function probeCsp(): Promise<Record<string, string>> {
    const result: Record<string, string> = { wasm: await wasmWorks(), baseURI: document.baseURI };
    for (const sample of ASSET_SAMPLES) {
        const url = new URL(sample, document.baseURI).href;
        result[`xhr ${sample}`] = await xhrBytes(url);
        result[`fetch ${sample}`] = await fetchBytes(url);
    }
    return result;
}
