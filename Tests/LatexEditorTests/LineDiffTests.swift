import Foundation
import Testing
@testable import LatexEditor

@Suite("LineDiff")
struct LineDiffTests {
    private func render(_ lines: [DiffLine]) -> [String] {
        lines.map { line in
            switch line.kind {
            case .context: " " + line.text
            case .removed: "-" + line.text
            case .added: "+" + line.text
            }
        }
    }

    /// Alter und neuer Text aus den Diff-Zeilen (ohne abschließenden Zeilenumbruch).
    private func reconstruct(_ lines: [DiffLine]) -> (old: [String], new: [String]) {
        (lines.filter { $0.kind != .added }.map(\.text), lines.filter { $0.kind != .removed }.map(\.text))
    }

    @Test("Geänderte Zeile in der Mitte: entfernt vor hinzugefügt, Nummern stimmen")
    func changedLine() {
        let lines = LineDiff.compute(old: "a\nb\nc\n", new: "a\nB\nc\n")

        #expect(render(lines) == [" a", "-b", "+B", " c"])
        #expect(lines.map(\.oldNumber) == [1, 2, nil, 3])
        #expect(lines.map(\.newNumber) == [1, nil, 2, 3])
    }

    @Test("Neue und gelöschte Dateien, leere Texte")
    func emptySides() {
        #expect(render(LineDiff.compute(old: "", new: "x\ny")) == ["+x", "+y"])
        #expect(render(LineDiff.compute(old: "x\n", new: "")) == ["-x"])
        #expect(LineDiff.compute(old: "", new: "").isEmpty)
    }

    @Test("Zeilenumbrüche: abschließender Umbruch erzeugt keine Leerzeile, \\r\\n wie \\n")
    func lineSplitting() {
        #expect(LineDiff.splitLines("a\nb\n") == ["a", "b"])
        #expect(LineDiff.splitLines("a\n\n") == ["a", ""])
        #expect(LineDiff.splitLines("a\r\nb") == ["a", "b"])
        #expect(render(LineDiff.compute(old: "a\r\nb\r\n", new: "a\nb\n")) == [" a", " b"])
    }

    @Test("Verschobene Zeile wird als ein Entfernen und ein Einfügen erkannt")
    func movedLine() {
        let lines = LineDiff.compute(old: "1\n2\n3\n4\n5", new: "2\n3\n4\n5\n1")

        #expect(lines.count { $0.kind == .removed } == 1)
        #expect(lines.count { $0.kind == .added } == 1)
        #expect(lines.count { $0.kind == .context } == 4)
    }

    @Test("Wort-Hervorhebung: nur das geänderte Wort, LaTeX-Befehle als ein Token")
    func wordHighlighting() {
        let lines = LineDiff.compute(
            old: "\\section{Einleitung} Das ist ein Satz.",
            new: "\\subsection{Einleitung} Das ist ein langer Satz."
        )

        #expect(lines[0].segments.filter(\.isChanged).map(\.text) == ["\\section"])
        let addedChanges = lines[1].segments.filter(\.isChanged).map { $0.text.trimmingCharacters(in: .whitespaces) }
        #expect(addedChanges == ["\\subsection", "langer"])
        #expect(lines.map(\.text) == ["\\section{Einleitung} Das ist ein Satz.", "\\subsection{Einleitung} Das ist ein langer Satz."])
    }

    @Test("Völlig verschiedene Zeilen bekommen keine Wort-Hervorhebung")
    func dissimilarLines() {
        let lines = LineDiff.compute(old: "Alpha Beta Gamma", new: "\\begin{figure}[htbp]")

        #expect(lines.allSatisfy { $0.segments.count == 1 && !$0.segments[0].isChanged })
    }

    @Test("Tokenizer: Wörter mit Umlauten, Befehle, Leerraum, Satzzeichen")
    func tokenizer() {
        #expect(LineDiff.tokenize("Größe \\emph{x}, 12a") == ["Größe", " ", "\\emph", "{", "x", "}", ",", " ", "12a"])
        #expect(LineDiff.tokenize("\\\\ \\%") == ["\\", "\\", " ", "\\", "%"])
    }

    @Test("Zufallsabgleich: Der Diff ergibt alten und neuen Text exakt und ist minimal", arguments: 0..<4)
    func randomEditsReconstruct(seed: Int) {
        var generator = SeededGenerator(seed: UInt64(seed + 1))
        let alphabet = ["a", "b", "c", "\\item x", "", "Satz eins.", "Satz zwei."]
        for _ in 0..<150 {
            let old = (0..<Int.random(in: 0...30, using: &generator)).map { _ in alphabet.randomElement(using: &generator)! }
            var new = old
            for _ in 0..<Int.random(in: 0...8, using: &generator) {
                mutate(&new, alphabet: alphabet, using: &generator)
            }
            let lines = LineDiff.compute(old: old.joined(separator: "\n"), new: new.joined(separator: "\n"))
            let rebuilt = reconstruct(lines)

            #expect(rebuilt.old == LineDiff.splitLines(old.joined(separator: "\n")))
            #expect(rebuilt.new == LineDiff.splitLines(new.joined(separator: "\n")))
            let contextCount = lines.count { $0.kind == .context }
            #expect(contextCount == longestCommonSubsequence(LineDiff.splitLines(old.joined(separator: "\n")),
                                                             LineDiff.splitLines(new.joined(separator: "\n"))))
        }
    }

    @Test("Über der Grenze für Bearbeitungsschritte: korrekt, nur nicht minimal")
    func editLimitFallsBackToReplacement() {
        let old = (0..<50).map { "z\($0 % 5)" }
        let new = (0..<50).map { "z\(($0 + 2) % 5)" }.reversed().map { $0 }
        let script = LineDiff.editScript(old, new, maxEdits: 3)

        #expect(script.removed.count == old.count)
        #expect(script.inserted.count == new.count)
        #expect(zip(old, script.removed).filter { !$0.1 }.map(\.0) == zip(new, script.inserted).filter { !$0.1 }.map(\.0))
    }

    private func mutate(_ lines: inout [String], alphabet: [String], using generator: inout SeededGenerator) {
        let position = lines.isEmpty ? 0 : Int.random(in: 0..<lines.count, using: &generator)
        switch Int.random(in: 0..<3, using: &generator) {
        case 0: lines.insert(alphabet.randomElement(using: &generator)!, at: min(position, lines.count))
        case 1 where !lines.isEmpty: lines.remove(at: position)
        default: if !lines.isEmpty { lines[position] = alphabet.randomElement(using: &generator)! }
        }
    }

    private func longestCommonSubsequence(_ a: [String], _ b: [String]) -> Int {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        var previous = [Int](repeating: 0, count: b.count + 1)
        for x in a {
            var current = [Int](repeating: 0, count: b.count + 1)
            for (j, y) in b.enumerated() {
                current[j + 1] = x == y ? previous[j] + 1 : max(previous[j + 1], current[j])
            }
            previous = current
        }
        return previous[b.count]
    }
}

@Suite("DiffLayout")
struct DiffLayoutTests {
    private func lines(_ kinds: String) -> [DiffLine] {
        kinds.map { character in
            let kind: DiffLine.Kind = character == "+" ? .added : (character == "-" ? .removed : .context)
            return DiffLine(kind: kind, oldNumber: nil, newNumber: nil, segments: [DiffSegment(text: "", isChanged: false)])
        }
    }

    @Test("Lange unveränderte Bereiche werden bis auf 3 Zeilen Kontext eingeklappt")
    func collapsesDistantContext() {
        let diff = lines(String(repeating: " ", count: 10) + "+" + String(repeating: " ", count: 20) + "-" + String(repeating: " ", count: 2))
        let rows = DiffLayout.rows(for: diff)

        #expect(rows.first == .collapsed(start: 0, count: 7))
        #expect(rows.contains(.collapsed(start: 14, count: 14)))
        #expect(rows.suffix(2) == [.line(32), .line(33)])
    }

    @Test("Kurze Bereiche bleiben offen, aufgeklappte Bereiche erscheinen vollständig")
    func keepsShortRunsAndExpanded() {
        let diff = lines("+" + String(repeating: " ", count: 9) + "-")
        #expect(DiffLayout.rows(for: diff).count == 11)

        let long = lines(String(repeating: " ", count: 10) + "+")
        #expect(DiffLayout.rows(for: long).count == 5)
        #expect(DiffLayout.rows(for: long, expanded: [0]).count == 11)
    }
}
