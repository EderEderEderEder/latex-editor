// Die Gliederung der App (ein Store je App-Lauf). Gelesen wird der Text offener Dateien aus ihrer Sitzung (auch
// Ungespeichertes), sonst von der Platte über `fs:readText` mit dem absoluten Projektpfad.
import { getApi } from '../ipc/api';
import { editorStore } from '../stores/editor';
import { createOutlineStore } from '../stores/outline';

async function readOutlineSource(path: string): Promise<string | null> {
    const session = editorStore.getState().session(path);
    if (session !== undefined) return session.state.doc.toString();
    try {
        const read = await getApi().fs.readText(path);
        return read.ok ? read.value.text : null;
    } catch {
        return null;
    }
}

export const outlineStore = createOutlineStore({ readFile: readOutlineSource });
