// Editor der Messseite: dieselben Erweiterungen wie `EditorSession` der App (Einfärbung, Zeilenleiste, Einklappen,
// Tippen, Suche, Darstellung), nur ohne Diagnose (deren Worker-URL ist electron-vite-spezifisch) und ohne IPC.
// Text: das synthetische 10.000-Zeilen-Dokument der M1-Leistungsmessung.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { currentAppearance, appearanceExtensions } from '../../../../src/renderer/editor/appearance';
import { buildMarksExtension } from '../../../../src/renderer/editor/buildMarks';
import { foldingExtension } from '../../../../src/renderer/editor/folding';
import { gutterExtension } from '../../../../src/renderer/editor/gutter';
import { syntaxHighlightingForPath } from '../../../../src/renderer/editor/language';
import { searchExtension } from '../../../../src/renderer/editor/search';
import { typingExtension } from '../../../../src/renderer/editor/typing';
import { generateSyntheticDocument } from '../../../../tests/perf/syntheticDocument';

const FILE_NAME = 'main.tex';
/** Cursor etwa in der Mitte, wie „Tastendruck mittig“ der M1-Messung */
const CURSOR_LINE = 5_000;

export function createEditor(parent: HTMLElement): EditorView {
    const context = { path: FILE_NAME, name: FILE_NAME };
    const doc = generateSyntheticDocument();
    const state = EditorState.create({
        doc,
        extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            syntaxHighlightingForPath(FILE_NAME),
            gutterExtension(context),
            foldingExtension(context),
            buildMarksExtension(),
            typingExtension(context),
            searchExtension(),
            appearanceExtensions(currentAppearance()),
        ],
    });
    const view = new EditorView({ state, parent });
    const line = view.state.doc.line(Math.min(CURSOR_LINE, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
    return view;
}
