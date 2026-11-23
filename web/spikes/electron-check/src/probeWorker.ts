// Kleiner Modul-Worker aus dem eigenen Paket: meldet, was unter der CSP im Worker geht.
const MINIMAL_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

async function wasmWorks(): Promise<string> {
    try {
        await WebAssembly.compile(MINIMAL_WASM);
        return 'ja';
    } catch (error) {
        return `nein (${(error as Error).name})`;
    }
}

self.onmessage = async () => {
    self.postMessage({ wasm: await wasmWorks(), crossOriginIsolated: self.crossOriginIsolated });
};
