import Foundation

/// Eine Änderung eines Verweises (z. B. `\include{chapters/alt}` → `\include{kapitel/neu}`).
struct ReferenceEdit: Equatable, Sendable, Identifiable {
    let file: URL
    /// Bereich des Arguments im Text der Datei (UTF-16)
    let range: NSRange
    /// 1-basiert
    let line: Int
    let oldText: String
    let newText: String

    var id: String { "\(file.path):\(range.location)" }
}

/// Findet Verweise auf eine verschobene oder umbenannte Datei (oder einen Ordner) und berechnet die
/// neuen Schreibweisen. Aufgelöst wird wie LaTeX: relativ zum Ordner der Hauptdatei, bei Bildern
/// zusätzlich über `\graphicspath`, mit der Endung, die LaTeX selbst ergänzt.
enum ReferenceUpdater {
    private struct Candidate {
        /// Pfad relativ zum Ordner der Hauptdatei
        let path: String
        /// `\graphicspath`-Verzeichnis, über das der Pfad entstand ("" sonst)
        let directory: String
        /// Endung, die LaTeX ergänzt hat (nicht Teil des geschriebenen Arguments)
        let impliedExtension: String?
    }

    private static let graphicExtensions = ["pdf", "png", "jpg", "jpeg"]
    private static let commandNames = ["include", "input", "subfile", "includegraphics", "bibliography", "addbibresource"]
    private static let expression = try? NSRegularExpression(
        pattern: #"\\(include|input|subfile|includegraphics|bibliography|addbibresource)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}"#
    )

    // MARK: Berechnen

    /// - Parameters:
    ///   - texts: Inhalt aller .tex-Dateien des Projekts (offene Dateien mit ihrem aktuellen Stand)
    static func edits(
        moving source: URL,
        to destination: URL,
        mainFile: URL,
        graphicsDirectories: [String],
        texts: [URL: String]
    ) -> [ReferenceEdit] {
        let base = mainFile.deletingLastPathComponent().standardizedFileURL
        let from = source.standardizedFileURL
        let to = destination.standardizedFileURL
        var result: [ReferenceEdit] = []
        for file in texts.keys.sorted(by: { $0.path < $1.path }) {
            guard let text = texts[file] else { continue }
            result += edits(in: text, file: file, base: base, from: from, to: to, graphicsDirectories: graphicsDirectories)
        }
        return result
    }

    private static func edits(
        in text: String, file: URL, base: URL, from: URL, to: URL, graphicsDirectories: [String]
    ) -> [ReferenceEdit] {
        guard let expression else { return [] }
        let masked = LatexComments.masking(text) as NSString
        let original = text as NSString
        var result: [ReferenceEdit] = []
        for match in expression.matches(in: masked as String, range: NSRange(location: 0, length: masked.length)) {
            let command = masked.substring(with: match.range(at: 1))
            for part in argumentParts(of: original, range: match.range(at: 2), command: command) {
                guard let replacement = rewritten(part.text, command: command, base: base, from: from, to: to,
                                                  graphicsDirectories: graphicsDirectories), replacement != part.text else { continue }
                let line = original.substring(to: part.range.location).filter { $0 == "\n" }.count + 1
                result.append(ReferenceEdit(file: file, range: part.range, line: line, oldText: part.text, newText: replacement))
            }
        }
        return result
    }

    /// `\bibliography{a,b}` enthält mehrere Einträge; alle anderen Befehle genau einen.
    private static func argumentParts(of text: NSString, range: NSRange, command: String) -> [(text: String, range: NSRange)] {
        guard command == "bibliography" else {
            return [(text.substring(with: range), range)]
        }
        var parts: [(String, NSRange)] = []
        var location = range.location
        for piece in text.substring(with: range).components(separatedBy: ",") {
            let length = (piece as NSString).length
            let trimmed = piece.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty {
                let leading = (piece as NSString).range(of: trimmed).location
                parts.append((trimmed, NSRange(location: location + leading, length: (trimmed as NSString).length)))
            }
            location += length + 1
        }
        return parts
    }

    private static func rewritten(
        _ argument: String, command: String, base: URL, from: URL, to: URL, graphicsDirectories: [String]
    ) -> String? {
        let trimmed = argument.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        for candidate in candidates(for: command, argument: trimmed, graphicsDirectories: graphicsDirectories) {
            let url = base.appendingPathComponent(candidate.path).standardizedFileURL
            guard let moved = mapped(url, from: from, to: to) else { continue }
            let root = candidate.directory.isEmpty ? base : base.appendingPathComponent(candidate.directory)
            var text = relativePath(of: moved, from: root.standardizedFileURL)
            if let implied = candidate.impliedExtension, text.hasSuffix("." + implied) {
                text.removeLast(implied.count + 1)
            }
            return text
        }
        return nil
    }

    private static func candidates(for command: String, argument: String, graphicsDirectories: [String]) -> [Candidate] {
        switch command {
        case "include", "input", "subfile":
            return [Candidate(path: argument + ".tex", directory: "", impliedExtension: "tex"),
                    Candidate(path: argument, directory: "", impliedExtension: nil)]
        case "bibliography":
            return [Candidate(path: argument + ".bib", directory: "", impliedExtension: "bib"),
                    Candidate(path: argument, directory: "", impliedExtension: nil)]
        case "includegraphics":
            return ([""] + graphicsDirectories).flatMap { directory in
                [Candidate(path: directory + argument, directory: directory, impliedExtension: nil)]
                    + graphicExtensions.map { Candidate(path: directory + argument + "." + $0, directory: directory, impliedExtension: $0) }
            }
        default:
            return [Candidate(path: argument, directory: "", impliedExtension: nil)]
        }
    }

    /// Neuer Ort einer Datei, die selbst verschoben wurde oder in einem verschobenen Ordner liegt.
    static func mapped(_ url: URL, from: URL, to: URL) -> URL? {
        if url.path == from.path { return to }
        guard url.path.hasPrefix(from.path + "/") else { return nil }
        return to.appendingPathComponent(String(url.path.dropFirst(from.path.count + 1))).standardizedFileURL
    }

    /// Pfad von `base` zu `target` mit `..` bei Bedarf.
    static func relativePath(of target: URL, from base: URL) -> String {
        let targetParts = target.standardizedFileURL.pathComponents
        let baseParts = base.standardizedFileURL.pathComponents
        var common = 0
        while common < min(targetParts.count, baseParts.count), targetParts[common] == baseParts[common] { common += 1 }
        let ups = Array(repeating: "..", count: baseParts.count - common)
        return (ups + targetParts[common...]).joined(separator: "/")
    }

    // MARK: Anwenden

    /// Ersetzt die Bereiche von hinten nach vorn, damit frühere Bereiche gültig bleiben.
    static func apply(_ edits: [ReferenceEdit], to text: String) -> String {
        let result = NSMutableString(string: text)
        for edit in edits.sorted(by: { $0.range.location > $1.range.location }) {
            guard NSMaxRange(edit.range) <= result.length else { continue }
            result.replaceCharacters(in: edit.range, with: edit.newText)
        }
        return result as String
    }
}
