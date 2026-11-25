// „Neu …“: Name im Speichern-Dialog wählen, leere Datei schreiben und als festen Tab öffnen.
import { OPEN_FILTERS, readGrantedFile, SAVE_TEXTS } from './fileActions';
import type { FileActionDeps } from './fileActions';

export async function createNewFile(deps: FileActionDeps): Promise<boolean> {
    const picked = await deps.api.dialog.saveAs({ title: 'Neue Datei', filters: OPEN_FILTERS });
    if (!picked.ok) {
        deps.report({ text: SAVE_TEXTS.openFailed(picked.error.message), kind: 'error' });
        return false;
    }
    if (picked.value === null) return false;
    const written = await deps.api.fs.writeText(picked.value.grantId, '', 'utf8', 'lf');
    if (!written.ok) {
        deps.report({ text: SAVE_TEXTS.failed(picked.value.name, written.error.message), kind: 'error' });
        return false;
    }
    const read = await readGrantedFile(deps.api, picked.value);
    if (!read.ok) {
        deps.report({ text: SAVE_TEXTS.openFailed(read.error.message), kind: 'error' });
        return false;
    }
    deps.store.getState().open(read.value, { asPreview: false });
    return true;
}
