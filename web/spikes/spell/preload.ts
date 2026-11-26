// Sandbox-Preload für Spike S8: Wörterbuch per IPC und Variante `webFrame.setSpellCheckProvider`.
// Der Anbieter meldet nur Wörter aus FAKE_MISSPELLED als falsch und schreibt mit, welche Wörter Chromium schickt
// (zeigt, wie Chromium LaTeX zerlegt und ob `spellcheck="false"` auf Syntax-Spans wirkt).
import { contextBridge, ipcRenderer, webFrame } from 'electron';

const PROVIDER_LANGUAGE = 'de-AT';
const FAKE_MISSPELLED: ReadonlySet<string> = new Set([
    'Rechtschreibfeler', 'Tippfehlr', 'fehlerhaftt', 'Kommentaar', 'befehlx', 'alphaa', 'Optionfehler',
]);

const providerWords: string[][] = [];

function enableProvider(): void {
    webFrame.setSpellCheckProvider(PROVIDER_LANGUAGE, {
        spellCheck(words, callback) {
            providerWords.push([...words]);
            callback(words.filter((word) => FAKE_MISSPELLED.has(word)));
        },
    });
}

contextBridge.exposeInMainWorld('spikeHost', {
    loadDictionary: (name: string): Promise<{ aff: string; dic: string }> => ipcRenderer.invoke('spike:dictionary', name),
    enableProvider,
    providerWords: (): string[][] => providerWords.map((batch) => [...batch]),
});
