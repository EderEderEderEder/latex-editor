import Foundation
import Testing
@testable import LatexEditor

/// Wendet eine Ersetzung wie NSTextStorage an und liefert Text, editedRange und Längendifferenz.
func replace(_ text: NSMutableString, range: NSRange, with replacement: String) -> (editedRange: NSRange, delta: Int) {
    text.replaceCharacters(in: range, with: replacement)
    let replacementLength = (replacement as NSString).length
    return (NSRange(location: range.location, length: replacementLength), replacementLength - range.length)
}

@Suite("LineIndex")
struct LineIndexTests {
    @Test("Zeilenanzahl für Grenzfälle", arguments: [
        ("", 1), ("a", 1), ("a\n", 2), ("a\nb", 2), ("\n\n", 3), ("a\r\nb", 2)
    ])
    func lineCount(text: String, expected: Int) {
        #expect(LineIndex(text: text as NSString).lineCount == expected)
    }

    @Test("Zeilenbereiche mit und ohne abschließenden Umbruch")
    func lineRanges() {
        let index = LineIndex(text: "ab\ncd" as NSString)
        #expect(index.contentRange(ofLine: 0) == NSRange(location: 0, length: 2))
        #expect(index.fullRange(ofLine: 0) == NSRange(location: 0, length: 3))
        #expect(index.contentRange(ofLine: 1) == NSRange(location: 3, length: 2))
        #expect(index.fullRange(ofLine: 1) == NSRange(location: 3, length: 2))
    }

    @Test("Ein Umbruch gehört zur Zeile, die er beendet; Dateiende zur letzten Zeile")
    func lineLookup() {
        let index = LineIndex(text: "ab\ncd\n" as NSString)
        #expect(index.line(containing: 0) == 0)
        #expect(index.line(containing: 2) == 0)
        #expect(index.line(containing: 3) == 1)
        #expect(index.line(containing: 6) == 2)
    }

    @Test("Umbruch einfügen teilt eine Zeile")
    func insertNewline() {
        let text = NSMutableString(string: "abcd\nefg")
        var index = LineIndex(text: text)
        let edit = replace(text, range: NSRange(location: 2, length: 0), with: "\n")

        let splice = index.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)

        #expect(splice == LineSplice(firstLine: 0, removedLineCount: 0, insertedLineCount: 1))
        #expect(index == LineIndex(text: text))
    }

    @Test("Löschen über Zeilengrenzen fügt Zeilen zusammen")
    func deleteAcrossLines() {
        let text = NSMutableString(string: "a\nbb\nccc\nd")
        var index = LineIndex(text: text)
        let edit = replace(text, range: NSRange(location: 1, length: 6), with: "")

        let splice = index.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)

        #expect(text == "ac\nd")
        #expect(splice == LineSplice(firstLine: 0, removedLineCount: 2, insertedLineCount: 0))
        #expect(index == LineIndex(text: text))
    }

    @Test("Mehrzeiliges durch Mehrzeiliges ersetzen")
    func replaceMultiline() {
        let text = NSMutableString(string: "1\n2\n3\n4\n5")
        var index = LineIndex(text: text)
        let edit = replace(text, range: NSRange(location: 2, length: 4), with: "x\ny\nz\nw")

        let splice = index.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)

        #expect(splice == LineSplice(firstLine: 1, removedLineCount: 2, insertedLineCount: 3))
        #expect(index == LineIndex(text: text))
    }

    @Test("Bearbeitungen am Anfang, am Ende und ohne abschließenden Umbruch")
    func editsAtBoundaries() {
        let text = NSMutableString(string: "abc")
        var index = LineIndex(text: text)
        for (range, replacement) in [
            (NSRange(location: 3, length: 0), "\n"),
            (NSRange(location: 4, length: 0), "x"),
            (NSRange(location: 0, length: 0), "\n\n"),
            (NSRange(location: 0, length: 1), ""),
            (NSRange(location: 0, length: 6), "")
        ] {
            let edit = replace(text, range: range, with: replacement)
            index.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)
            #expect(index == LineIndex(text: text))
        }
        #expect(text == "")
        #expect(index.lineCount == 1)
    }

    @Test("Zufällige Bearbeitungen ergeben denselben Index wie ein Neuaufbau")
    func randomEditsMatchRebuild() {
        var generator = SeededGenerator(seed: 42)
        let text = NSMutableString(string: LargeDocument.make(lineCount: 300))
        var index = LineIndex(text: text)
        for _ in 0..<500 {
            let edit = randomEdit(in: text, using: &generator)
            index.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)
        }
        #expect(index == LineIndex(text: text))
    }
}

/// Deterministischer Zufallsgenerator (SplitMix64), damit fehlschlagende Tests reproduzierbar sind.
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var value = state
        value = (value ^ (value >> 30)) &* 0xBF58_476D_1CE4_E5B9
        value = (value ^ (value >> 27)) &* 0x94D0_49BB_1331_11EB
        return value ^ (value >> 31)
    }
}

/// Zufällige Ersetzung mit LaTeX-typischen Schnipseln (inklusive Umbrüchen und Mathe-Öffnern).
func randomEdit(in text: NSMutableString, using generator: inout SeededGenerator) -> (editedRange: NSRange, delta: Int) {
    let snippets = ["", "x", "\n", "$", "\\[", "\\]", "%", "\\begin{equation}", "\\end{equation}",
                    "\\begin{verbatim}", "\\end{verbatim}", "{", "}", "\n\n", "Wort \\emph{a}\n", "\\verb|"]
    let location = Int.random(in: 0...text.length, using: &generator)
    let maxLength = min(text.length - location, 40)
    let length = Int.random(in: 0...maxLength, using: &generator)
    let snippet = snippets.randomElement(using: &generator) ?? ""
    return replace(text, range: NSRange(location: location, length: length), with: snippet)
}
