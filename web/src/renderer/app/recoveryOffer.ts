// Nachfrage nach einem Absturz oder einem „Nicht speichern“ (W2-14, Vorbild Swift `offerRecovery`): Gibt es Sicherungen
// früherer Läufe, fragt ein Dialog, ob sie wiederhergestellt werden. „Wiederherstellen“ öffnet jede Datei und setzt den
// gesicherten Text als ungespeicherte Änderung ein (die Platte bleibt unberührt, erst Strg+S schreibt); „Verwerfen“
// löscht die Sicherungen. Ohne Entscheidung (Escape) bleiben sie liegen.
import type { RecoveryItem, RendererApi } from '../../shared/contract';
import type { EditorSession } from '../editor/session';
import type { EditorStore } from '../stores/editor';
import type { StatusMessage } from '../stores/status';
import type { RecoveryChoice } from './recoveryPrompt';

export interface RecoveryOfferDeps {
    readonly api: Pick<RendererApi, 'recovery' | 'fs'>;
    readonly store: EditorStore;
    readonly report: (message: StatusMessage) => void;
    readonly ask: (items: readonly RecoveryItem[]) => Promise<RecoveryChoice>;
    /** Läuft nach dem Wiederherstellen: schreibt die Sicherungen der wiederhergestellten Tabs sofort neu */
    readonly afterRestore?: () => Promise<void>;
}

export interface OfferResult {
    readonly offered: number;
    readonly choice: RecoveryChoice | null;
    readonly restored: number;
}

const EMPTY_FILE_TEXT = '';
const DATE_LOCALE = 'de-AT';
const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

export const RECOVERY_OFFER_TEXTS = {
    title: 'Ungespeicherte Änderungen wiederherstellen?',
    intro: 'Aus der letzten Sitzung sind ungespeicherte Änderungen gesichert:',
    hint: 'Wiederhergestellte Texte sind noch nicht gespeichert (Strg+S).',
    entry: (name: string, savedAt: number) => `${name} (Stand ${formatSavedAt(savedAt)})`,
    changed: 'Die Datei auf der Platte wurde seitdem geändert; Speichern überschreibt diese Änderung.',
    missing: 'Die Datei existiert nicht mehr und wird neu angelegt.',
    restore: 'Wiederherstellen',
    discard: 'Verwerfen',
    restored: (count: number) =>
        count === 1 ? 'Eine Datei wiederhergestellt (noch nicht gespeichert).' : `${count} Dateien wiederhergestellt (noch nicht gespeichert).`,
    failed: (name: string, detail: string) => `Wiederherstellen von „${name}“ fehlgeschlagen: ${detail}`,
} as const;

export function formatSavedAt(savedAt: number): string {
    return new Date(savedAt).toLocaleString(DATE_LOCALE, DATE_FORMAT);
}

function reportFailure(deps: RecoveryOfferDeps, item: RecoveryItem, detail: string): void {
    deps.report({ text: RECOVERY_OFFER_TEXTS.failed(item.name, detail), kind: 'error' });
}

/** Fehlende Datei neu anlegen (leer), damit sie sich wie eine normale Datei öffnen lässt; Swift legt sie ebenso an */
async function recreateFile(deps: RecoveryOfferDeps, item: RecoveryItem): Promise<boolean> {
    const written = await deps.api.fs.writeText(item.path, EMPTY_FILE_TEXT, 'utf8', 'lf');
    if (written.ok) return true;
    reportFailure(deps, item, written.error.message);
    return false;
}

async function sessionFor(deps: RecoveryOfferDeps, item: RecoveryItem): Promise<EditorSession | null> {
    const existing = deps.store.getState().session(item.path);
    if (existing !== undefined) return existing;
    if (item.diskState === 'missing' && !(await recreateFile(deps, item))) return null;
    const read = await deps.api.fs.readText(item.path);
    if (!read.ok) {
        reportFailure(deps, item, read.error.message);
        return null;
    }
    deps.store.getState().open(read.value, { asPreview: false });
    return deps.store.getState().session(item.path) ?? null;
}

async function restoreItem(deps: RecoveryOfferDeps, item: RecoveryItem): Promise<boolean> {
    const session = await sessionFor(deps, item);
    if (session === null) return false;
    session.replaceText(item.text);
    return true;
}

async function restoreAll(deps: RecoveryOfferDeps, items: readonly RecoveryItem[]): Promise<number> {
    let restored = 0;
    for (const item of items) if (await restoreItem(deps, item)) restored++;
    if (restored > 0) deps.report({ text: RECOVERY_OFFER_TEXTS.restored(restored), kind: 'info' });
    await deps.afterRestore?.();
    return restored;
}

async function discardAll(deps: RecoveryOfferDeps, items: readonly RecoveryItem[]): Promise<void> {
    for (const item of items) await deps.api.recovery.delete(item.path);
}

export async function offerRecovery(deps: RecoveryOfferDeps): Promise<OfferResult> {
    const listed = await deps.api.recovery.list();
    if (!listed.ok || listed.value.length === 0) return { offered: 0, choice: null, restored: 0 };
    const items = listed.value;
    const choice = await deps.ask(items);
    if (choice === 'discard') await discardAll(deps, items);
    const restored = choice === 'restore' ? await restoreAll(deps, items) : 0;
    return { offered: items.length, choice, restored };
}

/** Fragen laufen nacheinander (Start und Projektwechsel können sich überschneiden) */
export function createOfferRunner(deps: RecoveryOfferDeps): () => Promise<OfferResult> {
    let chain: Promise<unknown> = Promise.resolve();
    return () => {
        const run = chain.then(() => offerRecovery(deps));
        chain = run.catch(() => undefined);
        return run;
    };
}
