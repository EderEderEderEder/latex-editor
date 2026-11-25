// „Gehe zu Zeile“: Cursor an Zeile (und Spalte, ab 1; wird auf die Zeilenlänge gekürzt) setzen und zentrieren.
import type { EditorSession } from '../editor/session';

export function gotoLine(session: EditorSession, line: number, column?: number): void {
    session.revealLine(line);
    if (column === undefined) return;
    const doc = session.state.doc;
    const target = doc.lineAt(session.selection.head);
    const position = Math.min(target.from + Math.max(column - 1, 0), target.to);
    session.select({ anchor: position, head: position });
}
