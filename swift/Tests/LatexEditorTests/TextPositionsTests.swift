import Foundation
import Testing
@testable import LatexEditor

@Suite("Klemm-Logik")
struct TextPositionsTests {
    @Test("NSRange wird auf die Textlänge geklemmt", arguments: [
        (NSRange(location: 2271, length: 0), 43, NSRange(location: 43, length: 0)),
        (NSRange(location: 40, length: 10), 43, NSRange(location: 40, length: 3)),
        (NSRange(location: 5, length: 2), 43, NSRange(location: 5, length: 2)),
        (NSRange(location: 0, length: 0), 0, NSRange(location: 0, length: 0)),
        (NSRange(location: 3, length: 4), 0, NSRange(location: 0, length: 0)),
        (NSRange(location: NSNotFound, length: 0), 10, NSRange(location: 0, length: 0)),
        (NSRange(location: 3, length: 4), -1, NSRange(location: 0, length: 0))
    ])
    func clampRange(range: NSRange, length: Int, expected: NSRange) {
        #expect(range.clamped(toLength: length) == expected)
    }

    @Test("Zeilennummern werden auf vorhandene Zeilen geklemmt")
    func clampLineNumbers() {
        let lines = LineIndex(text: "a\nbb\nccc" as NSString)
        #expect(lines.clampedLineNumber(0) == 1)
        #expect(lines.clampedLineNumber(-3) == 1)
        #expect(lines.clampedLineNumber(2) == 2)
        #expect(lines.clampedLineNumber(99) == 3)
        #expect(lines.contentRange(ofLineNumber: 99) == NSRange(location: 5, length: 3))
        #expect(lines.contentRange(ofLineNumber: 2) == NSRange(location: 2, length: 2))
    }

    @Test("Zeile zu einer Position, auch außerhalb des Texts")
    func clampLineForOffset() {
        let lines = LineIndex(text: "a\nbb\n" as NSString)
        #expect(lines.clampedLine(containing: -1) == 0)
        #expect(lines.clampedLine(containing: 3) == 1)
        #expect(lines.clampedLine(containing: 2271) == 2)
        #expect(lines.clampedLine(containing: NSNotFound) == 2)
    }

    @Test("Leerer Text hat genau eine Zeile")
    func emptyText() {
        let lines = LineIndex(text: "" as NSString)
        #expect(lines.contentRange(ofLineNumber: 5) == NSRange(location: 0, length: 0))
        #expect(lines.clampedLine(containing: 10) == 0)
    }
}
