// Einstieg der W3-3a-Messseite. Reihenfolge der Importe zählt: zuerst die CSP-Beobachtung, dann `pdfjsLib` global
// (für den Viewer), dann S2 (`window.spikeRun`, setzt den Worker-Pfad), dann die Messungen.
import './cspProbe';
import './pdfjsGlobal';
import '../../src/page.mts';
import { collectedViolations, probeCsp } from './cspProbe';
import { createEditor } from './editor';
import { base64ToBytes, type RenderMode } from './pdfSetup';
import { closeViewer, jumpTo, openViewer, scrollThrough } from './scrollProbe';
import { beginTyping, finishTyping, type LoadMode } from './typingProbe';

const editorParent = document.getElementById('editor');
if (editorParent === null) throw new Error('#editor fehlt');
const view = createEditor(editorParent);
let pdfBytes: Uint8Array | null = null;

const api = {
    setPdf: (base64: string): number => {
        pdfBytes = base64ToBytes(base64);
        return pdfBytes.byteLength;
    },
    focusEditor: (): boolean => {
        view.focus();
        return view.hasFocus;
    },
    documentLength: (): number => view.state.doc.length,
    probeCsp,
    violations: collectedViolations,
    beginTyping: (mode: LoadMode, warmupMs: number, pixelRatio: number | null) => beginTyping(pdfBytes, mode, warmupMs, pixelRatio),
    finishTyping,
    openViewer: (mode: RenderMode) => {
        if (pdfBytes === null) throw new Error('Kein PDF gesetzt');
        return openViewer(pdfBytes, mode);
    },
    scrollThrough,
    jumpTo,
    closeViewer,
};

export type W33aApi = typeof api;
(window as unknown as { w33a: W33aApi }).w33a = api;
