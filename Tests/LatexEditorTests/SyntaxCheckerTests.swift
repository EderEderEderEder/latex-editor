import Foundation
import Testing
@testable import LatexEditor

@Suite("Syntaxprüfung: Klammern, Umgebungen, Formeln")
struct SyntaxCheckerTests {
    private func marks(_ text: String) -> [TextMark] {
        SyntaxChecker.marks(masked: LatexMasking.scannable(text) as NSString)
    }

    private func found(_ text: String, _ needle: String, in marks: [TextMark]) -> Bool {
        marks.contains { (text as NSString).substring(with: $0.range) == needle }
    }

    @Test("Korrekter Text hat keine Markierung")
    func cleanText() {
        let text = "\\begin{document}\n\\section{Titel}\nEin $x^2$ und \\(y\\) sowie \\[ z \\] und $$a$$.\n\\begin{itemize}\\item \\{ok\\}\\end{itemize}\n\\end{document}\n"
        #expect(marks(text).isEmpty)
    }

    @Test("Überzählige und fehlende Klammern")
    func braces() {
        let text = "\\textbf{a}}\n\\emph{b\n"
        let result = marks(text)
        #expect(result.count == 2)
        #expect(result.allSatisfy { $0.severity == .error })
        #expect(result[0].range.location == 10)
        #expect(found(text, "{b", in: result), "das folgende Wort gehört zur Markierung")
    }

    @Test("Maskierte Klammern, Kommentare und Code zählen nicht")
    func ignoredBraces() {
        let text = "\\{ \\} % { offen\n\\begin{verbatim}\n{ } }\n\\end{verbatim}\n\\verb|{|\n"
        #expect(marks(text).isEmpty)
    }

    @Test("Umgebung ohne Ende, Ende ohne Anfang, falsch verschachtelt")
    func environments() {
        #expect(found("\\begin{figure}\nx\n", "\\begin{figure}", in: marks("\\begin{figure}\nx\n")))
        #expect(found("x\\end{table}", "\\end{table}", in: marks("x\\end{table}")))
        let nested = "\\begin{a}\\begin{b}\\end{a}"
        let result = marks(nested)
        #expect(result.count == 1)
        #expect(found(nested, "\\begin{b}", in: result))
        #expect(result[0].message.contains("Zeile 1"))
    }

    @Test("Definitionen dürfen ein einzelnes \\begin oder \\end enthalten")
    func definitions() {
        let text = "\\newenvironment{box}{\\begin{center}}{\\end{center}}\n\\newcommand{\\bi}{\\begin{itemize}}\n\\def\\x{\\end{x}}\n"
        #expect(marks(text).isEmpty)
    }

    @Test("Formeln: offenes $ am Absatzende und am Dateiende")
    func mathDollar() {
        let text = "Ein $x ist\n\nNeuer Absatz $y$.\n"
        let result = marks(text)
        #expect(result.count == 1)
        #expect(found(text, "$x", in: result))
        #expect(result[0].range.location == 4)
        #expect(marks("Ende $x").count == 1)
    }

    @Test("Maskiertes $ und \\) ohne \\(")
    func escapedDollar() {
        #expect(marks("Preis 5\\$ und 6\\$.").isEmpty)
        let text = "a \\) b"
        #expect(found(text, "\\)", in: marks(text)))
    }

    @Test("\\\\[2mm] ist kein Formelanfang")
    func lineBreakWithOption() {
        #expect(marks("a\\\\[2mm]\nb\n\nc").isEmpty)
    }

    @Test("Höchstens 200 Markierungen")
    func capped() {
        #expect(marks(String(repeating: "}", count: 500)).count == SyntaxChecker.maximumCount)
    }
}

@Suite("Doppelte Labels und Markierungen im Text", .serialized)
@MainActor
struct DiagnosticsTests {
    private func session(_ text: String, name: String = "kapitel.tex") -> DocumentSession {
        DocumentSession(url: URL(fileURLWithPath: "/tmp/\(name)"), text: text)
    }

    @Test("Doppelte Labels: beide Stellen warnen, Meldung nennt die andere")
    func duplicateLabelMarks() {
        let a = URL(fileURLWithPath: "/tmp/a.tex")
        let b = URL(fileURLWithPath: "/tmp/b.tex")
        let labels = [LabelEntry(label: "x", file: a, line: 1), LabelEntry(label: "x", file: b, line: 7), LabelEntry(label: "y", file: a, line: 2)]
        let duplicates = DuplicateLabelChecker.duplicates(in: labels)
        #expect(Array(duplicates.keys) == ["x"])
        let text = "\\label{x}\n\\label{y}\n"
        let marks = DuplicateLabelChecker.marks(masked: text as NSString, file: a, duplicates: duplicates)
        #expect(marks.count == 1)
        #expect(marks[0].severity == .warning)
        #expect((text as NSString).substring(with: marks[0].range) == "x")
        #expect(marks[0].message.contains("b.tex, Zeile 7"))
    }

    @Test("Zwei Labels derselben Datei verweisen aufeinander")
    func duplicateInSameFile() {
        let a = URL(fileURLWithPath: "/tmp/a.tex")
        let duplicates = DuplicateLabelChecker.duplicates(in: [LabelEntry(label: "x", file: a, line: 1), LabelEntry(label: "x", file: a, line: 3)])
        let marks = DuplicateLabelChecker.marks(masked: "\\label{x}\n\n\\label{x}" as NSString, file: a, duplicates: duplicates)
        #expect(marks.map(\.message).map { $0.contains("Zeile 3") ? 3 : $0.contains("Zeile 1") ? 1 : 0 } == [3, 1])
    }

    @Test("Store: Syntaxfehler und doppelte Labels pro Datei, auch ohne gelesenen Index")
    func storeDiagnostics() async {
        let store = ReferenceCheckStore()
        store.knownLabels = { nil }
        let tex = session("\\textbf{a\n")
        store.schedule(tex, immediately: true)
        await store.waitUntilIdle()
        #expect(store.diagnostics(for: tex.url).count == 1)

        let file = tex.url
        store.duplicateLabelDefinitions = { ["l": [LabelEntry(label: "l", file: file, line: 1), LabelEntry(label: "l", file: file, line: 2)]] }
        let labelled = session("\\label{l}\n\\label{l}\n", name: "zwei.tex")
        store.schedule(labelled, immediately: true)
        await store.waitUntilIdle()
        #expect(store.diagnostics(for: labelled.url).count == 2, "beide Stellen sind andere als die der Einträge")
        store.retain([])
        #expect(store.diagnostics(for: tex.url).isEmpty)
    }

    @Test("Sidebar-Liste: mehrfach definierte Labels aus dem Index")
    func duplicateList() {
        let store = ReferenceCheckStore()
        let file = URL(fileURLWithPath: "/p/a.tex")
        var index = CompletionIndex()
        index.catalog.labels = [LabelEntry(label: "d", file: file, line: 1), LabelEntry(label: "d", file: file, line: 5), LabelEntry(label: "e", file: file, line: 2)]
        store.indexChanged(index, isLoaded: true, openSessions: [])
        #expect(store.duplicateLabels.map(\.line) == [1, 5])
        store.indexChanged(index, isLoaded: false, openSessions: [])
        #expect(store.duplicateLabels.isEmpty)
    }
}
