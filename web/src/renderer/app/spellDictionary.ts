// Österreichisches Wörterbuch (`dictionary-de-at` 3.0.0, igerman98, Daten GPL-2.0 OR GPL-3.0) als eigene Dateien im
// Renderer-Bündel (W7-2): Vite legt `index.aff`/`index.dic` als Assets nach `out/renderer/assets/` (Alias
// `@spell-dictionary/de-at` in `electron.vite.config.ts`, weil das Paket nur `index.js` exportiert). Geladen wird erst
// bei der ersten Prüfung (`spellRuntime.ts` importiert dieses Modul dynamisch), per `fetch` aus dem eigenen Ordner:
// erlaubt durch `connect-src 'self'` und den Anfragefilter (nur unter `out/renderer`), kein Netz, kein `node_modules`.
import affixUrl from '@spell-dictionary/de-at/index.aff?url';
import dictionaryUrl from '@spell-dictionary/de-at/index.dic?url';
import type { SpellDictionaryFiles } from './spellClient';

/** `file:` liefert je nach Chromium-Stand Status 0 statt 200; ein leerer Inhalt gilt dann als Fehler */
const FILE_PROTOCOL_STATUS = 0;

function fileNameOf(url: string): string {
    return url.split('/').pop()?.split('?')[0] ?? url;
}

async function readAsset(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok && response.status !== FILE_PROTOCOL_STATUS) {
        throw new Error(`${fileNameOf(url)}: Status ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) throw new Error(`${fileNameOf(url)}: leer`);
    return bytes;
}

export async function loadAustrianDictionary(): Promise<SpellDictionaryFiles> {
    const [affix, dictionary] = await Promise.all([readAsset(affixUrl), readAsset(dictionaryUrl)]);
    return { affix, dictionary };
}
