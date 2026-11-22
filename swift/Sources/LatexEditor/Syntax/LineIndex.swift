import Foundation

/// Beschreibt, wie sich die Zeilen durch eine Bearbeitung verändert haben.
/// Zeile `firstLine` ist inhaltlich geändert, danach wurden `removedLineCount` alte Zeilen
/// durch `insertedLineCount` neue ersetzt.
struct LineSplice: Equatable, Sendable {
    let firstLine: Int
    let removedLineCount: Int
    let insertedLineCount: Int
}

/// Zeilenanfänge als UTF-16-Offsets (passend zu NSRange). Zeilentrenner ist "\n".
/// Zeile 0 beginnt immer bei 0, nach jedem "\n" beginnt eine neue Zeile.
struct LineIndex: Equatable, Sendable {
    private(set) var lineStarts: [Int] = [0]
    private(set) var length = 0

    var lineCount: Int { lineStarts.count }

    init(text: NSString) {
        length = text.length
        lineStarts = [0] + Self.lineStarts(in: text, range: NSRange(location: 0, length: length))
    }

    func start(ofLine line: Int) -> Int {
        lineStarts[line]
    }

    /// Bereich der Zeile ohne abschließendes "\n".
    func contentRange(ofLine line: Int) -> NSRange {
        let start = lineStarts[line]
        let end = line + 1 < lineCount ? lineStarts[line + 1] - 1 : length
        return NSRange(location: start, length: end - start)
    }

    /// Bereich der Zeile inklusive abschließendem "\n".
    func fullRange(ofLine line: Int) -> NSRange {
        let start = lineStarts[line]
        let end = line + 1 < lineCount ? lineStarts[line + 1] : length
        return NSRange(location: start, length: end - start)
    }

    /// 0-basierte Zeile, in der `offset` liegt. Ein "\n" gehört zur Zeile, die es beendet.
    func line(containing offset: Int) -> Int {
        firstIndex(withStartGreaterThan: offset) - 1
    }

    /// Übernimmt eine Bearbeitung. `editedRange` bezieht sich auf den neuen Text
    /// (Semantik von NSTextStorage), `changeInLength` ist die Längendifferenz.
    @discardableResult
    mutating func applyEdit(in text: NSString, editedRange: NSRange, changeInLength delta: Int) -> LineSplice {
        let location = editedRange.location
        let oldEnd = NSMaxRange(editedRange) - delta
        let removedLower = firstIndex(withStartGreaterThan: location)
        let removedUpper = firstIndex(withStartGreaterThan: oldEnd)
        let insertedStarts = Self.lineStarts(in: text, range: editedRange)

        lineStarts.replaceSubrange(removedLower..<removedUpper, with: insertedStarts)
        shiftStarts(from: removedLower + insertedStarts.count, by: delta)
        length += delta

        return LineSplice(
            firstLine: removedLower - 1,
            removedLineCount: removedUpper - removedLower,
            insertedLineCount: insertedStarts.count
        )
    }

    /// Binärsuche: erster Index, dessen Zeilenanfang größer als `offset` ist.
    private func firstIndex(withStartGreaterThan offset: Int) -> Int {
        var low = 0
        var high = lineStarts.count
        while low < high {
            let middle = (low + high) / 2
            if lineStarts[middle] <= offset {
                low = middle + 1
            } else {
                high = middle
            }
        }
        return low
    }

    private mutating func shiftStarts(from firstIndex: Int, by delta: Int) {
        guard delta != 0, firstIndex < lineStarts.count else { return }
        lineStarts.withUnsafeMutableBufferPointer { starts in
            var index = firstIndex
            while index < starts.count {
                starts[index] += delta
                index += 1
            }
        }
    }

    /// Offsets direkt hinter jedem "\n" im Bereich.
    private static func lineStarts(in text: NSString, range: NSRange) -> [Int] {
        guard range.length > 0 else { return [] }
        let characters = UTF16Buffer.read(text, range: range)
        var starts: [Int] = []
        characters.withUnsafeBufferPointer { buffer in
            var index = 0
            while index < buffer.count {
                if buffer[index] == UTF16Buffer.newline { starts.append(range.location + index + 1) }
                index += 1
            }
        }
        return starts
    }
}

enum UTF16Buffer {
    static let newline = UInt16(UInt8(ascii: "\n"))

    static func read(_ text: NSString, range: NSRange) -> [UInt16] {
        [UInt16](unsafeUninitializedCapacity: range.length) { buffer, count in
            if let base = buffer.baseAddress {
                text.getCharacters(base, range: range)
            }
            count = range.length
        }
    }
}
