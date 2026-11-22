import Foundation
import Testing
@testable import LatexEditor

/// Text mit `|` (Cursor) oder `«…»` (Auswahl) → Text und Auswahl
private func parse(_ marked: String) -> (NSString, NSRange) {
    let text = marked as NSString
    let start = text.range(of: "«")
    if start.location != NSNotFound {
        let end = text.range(of: "»")
        let plain = marked.replacingOccurrences(of: "«", with: "").replacingOccurrences(of: "»", with: "")
        return (plain as NSString, NSRange(location: start.location, length: end.location - start.location - 1))
    }
    let cursor = text.range(of: "|").location
    return (marked.replacingOccurrences(of: "|", with: "") as NSString, NSRange(location: cursor, length: 0))
}

/// Wendet die Bearbeitung an und schreibt die Auswahl wieder als Markierung in den Text.
private func render(_ edit: TextEdit?, on text: NSString) -> String? {
    guard let edit else { return nil }
    let result = NSMutableString(string: text)
    result.replaceCharacters(in: edit.range, with: edit.text)
    if edit.selection.length == 0 {
        result.insert("|", at: edit.selection.location)
    } else {
        result.insert("»", at: NSMaxRange(edit.selection))
        result.insert("«", at: edit.selection.location)
    }
    return result as String
}

private func apply(_ operation: (NSString, NSRange) -> TextEdit?, to marked: String) -> String? {
    let (text, selection) = parse(marked)
    return render(operation(text, selection), on: text)
}

@Suite("Tippen: Klammern")
struct BracketTests {
    private func type(_ character: String, _ marked: String) -> String? {
        apply({ TextEditing.typed(character, in: $0, selection: $1) }, to: marked)
    }

    @Test("Paar einfügen vor Leerraum, Zeilenende und schließenden Zeichen, nicht vor Wörtern")
    func pairs() {
        #expect(type("{", "\\section|") == "\\section{|}")
        #expect(type("[", "a| b") == "a[|] b")
        #expect(type("(", "(a|)") == "(a(|))")
        #expect(type("{", "a|wort") == nil)
        #expect(type("{", "\\|") == nil, "\\{ ist eine wörtliche Klammer")
    }

    @Test("Schließende Klammer überspringen; $ öffnet nur, wenn die Formel noch nicht offen ist")
    func overtypeAndDollar() {
        #expect(type("}", "\\emph{x|}") == "\\emph{x}|")
        #expect(type("$", "Text |") == "Text $|$")
        #expect(type("$", "$x|$") == "$x$|")
        #expect(type("$", "$x |") == nil, "Schließt die offene Formel")
        #expect(type("$", "50\\$ und |") == "50\\$ und $|$", "Maskiertes \\$ zählt nicht")
    }

    @Test("Auswahl wird umschlossen und bleibt ausgewählt")
    func wrapSelection() {
        #expect(type("{", "a «wort» b") == "a {«wort»} b")
        #expect(type("$", "«x^2»") == "$«x^2»$")
        #expect(type("a", "«x»") == nil)
    }

    @Test("Rückschritt in einem leeren Paar löscht beide Zeichen")
    func deletePair() {
        #expect(apply({ TextEditing.deleteBackward(in: $0, selection: $1) }, to: "\\emph{|}") == "\\emph|")
        #expect(apply({ TextEditing.deleteBackward(in: $0, selection: $1) }, to: "{a|}") == nil)
        #expect(apply({ TextEditing.deleteBackward(in: $0, selection: $1) }, to: "\\{|}") == nil)
    }
}

@Suite("Tippen: Zeilenumbruch")
struct NewlineTests {
    private func enter(_ marked: String) -> String? {
        apply({ TextEditing.newline(in: $0, selection: $1) }, to: marked)
    }

    @Test("Einrückung bleibt erhalten")
    func keepsIndent() {
        #expect(enter("\t\tText|") == "\t\tText\n\t\t|")
        #expect(enter("Text|danach") == "Text\n|danach")
    }

    @Test("Nach \\begin{x} kommt \\end{x} dazu, Listen mit \\item; nicht, wenn schon geschlossen")
    func environments() {
        #expect(enter("\t\\begin{figure}[H]|") == "\t\\begin{figure}[H]\n\t\t|\n\t\\end{figure}")
        #expect(enter("\\begin{itemize}|") == "\\begin{itemize}\n\t\\item |\n\\end{itemize}")
        #expect(enter("\\begin{tabular}{lr}|") == "\\begin{tabular}{lr}\n\t|\n\\end{tabular}")
        #expect(enter("\\begin{itemize}|\n\t\\item a\n\\end{itemize}") == "\\begin{itemize}\n|\n\t\\item a\n\\end{itemize}")
        #expect(enter("\\begin{x}|\\begin{x}\\end{x}") == "\\begin{x}\n|\\begin{x}\\end{x}", "Text rechts vom Cursor: kein Gerüst")
    }

    @Test("Listen: neuer Punkt nach \\item mit Text, leerer Punkt beendet die Liste")
    func listItems() {
        #expect(enter("\t\\item Erster|") == "\t\\item Erster\n\t\\item |")
        #expect(enter("\t\\item |") == "\t|")
        #expect(enter("\t\\itemize|") == "\t\\itemize\n\t|")
    }
}

@Suite("Tippen: Zeilenbefehle")
struct LineCommandTests {
    @Test("Kommentar ein und aus, bei der kleinsten Einrückung; Cursor bleibt in der Zeile")
    func comments() {
        let toggle = { (marked: String) in apply({ TextEditing.toggleComment(in: $0, selection: $1) }, to: marked) }
        #expect(toggle("\tTe|xt") == "\t% Te|xt")
        #expect(toggle("\t% Te|xt") == "\tTe|xt")
        #expect(toggle("«\ta\n\t\tb\n\n\tc»\nd") == "«\t% a\n\t% \tb\n\n\t% c»\nd")
        #expect(toggle("«% a\n%b»") == "«a\nb»")
        #expect(toggle("«% a\nb»") == "«% % a\n% b»", "Gemischt: alles auskommentieren")
    }

    @Test("Einrücken und Ausrücken; leere Zeilen bleiben leer; vier Leerzeichen zählen wie ein Tab")
    func indentation() {
        #expect(apply({ TextEditing.indent(in: $0, selection: $1) }, to: "«a\n\nb»") == "«\ta\n\n\tb»")
        #expect(apply({ TextEditing.indent(in: $0, selection: $1) }, to: "a|b") == "\ta|b")
        #expect(apply({ TextEditing.outdent(in: $0, selection: $1) }, to: "«\ta\n    b\n  c»") == "«a\nb\nc»")
        #expect(apply({ TextEditing.outdent(in: $0, selection: $1) }, to: "\tab|") == "ab|")
    }

    @Test("Auswahl bis genau an einen Zeilenanfang nimmt die nächste Zeile nicht mit")
    func blockEndsAtLineStart() {
        #expect(apply({ TextEditing.indent(in: $0, selection: $1) }, to: "«a\n»b") == "«\ta»\nb")
    }

    @Test("Zeilen verschieben, auch am Dateiende ohne Umbruch; am Rand nichts")
    func moveLines() {
        let up = { (marked: String) in apply({ TextEditing.moveLines(up: true, in: $0, selection: $1) }, to: marked) }
        let down = { (marked: String) in apply({ TextEditing.moveLines(up: false, in: $0, selection: $1) }, to: marked) }
        #expect(up("a\nb|b\nc\n") == "bb\na\nc\n".replacingOccurrences(of: "bb", with: "b|b"))
        #expect(down("a|a\nb\nc") == "b\na|a\nc")
        #expect(down("a\nb|b\nc") == "a\nc\nb|b")
        #expect(up("a\nc|") == "c|\na")
        #expect(up("a|\nb") == nil)
        #expect(down("a\nb|") == nil)
        #expect(down("«a\nb»\nc\n") == "c\n«a\nb»\n")
    }

    @Test("Zeile verdoppeln und löschen")
    func duplicateAndDelete() {
        #expect(apply({ TextEditing.duplicateLines(in: $0, selection: $1) }, to: "a|b\nc") == "ab\na|b\nc")
        #expect(apply({ TextEditing.duplicateLines(in: $0, selection: $1) }, to: "a\nb|") == "a\nb\nb|")
        #expect(apply({ TextEditing.deleteLines(in: $0, selection: $1) }, to: "a\nb|\nc") == "a\n|c")
        #expect(apply({ TextEditing.deleteLines(in: $0, selection: $1) }, to: "a\nb|") == "a|")
    }

    @Test("Formatierung: umschließen, ohne Auswahl leere Klammern, nochmal entfernt sie wieder")
    func formatting() {
        let bold = { (marked: String) in apply({ TextEditing.wrap("textbf", in: $0, selection: $1) }, to: marked) }
        #expect(bold("ein «wichtiges» Wort") == "ein \\textbf{«wichtiges»} Wort")
        #expect(bold("ein \\textbf{«wichtiges»} Wort") == "ein «wichtiges» Wort")
        #expect(bold("a | b") == "a \\textbf{|} b")
    }
}
