// `pdfjs-dist/web/pdf_viewer.mjs` liest die Bibliothek beim Laden aus `globalThis.pdfjsLib`; dieses Modul muss
// deshalb vor dem Viewer importiert werden (Module laufen in Importreihenfolge).
import * as pdfjsLib from 'pdfjs-dist';

(globalThis as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
