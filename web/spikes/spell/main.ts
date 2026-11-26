// Electron-Hauptprogramm für Spike S8 (Wegwerfcode). Ein Fenster mit CodeMirror; der Treiber (run.mts) wählt die
// Variante über die Seiten-URL. Protokolliert: Ereignisse der Chromium-Rechtschreibung, jede Anfrage im
// webRequest-Filter (wie `installRequestFilter` in src/main/security.ts, hier nur mitschreiben) und Kontextmenü-Treffer.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WINDOW_WIDTH = 1100;
const WINDOW_HEIGHT = 800;
const DICTIONARY_NAMES: ReadonlySet<string> = new Set(['dictionary-de', 'dictionary-de-at']);

interface SpikeLog {
    readonly requests: string[];
    readonly spellEvents: string[];
    readonly contextMenus: { misspelledWord: string; suggestions: string[] }[];
}

const spikeLog: SpikeLog = { requests: [], spellEvents: [], contextMenus: [] };
(globalThis as { spikeLog?: SpikeLog }).spikeLog = spikeLog;

// Wie spikes/cm-perf: ohne VSync-Warten misst „bis nach dem Paint“ die Arbeit, nicht den Bildschirmtakt.
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('enable-precise-memory-info');

function watchSpellEvents(): void {
    const events = ['spellcheck-dictionary-initialized', 'spellcheck-dictionary-download-begin',
        'spellcheck-dictionary-download-success', 'spellcheck-dictionary-download-failure'] as const;
    for (const name of events) {
        session.defaultSession.on(name as 'spellcheck-dictionary-initialized', (_event, language) => {
            spikeLog.spellEvents.push(`${name} ${language}`);
        });
    }
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        spikeLog.requests.push(details.url);
        callback({});
    });
}

async function readDictionary(name: string): Promise<{ aff: string; dic: string }> {
    const modules = process.env['SPELL_SPIKE_MODULES'];
    if (modules === undefined || !DICTIONARY_NAMES.has(name)) throw new Error('Wörterbuch nicht verfügbar');
    const folder = join(modules, 'node_modules', name);
    return { aff: await readFile(join(folder, 'index.aff'), 'utf8'), dic: await readFile(join(folder, 'index.dic'), 'utf8') };
}

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: 'Spike S8: Rechtschreibung',
        show: false,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            spellcheck: process.env['SPELL_SPIKE_CHROMIUM'] !== '0',
            preload: join(__dirname, 'preload.cjs'),
        },
    });
    window.webContents.on('context-menu', (_event, params) => {
        spikeLog.contextMenus.push({ misspelledWord: params.misspelledWord, suggestions: params.dictionarySuggestions });
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    // Ohne Fokus prüft Chromium den Text nicht; `webContents.focus()` versucht es, ohne die App nach vorn zu holen.
    window.once('ready-to-show', () => {
        if (process.env['SPELL_SPIKE_FOCUS'] === 'window') window.show();
        else window.showInactive();
        window.webContents.focus();
    });
    const query = { mode: process.env['SPELL_SPIKE_MODE'] ?? 'chromium', syntax: process.env['SPELL_SPIKE_SYNTAX'] ?? '0' };
    void window.loadFile(join(__dirname, 'index.html'), { query });
    return window;
}

app.on('window-all-closed', () => app.quit());
void app.whenReady().then(() => {
    watchSpellEvents();
    ipcMain.handle('spike:dictionary', (_event, name: string) => readDictionary(name));
    createWindow();
});
