import Foundation

/// Wohin ein ⌘-Klick im Text führt.
enum JumpTarget: Equatable, Sendable {
    case label(String)
    case citation(String)
    /// Pfad aus `\input`, `\include` oder `\subfile`, so wie er im Text steht
    case file(String)
}

enum JumpTargetFinder {
    /// Längere Zeilen werden nicht untersucht (Maus über minifiziertem Text soll nicht stocken)
    private static let maximumLineLength = 20_000
    private static let fileExpression = try! NSRegularExpression(pattern: #"\\(?:input|include|subfile)\s*\{([^{}]*)\}"#)

    /// Ziel an einer Textstelle (UTF-16-Index, ein Index am Rand des Schlüssels zählt noch dazu) samt Bereich des
    /// Schlüssels bzw. Pfads. `\label{…}` selbst ist kein Ziel.
    static func target(at location: Int, in text: NSString) -> (target: JumpTarget, range: NSRange)? {
        guard let hit = occurrence(at: location, in: text), hit.kind != .labelDefinition else { return fileTarget(at: location, in: text) }
        return (hit.kind == .labelUse ? .label(hit.key) : .citation(hit.key), hit.range)
    }

    /// Das Label an der Stelle, auch in `\label{…}` (für „Label umbenennen“)
    static func label(at location: Int, in text: NSString) -> String? {
        guard let hit = occurrence(at: location, in: text), hit.kind != .citation else { return nil }
        return hit.key
    }

    private static func occurrence(at location: Int, in text: NSString) -> ReferenceOccurrence? {
        guard let (line, lineRange) = lineText(at: location, in: text) else { return nil }
        let local = location - lineRange.location
        guard let found = LatexReferences.scan(line).first(where: { local >= $0.range.location && local <= NSMaxRange($0.range) }) else {
            return nil
        }
        return ReferenceOccurrence(kind: found.kind, key: found.key,
                                   range: NSRange(location: found.range.location + lineRange.location, length: found.range.length))
    }

    private static func fileTarget(at location: Int, in text: NSString) -> (target: JumpTarget, range: NSRange)? {
        guard let (line, lineRange) = lineText(at: location, in: text) else { return nil }
        let masked = LatexMasking.scannable(line) as NSString
        let local = location - lineRange.location
        for match in fileExpression.matches(in: masked as String, range: NSRange(location: 0, length: masked.length)) {
            let pathRange = match.range(at: 1)
            guard local >= pathRange.location, local <= NSMaxRange(pathRange) else { continue }
            let path = masked.substring(with: pathRange).trimmingCharacters(in: .whitespaces)
            guard !path.isEmpty else { return nil }
            return (.file(path), NSRange(location: pathRange.location + lineRange.location, length: pathRange.length))
        }
        return nil
    }

    private static func lineText(at location: Int, in text: NSString) -> (String, NSRange)? {
        guard location >= 0, location <= text.length, text.length > 0 else { return nil }
        let lineRange = text.lineRange(for: NSRange(location: min(location, text.length - 1), length: 0))
        guard lineRange.length <= maximumLineLength else { return nil }
        return (text.substring(with: lineRange), lineRange)
    }

    /// Datei zu einem `\input`-Pfad: relativ zu den Ordnern (Hauptdatei zuerst), mit und ohne `.tex`.
    static func resolveFile(_ path: String, bases: [URL], fileExists: (URL) -> Bool = { FileManager.default.fileExists(atPath: $0.path) }) -> URL? {
        for base in bases {
            for candidate in [path, path + ".tex"] {
                let url = candidate.hasPrefix("/") ? URL(fileURLWithPath: candidate) : base.appendingPathComponent(candidate)
                if fileExists(url), !FileOperations.isDirectory(url) { return url.standardizedFileURL }
            }
        }
        return nil
    }
}

/// Label umbenennen: alle `\label{alt}` und Verweise darauf im Projekt. Reine Logik.
enum LabelRenamer {
    private static let forbiddenCharacters = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "{},%#\\~^$&"))

    /// Bereiche des Schlüssels `key` in Definition und Verweisen (Zitate bleiben außen vor)
    static func occurrences(of key: String, in text: String) -> [NSRange] {
        LatexReferences.scan(text).filter { $0.kind != .citation && $0.key == key }.map(\.range)
    }

    static func apply(_ ranges: [NSRange], newKey: String, to text: String) -> String {
        let result = NSMutableString(string: text)
        for range in ranges.sorted(by: { $0.location > $1.location }) where NSMaxRange(range) <= result.length {
            result.replaceCharacters(in: range, with: newKey)
        }
        return result as String
    }

    /// Hinweistext, warum `newKey` nicht geht; `nil` wenn es geht.
    static func validate(_ newKey: String, old: String, existing: Set<String>) -> String? {
        let name = newKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "Bitte einen Namen eingeben." }
        if name == old { return "Der Name ist unverändert." }
        if name.unicodeScalars.contains(where: forbiddenCharacters.contains) {
            return "Im Namen sind Leerzeichen und die Zeichen { } , % # \\ ~ ^ $ & nicht erlaubt."
        }
        if existing.contains(name) { return "Ein Label mit diesem Namen gibt es schon." }
        return nil
    }
}
