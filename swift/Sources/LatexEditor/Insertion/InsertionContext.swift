import Foundation

/// Die Umgebung der Cursorposition beim Öffnen des Einfügen-Fensters: Die Vorschau zeigt den erzeugten Code dort, wo er
/// landen wird, mit ein paar echten Zeilen davor und danach. Reine Logik (getestet in `InsertionContextTests`).
struct InsertionContext: Equatable, Sendable {
    /// Zeilen vor und nach der Cursorzeile
    static let surroundingLines = 3

    struct Line: Equatable, Sendable {
        /// 1-basiert, wie im Editor
        let number: Int
        let text: String
        /// Gehört (ganz oder teilweise) zum eingefügten Text
        let isNew: Bool
    }

    let fileName: String
    /// Ausschnitt des Dokuments: ganze Zeilen um den Cursor
    let excerpt: String
    /// Auswahl bzw. Cursor, bezogen auf `excerpt`
    let selection: NSRange
    /// Zeilennummer (1-basiert) der ersten Zeile des Ausschnitts
    let firstLineNumber: Int

    /// Zeile des Cursors (1-basiert), für „Einfügen in datei.tex, Zeile 42“
    var cursorLineNumber: Int {
        let prefix = (excerpt as NSString).substring(to: min(selection.location, (excerpt as NSString).length))
        return firstLineNumber + prefix.count { $0 == "\n" }
    }

    static func make(text: NSString, selection: NSRange, fileName: String) -> InsertionContext {
        let selection = selection.clamped(toLength: text.length)
        let lines = LineIndex(text: text)
        let cursorLine = lines.clampedLine(containing: selection.location)
        let endLine = lines.clampedLine(containing: NSMaxRange(selection))
        let firstLine = max(0, cursorLine - surroundingLines)
        let lastLine = min(lines.lineCount - 1, endLine + surroundingLines)
        let start = lines.start(ofLine: firstLine)
        let end = NSMaxRange(lines.contentRange(ofLine: lastLine))
        return InsertionContext(
            fileName: fileName,
            excerpt: text.substring(with: NSRange(location: start, length: end - start)),
            selection: NSRange(location: selection.location - start, length: selection.length),
            firstLineNumber: firstLine + 1
        )
    }

    /// Der Ausschnitt nach dem Einfügen, Zeile für Zeile. Blöcke stehen wie im Editor in eigenen Zeilen (`BlockPlacement`).
    func lines(inserting code: String, isBlock: Bool, replacesSelection: Bool) -> [Line] {
        let original = excerpt as NSString
        let range = replacesSelection ? selection : NSRange(location: NSMaxRange(selection), length: 0)
        let inserted = isBlock ? BlockPlacement.adjust(code, in: original, replacing: range) : code
        let result = original.replacingCharacters(in: range, with: inserted) as NSString
        let newRange = NSRange(location: range.location, length: (inserted as NSString).length)
        let index = LineIndex(text: result)
        return (0..<index.lineCount).map { line in
            let content = index.contentRange(ofLine: line)
            let full = index.fullRange(ofLine: line)
            let touches = newRange.length > 0 && NSIntersectionRange(full, newRange).length > 0
                && !(full.location == NSMaxRange(newRange))
            return Line(number: firstLineNumber + line, text: result.substring(with: content), isNew: touches)
        }
    }
}
