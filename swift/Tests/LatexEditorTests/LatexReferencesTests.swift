import Foundation
import Testing
@testable import LatexEditor

@Suite("Verweise und Zitate im Text")
struct LatexReferencesTests {
    private func scan(_ text: String) -> [(ReferenceOccurrence.Kind, String, String)] {
        let source = text as NSString
        return LatexReferences.scan(text).map { ($0.kind, $0.key, source.substring(with: $0.range)) }
    }

    private func keys(_ text: String) -> [String] { scan(text).map(\.1) }

    @Test("Labels, Verweise und Zitate mit Schlüsselbereich; Listen werden aufgeteilt")
    func basics() {
        let found = scan("\\label{fig:a} siehe \\ref{fig:a} und \\cite[S.~3]{x, y} \\citep{z}")
        #expect(found.map(\.0) == [.labelDefinition, .labelUse, .citation, .citation, .citation])
        #expect(found.map(\.1) == ["fig:a", "fig:a", "x", "y", "z"])
        #expect(found.map(\.2) == found.map(\.1), "der Bereich zeigt genau auf den Schlüssel")
    }

    @Test("Befehle mit Namensüberschneidung treffen genau einmal; Varianten mit Stern und Optionen")
    func commandVariants() {
        #expect(keys("\\citeauthor{a}") == ["a"])
        #expect(keys("\\cite*{a} \\autoref{b} \\Cref{c} \\eqref{d} \\nameref{e}") == ["a", "b", "c", "d", "e"])
        #expect(keys("\\parencite[vgl.][S.~5]{k}") == ["k"])
        #expect(keys("\\hyperref[sec:x]{Text}") == ["sec:x"])
        #expect(keys("\\cref{ a , b }") == ["a", "b"], "Leerzeichen um die Schlüssel zählen nicht")
    }

    @Test("Kommentare, Code, \\verb, Makroparameter und \\nocite{*} fallen weg")
    func ignoredPlaces() {
        #expect(keys("% \\ref{kommentar}\n\\ref{echt}") == ["echt"])
        #expect(keys("50\\% \\ref{nach-prozent}") == ["nach-prozent"], "\\% ist kein Kommentar")
        #expect(keys("\\begin{lstlisting}\n\\ref{code}\n\\end{lstlisting}\\ref{danach}") == ["danach"])
        #expect(keys("\\begin{PythonCode}\\cite{x}\\end{PythonCode}") == [])
        #expect(keys("\\verb|\\ref{v}| \\ref{w}") == ["w"])
        #expect(keys("\\newcommand{\\mein}[1]{\\ref{fig:#1}}") == [])
        #expect(keys("\\nocite{*}") == [])
        #expect(LatexReferences.citesEverything("\\nocite{*}"))
        #expect(!LatexReferences.citesEverything("% \\nocite{*}"))
    }

    @Test("Prüfung: unbekannte Labels und Zitate; ohne Literatur keine Zitatprüfung")
    func checking() {
        let text = "\\label{a}\\ref{a}\\ref{fehlt}\\cite{da,weg}"
        let problems = ReferenceChecker.problems(in: text, labels: ["a"], citations: ["da"])
        #expect(problems.map(\.key) == ["fehlt", "weg"])
        #expect(problems.map(\.kind) == [.unknownLabel, .unknownCitation])
        let source = text as NSString
        #expect(problems.map { source.substring(with: $0.range) } == ["fehlt", "weg"])
        #expect(ReferenceChecker.problems(in: text, labels: ["a"], citations: nil).map(\.key) == ["fehlt"])
        #expect(problems[0].message.contains("fehlt"))
    }

    @Test("Eigene Definition in derselben Datei zählt als bekannt (Labels des Textes kommen vom Aufrufer)")
    func emptySets() {
        #expect(ReferenceChecker.problems(in: "kein Verweis", labels: [], citations: []).isEmpty)
        #expect(ReferenceChecker.problems(in: "\\ref{x}", labels: [], citations: []).count == 1)
    }

    @Test("Literatureinträge kennen Datei und Zeile")
    func bibLines() {
        let text = "% Kopf\n@book{erste,\n  title={A}\n}\n\n@article{zweite,\n title={B}}\n@book{erste, title={doppelt}}\n"
        let file = URL(fileURLWithPath: "/p/lit.bib")
        let entries = ProjectCatalog.bibEntries(in: text, file: file)
        #expect(entries.map(\.key) == ["erste", "zweite", "erste"])
        #expect(entries.map(\.line) == [2, 6, 2], "bei doppeltem Schlüssel gilt die erste Zeile")
        #expect(entries.allSatisfy { $0.file == file })
        #expect(ProjectCatalog.bibEntries(in: text).allSatisfy { $0.file == nil })
    }

    @Test("Der Projektindex merkt sich benutzte Labels und Zitate")
    func indexUsedSets() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "\\ref{a} \\label{a} \\label{b}\n\\input{k}\n% \\ref{kommentar}\n")
        let chapter = try project.write("k.tex", "\\cite{x,y} \\ref{c}\n")
        let index = CompletionIndex.build(files: [main, chapter], styleFiles: [], projectRoot: project.root, mainFile: main)
        #expect(index.usedLabels == ["a", "c"])
        #expect(index.usedCitations == ["x", "y"])
        #expect(!index.citesEverything)
        let nocite = try project.write("n.tex", "\\nocite{*}")
        #expect(CompletionIndex.build(files: [nocite], styleFiles: [], projectRoot: project.root, mainFile: nil).citesEverything)
    }

    /// Bewusst klein: Gesamtläufe teilen sich die Maschine mit zeitempfindlichen Budget-Tests.
    @Test("Schnell genug und linear: 2.000 Zeilen mit Verweisen")
    func performance() {
        let lines = 2_000
        let text = String(repeating: "Siehe \\ref{fig:a} und \\cite{x, y} im Text % Kommentar \\ref{k}\n", count: lines)
        let start = ContinuousClock.now
        let problems = ReferenceChecker.problems(in: text, labels: ["fig:a"], citations: ["x"])
        let elapsed = ContinuousClock.now - start
        #expect(problems.count == lines, "nur „y“ fehlt, in jeder Zeile")
        #expect(elapsed < .seconds(1), "Debug-Build, läuft im Hintergrund")
    }
}
