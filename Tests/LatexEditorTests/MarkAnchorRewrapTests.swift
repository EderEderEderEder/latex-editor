import Foundation
import PDFKit
import Testing
@testable import LatexEditor

/// Der erste Absatz der Einleitung des Demoprojekts samt Umgebung (hier eingebettet), wie in den Drift-Versuchen
private enum DemoParagraph {
    static let heading = ["\\chapter{Einleitung}", "\\label{chap:einleitung}", ""]
    static let paragraph = [
        "Dieses Projekt ist eine \\emph{Demo-Arbeit}. Sie ersetzt die echte Abschlussarbeit bei allen Tests und beim",
        "Entwickeln des Editors. Die Datei \\texttt{hgbthesis.cls} ist eine eigene Nachbildung und enthält nichts aus der",
        "Vorlage der Hochschule.",
    ]
    static let following = [
        "", "\\section{Motivation}", "\\label{sec:motivation}", "",
        "Ein Text mit Zitat \\cite{knuth1984} und Verweis auf Kapitel~\\ref{chap:grundlagen}. Die Abkürzung z.\\,B. und ein",
        "Bindestrich-Wort wie Kompilier-Vorgang zählen für den Wortzähler jeweils als ein Wort.",
    ]
    static let document = heading + paragraph + following
    static let startWords = ["ist", "eine", "demo"]
    static let endWords = ["vorlage", "der", "hochschule"]

    static func with(_ replacement: [String]) -> [String] { heading + replacement + following }

    static func replacing(_ pairs: [(String, String)], in lines: [String] = paragraph) -> [String] {
        lines.map { line in pairs.reduce(line) { $0.replacingOccurrences(of: $1.0, with: $1.1) } }
    }

    /// Wie ein Editor neu umbricht: Wörter auffüllen, bis die nächste Zeile breiter als `width` Zeichen würde
    static func wrap(_ lines: [String], width: Int) -> [String] {
        var result: [String] = []
        var current = ""
        for word in lines.joined(separator: " ").split(separator: " ").map(String.init) {
            if !current.isEmpty, current.count + 1 + word.count > width {
                result.append(current)
                current = word
            } else {
                current = current.isEmpty ? word : current + " " + word
            }
        }
        return current.isEmpty ? result : result + [current]
    }
}

/// PDF und SyncTeX-Abbildung zu einer Fassung, wie ein Neukompilieren sie liefert (ohne LaTeX: 9 Wörter je PDF-Zeile)
@MainActor
private enum RewrapRendering {
    private static let wordsPerRow = 9
    private static let headingRows = 1
    static let heading = ["\\chapter{Einleitung}", ""]

    static func resolver(_ lines: [String]) -> MarkResolver {
        let fixture = fixture(for: lines)
        return MarkResolver(
            root: fixture.root, document: fixture.document, linesOf: { _ in lines },
            forward: fixture.forward, isNewerThanPDF: { _ in false }
        )
    }

    static func makeMark(in lines: [String]) throws -> PDFMark {
        let fixture = fixture(for: lines)
        let selection = try #require(fixture.selection(from: "ist eine Demo", to: "Hochschule."))
        let creator = MarkCreator(root: fixture.root, document: fixture.document, linesOf: { _ in lines },
                                  backward: fixture.backward, forward: fixture.forward)
        return try creator.makeMark(from: selection, color: .yellow)
    }

    private static func fixture(for lines: [String]) -> MarkFixture {
        var rows = [plainWords(lines[0]).joined(separator: " ")]
        var layout: [Int: ClosedRange<Int>] = [1: 0...0]
        var words: [(line: Int, word: String)] = []
        for (index, line) in lines.enumerated().dropFirst() { words += plainWords(line).map { (index + 1, $0) } }
        for (offset, entry) in words.enumerated() {
            let row = headingRows + offset / wordsPerRow
            layout[entry.line] = layout[entry.line].map { $0.lowerBound...row } ?? row...row
        }
        for start in stride(from: 0, to: words.count, by: wordsPerRow) {
            rows.append(words[start..<min(words.count, start + wordsPerRow)].map(\.word).joined(separator: " "))
        }
        return MarkFixture(rows: rows, layout: layout)
    }

    private static func plainWords(_ line: String) -> [String] {
        line.replacingOccurrences(of: #"\\[A-Za-z@]+\*?"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: "[{}]", with: "", options: .regularExpression)
            .split(whereSeparator: \.isWhitespace).map(String.init)
    }
}

/// Eine große Datei: 50 Absätze aus je drei Zeilen mit 16 Wörtern zwischen Fülltext, insgesamt 5.000 Zeilen
private enum SyntheticDocument {
    static let paragraphs = 50
    static let fillerLines = 96
    static let linesPerParagraph = 3
    static let wordsPerLine = 16
    /// Jedes vierte Wort ist „die“: häufige Wörter wie im echten Text
    static let stopWordEvery = 4
    static let storedWords = 3

    /// Der Text und je Absatz die Zeile (1-basiert), in der er beginnt; `halved`: jede Absatzzeile auf zwei umbrochen
    static func make(halved: Bool) -> (lines: [String], starts: [Int]) {
        var lines: [String] = []
        var starts: [Int] = []
        for number in 0..<paragraphs {
            lines += (0..<fillerLines).map { "Die der und das ist ein Fülltext, Zeile \(number)-\($0)." }
            starts.append(lines.count + 1)
            let text = paragraph(number)
            lines += halved ? text.flatMap(halves) : text
            lines.append("")
        }
        return (lines, starts)
    }

    static func paragraph(_ number: Int) -> [String] {
        (0..<linesPerParagraph).map { line in
            (0..<wordsPerLine).map { $0 % stopWordEvery == 0 ? "die" : "w\(number)z\(line)n\($0)" }.joined(separator: " ")
        }
    }

    private static func halves(_ line: String) -> [String] {
        let words = line.split(separator: " ")
        let middle = words.count / 2
        return [words[..<middle].joined(separator: " "), words[middle...].joined(separator: " ")]
    }
}

private func isPlaced(_ resolution: MarkResolution) -> Bool {
    if case .placed = resolution { return true }
    return false
}

@MainActor
@Suite("PDF-Markierungen: Anker über neu umbrochene oder hinten veränderte Zeilen")
struct MarkAnchorRewrapTests {
    /// Großzügig für den Debug-Build unter Last
    private static let performanceBudget = Duration.seconds(10)
    private static let performanceIterations = 3

    private let start = MarkAnchorLocator.anchor(path: "main.tex", line: 4, in: DemoParagraph.document, words: DemoParagraph.startWords)
    private let end = MarkAnchorLocator.anchor(path: "main.tex", line: 6, in: DemoParagraph.document, words: DemoParagraph.endWords)

    private func anchor(line: Int, words: [String]) -> MarkAnchor {
        MarkAnchorLocator.anchor(path: "main.tex", line: line, in: DemoParagraph.document, words: words)
    }

    /// Voraussetzung der Fälle: Keine einzelne Zeile passt, erst der Rückfall findet den Anker
    private func noSingleLineMatches(_ anchor: MarkAnchor, in lines: [String]) -> Bool {
        let wanted = MarkText.words(inSource: anchor.text)
        return lines.allSatisfy {
            MarkAnchorLocator.similarity(wanted, MarkText.words(inSource: $0)) < MarkAnchorLocator.similarityThreshold
        }
    }

    // MARK: Umbruch

    @Test("B1: gleicher Text, auf vier statt drei Zeilen umbrochen")
    func rewrappedToFourLines() {
        let lines = DemoParagraph.with(DemoParagraph.wrap(DemoParagraph.paragraph, width: 70))
        #expect(lines.count == DemoParagraph.document.count + 1)
        #expect(lines[6] == "nichts aus der Vorlage der Hochschule.")
        #expect(noSingleLineMatches(end, in: lines))
        #expect(MarkAnchorLocator.locate(start, in: lines, isStart: true) == 4)
        #expect(MarkAnchorLocator.locate(end, in: lines, isStart: false) == 7)
    }

    @Test("B2: gleicher Text, auf zwei statt drei Zeilen umbrochen")
    func rewrappedToTwoLines() {
        let lines = DemoParagraph.with(DemoParagraph.wrap(DemoParagraph.paragraph, width: 150))
        #expect(lines.count == DemoParagraph.document.count - 1)
        #expect(noSingleLineMatches(end, in: lines))
        #expect(MarkAnchorLocator.locate(start, in: lines, isStart: true) == 4)
        #expect(MarkAnchorLocator.locate(end, in: lines, isStart: false) == 5)
    }

    @Test("Über zwei bzw. drei Zeilen verteilt: Anfang und Ende landen in der Zeile mit den Wörtern der Markierung")
    func spreadOverSeveralLines() {
        let wrapped = DemoParagraph.wrap(DemoParagraph.paragraph, width: 55)
        let lines = DemoParagraph.with(wrapped)
        #expect(wrapped == ["Dieses Projekt ist eine \\emph{Demo-Arbeit}. Sie ersetzt", "die echte Abschlussarbeit bei allen Tests und beim",
                            "Entwickeln des Editors. Die Datei", "\\texttt{hgbthesis.cls} ist eine eigene Nachbildung und",
                            "enthält nichts aus der Vorlage der Hochschule."])
        let middle = anchor(line: 5, words: ["entwickeln", "des", "editors"])
        #expect(noSingleLineMatches(start, in: lines) && noSingleLineMatches(middle, in: lines))

        #expect(MarkAnchorLocator.locate(start, in: lines, isStart: true) == 4)
        let laterStart = anchor(line: 4, words: ["abschlussarbeit", "bei", "allen"])
        #expect(MarkAnchorLocator.locate(laterStart, in: lines, isStart: true) == 5, "Die Anfangswörter stehen jetzt in der zweiten Zeile")
        #expect(MarkAnchorLocator.locate(middle, in: lines, isStart: false) == 6, "Die Markierung endet nach „Editors.“")
        #expect(MarkAnchorLocator.locate(anchor(line: 5, words: ["nichts", "aus", "der"]), in: lines, isStart: false) == 8)
        #expect(MarkAnchorLocator.locate(anchor(line: 5, words: []), in: lines, isStart: false) == 8, "Ohne Wörter: Zeile des letzten Wortes")
    }

    // MARK: Letzte Zeile verändert

    @Test("A3: letztes Wort geändert, die Nachbarzeile davor bestätigt es")
    func lastWordChanged() {
        let lines = DemoParagraph.with(DemoParagraph.replacing([("Vorlage der Hochschule.", "Vorlage der Fachhochschule.")]))
        #expect(noSingleLineMatches(end, in: lines))
        #expect(MarkAnchorLocator.locate(start, in: lines, isStart: true) == 4)
        #expect(MarkAnchorLocator.locate(end, in: lines, isStart: false) == 6)
    }

    @Test("C4: Satz hinten an die letzte Zeile gehängt")
    func sentenceAppended() {
        var paragraph = DemoParagraph.paragraph
        paragraph[2] += " Dies ist ein neu eingefügter Satz."
        let lines = DemoParagraph.with(paragraph)
        #expect(noSingleLineMatches(end, in: lines))
        #expect(MarkAnchorLocator.locate(end, in: lines, isStart: false) == 6)
    }

    // MARK: Keine falschen Treffer

    @Test("D: stark umformuliert bleibt verwaist")
    func rewrittenStaysOrphaned() {
        let lines = DemoParagraph.with([
            "Das vorliegende Beispiel dient als Platzhalter und ersetzt die eigentliche Arbeit bei allen Prüfungen sowie",
            "während der Entwicklung des Programms. Die Datei \\texttt{hgbthesis.cls} stammt aus eigener Feder und enthält keinerlei",
            "Material der Hochschule.",
        ])
        #expect(MarkAnchorLocator.locate(start, in: lines, isStart: true) == nil)
        #expect(MarkAnchorLocator.locate(end, in: lines, isStart: false) == nil)
    }

    @Test("F: gelöschter Absatz bleibt verwaist")
    func deletedStaysOrphaned() {
        let lines = DemoParagraph.with([])
        #expect(MarkAnchorLocator.locate(start, in: lines, isStart: true) == nil)
        #expect(MarkAnchorLocator.locate(end, in: lines, isStart: false) == nil)
    }

    @Test("Kurze Endzeile gelöscht oder umformuliert: verwaist, auch wenn ihre Wörter in der Nähe am Stück stehen")
    func shortLineStaysOrphaned() {
        let original = ["\\section{Ziel}", "", "Dieser Abschnitt beschreibt das Ziel", "der Arbeit.", "",
                        "Die Gliederung der Arbeit folgt dem Ablauf der Untersuchung."]
        let short = MarkAnchorLocator.anchor(path: "main.tex", line: 4, in: original, words: ["der", "arbeit"])
        var deleted = original
        deleted.remove(at: 3)
        var rewritten = original
        rewritten[3] = "des vorliegenden Projekts."
        #expect(deleted.last?.contains("der Arbeit") == true)
        for lines in [deleted, rewritten] {
            #expect(MarkAnchorLocator.locate(short, in: lines, isStart: false) == nil, "\(lines)")
            #expect(MarkAnchorLocator.locate(short, in: lines, isStart: true) == nil, "\(lines)")
        }
    }

    @Test("Listen- und Tabellenzeilen mit zwei Wörtern: geändert, werden sie keiner fremden Stelle zugeordnet")
    func shortListAndTableLinesStayOrphaned() {
        let original = ["\\begin{itemize}", "\\item die Daten", "\\item die Methode", "\\end{itemize}", "",
                        "\\begin{tabular}{ll}", "a & b \\\\", "1 & 2 \\\\", "\\end{tabular}", "",
                        "Wir beschreiben die Daten im nächsten Abschnitt, die Werte 1 2 und 3 stehen in der Tabelle."]
        let item = MarkAnchorLocator.anchor(path: "main.tex", line: 2, in: original, words: ["die", "daten"])
        let row = MarkAnchorLocator.anchor(path: "main.tex", line: 8, in: original, words: ["1", "2"])
        var changed = original
        changed[1] = "\\item die Messwerte"
        changed[7] = "3 & 4 \\\\"
        #expect(MarkAnchorLocator.locate(item, in: changed, isStart: false) == nil)
        #expect(MarkAnchorLocator.locate(row, in: changed, isStart: false) == nil)
        #expect(MarkAnchorLocator.locate(item, in: original, isStart: false) == 2, "Unverändert: gefunden")
    }

    @Test("G1/G2: Neben einer überarbeiteten Kopie bleibt der Anker am unveränderten Original")
    func copyNextToOriginal() {
        let revised = DemoParagraph.replacing([("echte Abschlussarbeit", "richtige Bachelorarbeit"), ("eigene", "eigenständige")])
        let copyAfter = DemoParagraph.with(DemoParagraph.paragraph + [""] + revised)
        #expect(MarkAnchorLocator.locate(start, in: copyAfter, isStart: true) == 4)
        #expect(MarkAnchorLocator.locate(end, in: copyAfter, isStart: false) == 6)
        let copyBefore = DemoParagraph.with(revised + [""] + DemoParagraph.paragraph)
        #expect(MarkAnchorLocator.locate(start, in: copyBefore, isStart: true) == 8)
        #expect(MarkAnchorLocator.locate(end, in: copyBefore, isStart: false) == 10)
    }

    // MARK: Zuordnen und Auffrischen

    @Test("Umbrochen: zugeordnet, und das Auffrischen setzt den Endanker auf die neue Zeile samt Nachbarn")
    func refreshAfterRewrap() throws {
        let mark = try RewrapRendering.makeMark(in: RewrapRendering.heading + DemoParagraph.paragraph)
        #expect(mark.start.line == 3 && mark.end.line == 5)
        let wrapped = DemoParagraph.wrap(DemoParagraph.paragraph, width: 70)
        let resolver = RewrapRendering.resolver(RewrapRendering.heading + wrapped)
        let fresh = resolver.resolve(mark)
        #expect(isPlaced(fresh))

        let renewed = try #require(resolver.refreshedAnchors(of: mark, after: fresh))
        #expect(renewed.start.line == 3 && renewed.start.text == wrapped[0] && renewed.start.after == wrapped[1])
        #expect(renewed.end.line == 6 && renewed.end.text == wrapped[3])
        #expect(renewed.end.before == wrapped[2] && renewed.end.after == "")
        #expect(renewed.start.words == mark.start.words && renewed.end.words == mark.end.words, "Die Wörter bleiben")

        let again = RewrapRendering.resolver(RewrapRendering.heading + wrapped)
        let second = again.resolve(renewed)
        #expect(isPlaced(second))
        #expect(again.refreshedAnchors(of: renewed, after: second) == nil, "Danach passt der Anker genau")
    }

    @Test("Ein gemerkter späterer Treffer fällt nach dem Rückfall weg, bei nur verschobener Zeile bleibt er")
    func refreshResetsOccurrenceAfterRewrap() throws {
        var mark = try RewrapRendering.makeMark(in: RewrapRendering.heading + DemoParagraph.paragraph)
        mark.end.matchedWords = 2
        mark.end.occurrence = 1

        let wrapped = RewrapRendering.resolver(RewrapRendering.heading + DemoParagraph.wrap(DemoParagraph.paragraph, width: 70))
        let rewrapped = try #require(wrapped.refreshedAnchors(of: mark, after: wrapped.resolve(mark)))
        #expect(rewrapped.end.line == 6)
        #expect(rewrapped.end.occurrence == nil && rewrapped.end.matchedWords == nil, "Rückfall: Treffer neu aus dem PDF")
        #expect(rewrapped.start.occurrence == mark.start.occurrence && rewrapped.start.matchedWords == mark.start.matchedWords)

        let shifted = RewrapRendering.resolver(RewrapRendering.heading + ["Ein Satz davor.", ""] + DemoParagraph.paragraph)
        let moved = try #require(shifted.refreshedAnchors(of: mark, after: shifted.resolve(mark)))
        #expect(moved.end.line == mark.end.line + 2)
        #expect(moved.end.occurrence == 1 && moved.end.matchedWords == 2, "Gleiche Zeile, nur verschoben: Treffer bleibt")
    }

    @Test("Zwei Zeilen statt drei, letztes Wort geändert, Satz angehängt: die Markierung bleibt zugeordnet")
    func resolvesAfterLastLineChanges() throws {
        let mark = try RewrapRendering.makeMark(in: RewrapRendering.heading + DemoParagraph.paragraph)
        var appended = DemoParagraph.paragraph
        appended[2] += " Dies ist ein neu eingefügter Satz."
        let variants = [
            DemoParagraph.wrap(DemoParagraph.paragraph, width: 150),
            DemoParagraph.replacing([("Vorlage der Hochschule.", "Vorlage der Fachhochschule.")]),
            appended,
        ]
        for paragraph in variants {
            #expect(isPlaced(RewrapRendering.resolver(RewrapRendering.heading + paragraph).resolve(mark)), "\(paragraph)")
        }
    }

    // MARK: Rechenzeit

    private typealias SyntheticAnchor = (anchor: MarkAnchor, isStart: Bool, expected: Int)

    /// Je Absatz ein Anfangs- und ein Endanker auf dem Original, gesucht in der umbrochenen Fassung
    private static func syntheticAnchors() -> (lines: [String], anchors: [SyntheticAnchor]) {
        let original = SyntheticDocument.make(halved: false)
        let rewrapped = SyntheticDocument.make(halved: true)
        #expect(original.lines.count == 5_000)
        var anchors: [SyntheticAnchor] = []
        for number in 0..<SyntheticDocument.paragraphs {
            let words = SyntheticDocument.paragraph(number).map { MarkText.words(inSource: $0) }
            let first = original.starts[number]
            let last = first + SyntheticDocument.linesPerParagraph - 1
            let newFirst = rewrapped.starts[number]
            anchors.append((MarkAnchorLocator.anchor(path: "x.tex", line: first, in: original.lines,
                                                     words: Array(words[0].prefix(SyntheticDocument.storedWords))), true, newFirst))
            anchors.append((MarkAnchorLocator.anchor(path: "x.tex", line: last, in: original.lines,
                                                     words: Array(words[2].suffix(SyntheticDocument.storedWords))), false,
                            newFirst + 2 * SyntheticDocument.linesPerParagraph - 1))
        }
        return (rewrapped.lines, anchors)
    }

    @Test("5.000 Zeilen, 50 umbrochene Markierungen: alle Anker gefunden, in vertretbarer Zeit")
    func rewrapPerformance() {
        let (lines, anchors) = Self.syntheticAnchors()
        var found: [Int?] = []
        // Je Lauf neu zerlegt: Mit den gemerkten Wörtern des ersten Laufs wären die weiteren billiger
        let duration = fastestDuration(iterations: Self.performanceIterations) {
            let source = MarkSourceLines(lines)
            found = anchors.map { MarkAnchorLocator.locate($0.anchor, in: source, isStart: $0.isStart) }
        }
        #expect(found == anchors.map { Int?($0.expected) })
        #expect(duration < Self.performanceBudget, "\(duration)")
    }
}
