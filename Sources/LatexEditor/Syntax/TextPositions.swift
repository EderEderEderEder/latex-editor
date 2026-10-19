import Foundation

/// Klemm-Logik für Positionen, die gegen einen Text verwendet werden. Auswahl, gespeicherte
/// Positionen und Zeilennummern können veraltet sein (Dateiwechsel, externe Änderungen,
/// Log-Zeilen nach Bearbeitungen) und dürfen nie zu einer Range-Exception führen.
extension NSRange {
    /// Liegt vollständig in `0...length`. Eine ungültige Position (`NSNotFound`) wird zu 0.
    func clamped(toLength length: Int) -> NSRange {
        let textLength = Swift.max(length, 0)
        guard location != NSNotFound, location >= 0 else { return NSRange(location: 0, length: 0) }
        let start = Swift.min(location, textLength)
        let end = Swift.min(Swift.max(NSMaxRange(self), start), textLength)
        return NSRange(location: start, length: end - start)
    }
}

extension LineIndex {
    /// 1-basierte Zeilennummer auf `1...lineCount` geklemmt.
    func clampedLineNumber(_ number: Int) -> Int {
        Swift.min(Swift.max(number, 1), lineCount)
    }

    /// Bereich der 1-basierten Zeile ohne Umbruch; die Nummer wird geklemmt.
    func contentRange(ofLineNumber number: Int) -> NSRange {
        contentRange(ofLine: clampedLineNumber(number) - 1)
    }

    /// 0-basierte Zeile einer Position; die Position wird auf `0...length` geklemmt.
    func clampedLine(containing offset: Int) -> Int {
        line(containing: Swift.min(Swift.max(offset, 0), length))
    }
}
