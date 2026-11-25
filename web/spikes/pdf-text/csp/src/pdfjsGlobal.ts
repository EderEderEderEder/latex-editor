// `pdfjs-dist/web/pdf_viewer.mjs` liest die Bibliothek aus `globalThis.pdfjsLib`; muss vor dem Viewer geladen werden.
import * as pdfjsLib from 'pdfjs-dist';

(globalThis as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
