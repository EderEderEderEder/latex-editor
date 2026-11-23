// Preload des Spikes (Sandbox: nur `electron`-Module erlaubt). Gleiche Bauart wie src/preload/index.ts.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { SpikeApi, SpikeConfig } from './src/spikeApi';

const api: SpikeApi = {
    isContextIsolated: process.contextIsolated,
    isSandboxed: process.sandboxed,
    getConfig: () => ipcRenderer.invoke('spike:config') as Promise<SpikeConfig>,
    getPathForFile: (file) => webUtils.getPathForFile(file),
    readPdf: (path) => ipcRenderer.invoke('spike:readPdf', path) as Promise<ArrayBuffer>,
    clipboardRead: () => ipcRenderer.invoke('spike:clipboardRead') as Promise<string>,
    clipboardWrite: (text) => ipcRenderer.invoke('spike:clipboardWrite', text) as Promise<void>,
};

contextBridge.exposeInMainWorld('spike', api);
