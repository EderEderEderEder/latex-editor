// Ablage der pdf.js-Hilfsdateien neben der `index.html` (W3-3a): `electron.vite.config.ts` kopiert sie aus
// `node_modules/pdfjs-dist` nach `out/renderer/pdfjs/` (im Entwicklungsmodus liefert sie der Vite-Server unter
// `/pdfjs/`), `pdf/viewer.ts` lädt sie relativ zur Seite. Offline: Unter `out/renderer` lässt sie der Anfragefilter
// aus `main/security.ts` durch, alles andere blockiert er. Ohne DOM und ohne Node, damit beide Seiten es lesen.

/** Unterordner unter `out/renderer/` bzw. Pfad im Entwicklungsserver */
export const PDFJS_ASSET_DIRECTORY = 'pdfjs';

/** Modul-Worker von pdf.js (Parsen); Seiten rendert der Hauptthread (`disableWorkerRendering`) */
export const PDFJS_WORKER_FILE = 'pdf.worker.min.mjs';

/** Quelle in `pdfjs-dist` → Name unter `PDFJS_ASSET_DIRECTORY` */
export const PDFJS_WORKER_SOURCE = 'build/pdf.worker.min.mjs';

/** Ordner in `pdfjs-dist`, die unverändert mitkommen (Zeichensätze, Standardschriften, Wasm mit JS-Rückfall, ICC) */
export const PDFJS_ASSET_FOLDERS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;

export type PdfjsAssetFolder = (typeof PDFJS_ASSET_FOLDERS)[number];
