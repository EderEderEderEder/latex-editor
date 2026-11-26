// Gemeinsame Rechtschreib-Objekte der App (W7-2): ein Worker-Client für alle Sitzungen und die Zusatzwörter. Das
// Wörterbuch-Modul (`spellDictionary.ts`, Vite-Assets) wird erst beim Start des Workers dynamisch geladen.
import { getApi } from '../ipc/api';
import { statusStore } from '../stores/status';
import { SpellClient } from './spellClient';
import type { SpellDictionaryFiles } from './spellClient';
import { SpellWords } from './spellWords';

let sharedWords: SpellWords | null = null;
let sharedClient: SpellClient | null = null;

async function loadDictionary(): Promise<SpellDictionaryFiles> {
    const { loadAustrianDictionary } = await import('./spellDictionary');
    return loadAustrianDictionary();
}

export function sharedSpellWords(): SpellWords {
    sharedWords ??= new SpellWords({
        api: () => getApi().spell,
        report: (message) => statusStore.getState().show(message),
    });
    return sharedWords;
}

/** Client mit dem echten Worker; die Zusatzwörter folgen ihm automatisch */
export function sharedSpellClient(): SpellClient {
    if (sharedClient !== null) return sharedClient;
    const words = sharedSpellWords();
    const client = new SpellClient({
        loadDictionary,
        onUnavailable: (text) => statusStore.getState().show({ text, kind: 'error' }),
    });
    client.setWords(words.all());
    words.subscribe(() => client.setWords(words.all()));
    sharedClient = client;
    return client;
}
