// Abhängigkeiten der Abläufe des Einfügen-Fensters (W4-10); die App-Singletons stehen in `insertRuntime.ts`,
// Tests liefern Fälschungen (Stub-API, eigene Stores).
import type { RendererApi } from '../../shared/contract';
import type { AppUndoStore } from '../stores/appUndo';
import type { InsertStore } from '../stores/insert';
import type { OverlayStore } from '../stores/overlays';
import type { StatusMessage } from '../stores/status';
import type { InsertCatalogDeps } from './insertCatalog';

export interface InsertDeps extends InsertCatalogDeps {
    readonly api: Pick<RendererApi, 'fs' | 'dialog' | 'image' | 'bib' | 'dragDrop'>;
    readonly insert: InsertStore;
    readonly overlays: Pick<OverlayStore, 'getState'>;
    readonly appUndo: AppUndoStore;
    readonly report: (message: StatusMessage) => void;
    /** Heutiges Datum `JJJJ-MM-TT` (Abrufdatum bei Webseiten) */
    readonly today: () => string;
    readonly focusEditor: () => void;
}
