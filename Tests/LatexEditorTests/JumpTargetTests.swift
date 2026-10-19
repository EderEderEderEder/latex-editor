import Foundation
import Testing
@testable import LatexEditor

@Suite("⌘-Klick: Ziele im Text")
struct JumpTargetTests {
    private func target(_ marked: String) -> (JumpTarget, String)? {
        // `|` markiert die Klickstelle
        let location = (marked as NSString).range(of: "|").location
        let text = marked.replacingOccurrences(of: "|", with: "") as NSString
        return JumpTargetFinder.target(at: location, in: text).map { ($0.target, text.substring(with: $0.range)) }
    }

    @Test("Verweise führen zum Label, Zitate zum Eintrag, Dateipfade zur Datei")
    func targets() {
        #expect(target("Siehe \\ref{fig:a|bc} hier")?.0 == .label("fig:abc"))
        #expect(target("Siehe \\ref{fig:abc|} hier")?.0 == .label("fig:abc"), "auch am rechten Rand des Schlüssels")
        #expect(target("Siehe \\ref{|fig:abc} hier")?.0 == .label("fig:abc"))
        #expect(target("\\cite[S.~3]{eins, zw|ei, drei}")?.0 == .citation("zwei"), "in Listen der Schlüssel unter dem Cursor")
        #expect(target("\\input{kapitel/|eins}")?.0 == .file("kapitel/eins"))
        #expect(target("\\include{zw|ei}")?.0 == .file("zwei"))
        #expect(target("\\subfile{a/b}|")?.0 == nil, "hinter der Klammer ist nichts")
    }

    @Test("Der Bereich zeigt genau auf Schlüssel bzw. Pfad")
    func ranges() {
        #expect(target("\\ref{ab|c}")?.1 == "abc")
        #expect(target("\\cite{a,b|b,c}")?.1 == "bb")
        #expect(target("\\input{kap/e|ins}")?.1 == "kap/eins")
    }

    @Test("Kein Ziel: \\label selbst, Text, Kommentare, Code, anderer Zeilenanteil")
    func noTarget() {
        #expect(target("\\label{fi|g}") == nil)
        #expect(target("Nur Te|xt") == nil)
        #expect(target("% \\ref{ko|mmentar}") == nil)
        #expect(target("\\begin{verbatim}\\ref{co|de}\\end{verbatim}") == nil)
        #expect(target("\\ref{a} und |\\ref{b}") == nil, "zwischen den Befehlen")
        #expect(JumpTargetFinder.target(at: 99, in: "kurz" as NSString) == nil)
        #expect(JumpTargetFinder.target(at: 0, in: "" as NSString) == nil)
    }

    @Test("Mehrzeilig: die richtige Zeile wird untersucht")
    func multiline() {
        #expect(target("Erste \\ref{eins}\nZweite \\ref{zw|ei}\nDritte")?.0 == .label("zwei"))
    }

    @Test("Label an der Stelle: Definition und Verweis, nicht Zitat")
    func labelAt() {
        let text = "\\label{a}\\ref{b}\\cite{c}" as NSString
        #expect(JumpTargetFinder.label(at: 8, in: text) == "a")
        #expect(JumpTargetFinder.label(at: 15, in: text) == "b")
        #expect(JumpTargetFinder.label(at: 24, in: text) == nil)
    }

    @Test("Dateien: relativ zum Ordner, mit und ohne .tex, nie Ordner")
    func resolvingFiles() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("kapitel/eins.tex", "x")
        try project.write("zwei.tex", "x")
        try project.makeDirectory("ordner")
        let bases = [project.root, project.url("kapitel")]
        #expect(JumpTargetFinder.resolveFile("kapitel/eins", bases: bases) == project.url("kapitel/eins.tex"))
        #expect(JumpTargetFinder.resolveFile("zwei.tex", bases: bases) == project.url("zwei.tex"))
        #expect(JumpTargetFinder.resolveFile("eins", bases: bases) == project.url("kapitel/eins.tex"), "zweiter Ordner")
        #expect(JumpTargetFinder.resolveFile("ordner", bases: bases) == nil)
        #expect(JumpTargetFinder.resolveFile("gibtesnicht", bases: bases) == nil)
    }
}

@Suite("Label umbenennen: Logik")
struct LabelRenamerTests {
    @Test("Definition und alle Verweise, aber nur dieses Label und keine Zitate")
    func occurrences() {
        let text = "\\label{a}\\ref{a}\\ref{ab}\\cref{x,a}\\cite{a}\\hyperref[a]{T} % \\ref{a}\n\\begin{verbatim}\\ref{a}\\end{verbatim}"
        let ranges = LabelRenamer.occurrences(of: "a", in: text)
        #expect(ranges.count == 4, "label, ref, cref-Liste, hyperref")
        let source = text as NSString
        #expect(ranges.allSatisfy { source.substring(with: $0) == "a" })
    }

    @Test("Ersetzen von hinten: Längen ändern die Positionen nicht")
    func applying() {
        let text = "\\label{a} \\ref{a} \\cref{x,a}"
        let renamed = LabelRenamer.apply(LabelRenamer.occurrences(of: "a", in: text), newKey: "fig:lang", to: text)
        #expect(renamed == "\\label{fig:lang} \\ref{fig:lang} \\cref{x,fig:lang}")
    }

    @Test("Prüfung des neuen Namens")
    func validation() {
        let existing: Set<String> = ["a", "b"]
        #expect(LabelRenamer.validate("neu", old: "a", existing: existing) == nil)
        #expect(LabelRenamer.validate("fig:neu_1", old: "a", existing: existing) == nil)
        #expect(LabelRenamer.validate("  ", old: "a", existing: existing) != nil)
        #expect(LabelRenamer.validate("a", old: "a", existing: existing) == "Der Name ist unverändert.")
        #expect(LabelRenamer.validate("b", old: "a", existing: existing) == "Ein Label mit diesem Namen gibt es schon.")
        #expect(LabelRenamer.validate("zwei worte", old: "a", existing: existing) != nil)
        #expect(LabelRenamer.validate("a,b", old: "a", existing: existing) != nil)
        #expect(LabelRenamer.validate("x}y", old: "a", existing: existing) != nil)
    }
}
