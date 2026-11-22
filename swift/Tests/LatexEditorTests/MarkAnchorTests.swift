import Foundation
import Testing
@testable import LatexEditor

@Suite("PDF-Markierungen: Anker im Quelltext")
struct MarkAnchorTests {
    private let document = [
        "\\section{Einleitung}",
        "",
        "Das Qubit ist die kleinste Einheit der Quanteninformation.",
        "Ein Bit kennt nur null oder eins.",
        "",
        "\\begin{equation}",
        "  a = 1",
        "\\end{equation}",
    ]

    private func anchor(line: Int, words: [String] = []) -> MarkAnchor {
        MarkAnchorLocator.anchor(path: "main.tex", line: line, in: document, words: words)
    }

    @Test("Der Anker merkt sich die Zeile mit Nachbarzeilen, ohne Einrückung")
    func capturesContext() {
        let anchor = anchor(line: 7)
        #expect(anchor.text == "a = 1")
        #expect(anchor.before == "\\begin{equation}")
        #expect(anchor.after == "\\end{equation}")
        #expect(self.anchor(line: 1).before == "", "Dateianfang")
    }

    @Test("Verrutschte Zeilen werden über ihren Text gefunden")
    func movedLine() {
        let anchor = anchor(line: 3)
        let shifted = ["% neu", "% neu 2"] + document
        #expect(MarkAnchorLocator.locate(anchor, in: shifted) == 5)
        let fewer = Array(document.dropFirst(2))
        #expect(MarkAnchorLocator.locate(anchor, in: fewer) == 1)
        #expect(MarkAnchorLocator.locate(anchor, in: document) == 3)
    }

    @Test("Doppelte Zeilen: die mit passenden Nachbarzeilen gewinnt, sonst die näher an der alten Stelle")
    func duplicateLines() {
        let lines = ["Gleich.", "A", "Gleich.", "B", "Gleich.", "C"]
        let anchor = MarkAnchorLocator.anchor(path: "x.tex", line: 5, in: lines, words: [])
        #expect(MarkAnchorLocator.locate(anchor, in: lines) == 5)
        let moved = ["neu"] + lines
        #expect(MarkAnchorLocator.locate(anchor, in: moved) == 6, "Nachbarzeile B und C bestätigen es")

        let plain = MarkAnchor(path: "x.tex", line: 4, text: "Gleich.", before: "?", after: "?", words: [])
        #expect(MarkAnchorLocator.locate(plain, in: lines) == 3, "Ohne Kontext die nächste zur alten Zeile")
    }

    @Test("Eine leicht veränderte Zeile wird noch erkannt, eine ganz andere nicht")
    func editedLine() {
        let anchor = anchor(line: 3)
        var edited = document
        edited[2] = "Das Qubit ist die \\emph{kleinste} Einheit der Quanteninformation überhaupt."
        #expect(MarkAnchorLocator.locate(anchor, in: edited) == 3)
        edited[2] = "Etwas völlig anderes steht hier."
        #expect(MarkAnchorLocator.locate(anchor, in: edited) == nil)
    }

    @Test("Eine Zeile mit nur einem Wort wird nicht geraten")
    func shortLinesAreNotGuessed() {
        let anchor = MarkAnchor(path: "x.tex", line: 1, text: "\\section{Einleitung}", before: "", after: "", words: [])
        #expect(MarkAnchorLocator.locate(anchor, in: ["\\section{Ausblick}"]) == nil)
        #expect(MarkAnchorLocator.locate(anchor, in: []) == nil)
    }

    @Test("Beim Anlegen gewinnt die Zeile im Umkreis, die die Wörter besser enthält")
    func bestLineNearSyncTeXLine() {
        let words = ["kleinste", "einheit"]
        #expect(MarkAnchorLocator.bestLine(near: 4, containing: words, in: document) == 3)
        #expect(MarkAnchorLocator.bestLine(near: 3, containing: words, in: document) == 3)
        #expect(MarkAnchorLocator.bestLine(near: 7, containing: ["gibtesnicht"], in: document) == 7, "Nichts passt: bleibt")
        #expect(MarkAnchorLocator.bestLine(near: 3, containing: [], in: document) == 3)
    }

    @Test("Wörter: ohne Befehle und Kommentar, kleingeschrieben, Ligaturen aufgelöst")
    func words() {
        #expect(MarkText.words(inSource: "Das \\emph{Qubit}~ist \\ref{fig:a} klein. % Kommentar") == ["das", "qubit", "ist", "fig", "a", "klein"])
        #expect(MarkText.tokens(in: "ﬁnale Größe, 3x").map(\.text) == ["finale", "größe", "3x"])
        #expect(MarkText.tokens(in: "Quantencom-puting").map(\.text) == ["quantencom", "puting"])
        #expect(MarkText.tokens(in: "ab cd").map(\.range) == [NSRange(location: 0, length: 2), NSRange(location: 3, length: 2)])
    }

    @Test("Ähnlichkeit der Wortfolgen")
    func similarity() {
        #expect(MarkAnchorLocator.similarity(["a", "b"], ["a", "b"]) == 1)
        #expect(MarkAnchorLocator.similarity(["a", "b"], ["c", "d"]) == 0)
        #expect(MarkAnchorLocator.similarity([], ["a"]) == 0)
        #expect(MarkAnchorLocator.similarity(["a", "b", "c", "d"], ["a", "b", "c"]) > MarkAnchorLocator.similarityThreshold)
    }
}
