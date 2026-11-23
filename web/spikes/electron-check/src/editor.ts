// Minimaler CodeMirror-Editor (View, State, Commands; ohne closeBrackets, sonst wären { [ doppelt).
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

export function createEditor(parent: HTMLElement): EditorView {
    const state = EditorState.create({
        doc: '',
        extensions: [lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap])],
    });
    return new EditorView({ state, parent });
}

export function setEditorText(view: EditorView, text: string): void {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
