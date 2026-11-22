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
