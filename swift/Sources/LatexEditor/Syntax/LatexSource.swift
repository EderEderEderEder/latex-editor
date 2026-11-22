import Foundation

/// Kommentare in LaTeX: `%` bis zum Zeilenende, außer bei einer ungeraden Zahl `\` davor (`\%` ist ein Prozentzeichen,
/// `\\%` ein Zeilenumbruch und dann ein Kommentar). Die eine Regel für Index, Optionen, Katalog, Verweise,
/// Vervollständigung und Prüfungen (vorher sechs eigene Kopien). `OutlineParser.commentStart` wendet sie aus
/// Tempogründen auf Bytes an; `LatexSourceTests` prüft, dass beide übereinstimmen.
enum LatexComments {
    private static let backslash = UInt16(UInt8(ascii: "\\"))

    /// Beginn des Kommentars in einer Zeile, sonst `nil`
    static func commentStart<Line: StringProtocol>(in line: Line) -> Line.Index? {
        var escaped = false
        for index in line.indices {
            let character = line[index]
            if character == "%", !escaped { return index }
            escaped = character == "\\" && !escaped
        }
        return nil
    }

    /// Kommentare durch Leerzeichen ersetzt, gleiche UTF-16-Länge: Bereiche im Ergebnis gelten auch im Original.
    /// Springt mit der Suche von NSString von `%` zu `%` und fasst nur die Kommentare an (eine Schleife über jedes
    /// Zeichen kostete im Debug-Build 280 ms für 10.000 Zeilen). Ein Kommentar endet an `\n` oder `\r`
    /// (bei `\r\n` als einem Zeichen von Swift endete er sonst nie).
    static func masking(_ text: String) -> String {
        let result = NSMutableString(string: text)
        let length = result.length
        var searchStart = 0
        while searchStart < length {
            let percentRange = result.range(of: "%", options: .literal, range: NSRange(location: searchStart, length: length - searchStart))
            guard percentRange.location != NSNotFound else { break }
            let start = percentRange.location
            let lineStart = result.rangeOfCharacter(from: lineBreaks, options: .backwards, range: NSRange(location: 0, length: start))
            if isEscaped(result, at: start, lineStart: lineStart.location == NSNotFound ? 0 : NSMaxRange(lineStart)) {
                searchStart = start + 1
                continue
            }
            let lineEnd = result.rangeOfCharacter(from: lineBreaks, range: NSRange(location: start, length: length - start))
            let end = lineEnd.location == NSNotFound ? length : lineEnd.location
            result.replaceCharacters(in: NSRange(location: start, length: end - start), with: String(repeating: " ", count: end - start))
            searchStart = end
        }
        return result as String
    }

    private static let lineBreaks = CharacterSet(charactersIn: "\n\r")

    /// Liegt `location` hinter einem Kommentarzeichen derselben Zeile? Springt mit der schnellen Suche von NSString
    /// von `%` zu `%`, statt jedes Zeichen anzusehen (läuft pro Tastendruck).
    static func isInComment(_ text: NSString, lineStart: Int, location: Int) -> Bool {
        var searchStart = lineStart
        while searchStart < location {
            let found = text.range(of: "%", options: .literal, range: NSRange(location: searchStart, length: location - searchStart))
            guard found.location != NSNotFound else { return false }
            if !isEscaped(text, at: found.location, lineStart: lineStart) { return true }
            searchStart = found.location + 1
        }
        return false
    }

    /// Ungerade Anzahl `\` direkt davor
    private static func isEscaped(_ text: NSString, at index: Int, lineStart: Int) -> Bool {
        var count = 0
        var position = index - 1
        while position >= lineStart, text.character(at: position) == backslash {
            count += 1
            position -= 1
        }
        return count % 2 == 1
    }
}

/// Text-Dateien des Projekts lesen: UTF-8, sonst Latin-1 – wie der Editor. Eine Stelle für alle Leser, damit
/// Latin-1-Dateien nirgends still übersprungen oder verstümmelt werden.
enum ProjectText {
    static func decode(_ data: Data) -> (text: String, encoding: String.Encoding)? {
        if let text = String(data: data, encoding: .utf8) { return (text, .utf8) }
        if let text = String(data: data, encoding: .isoLatin1) { return (text, .isoLatin1) }
        return nil
    }

    static func read(_ url: URL) -> (text: String, encoding: String.Encoding)? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return decode(data)
    }

    static func string(_ url: URL) -> String? {
        read(url)?.text
    }

    /// Liest die Datei; Fehler mit verständlicher Meldung (z. B. für „Verweise anpassen“, „Quelle anlegen“)
    static func readForEditing(_ url: URL) throws -> (text: String, encoding: String.Encoding) {
        let data = try Data(contentsOf: url)
        guard let decoded = decode(data) else { throw CocoaError(.fileReadInapplicableStringEncoding, userInfo: [NSURLErrorKey: url]) }
        return decoded
    }
}
