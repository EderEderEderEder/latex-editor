import Foundation

enum ImageImportError: LocalizedError, Equatable {
    case unsupportedFormat(String)
    case directoryNotCreated(String)

    var errorDescription: String? {
        switch self {
        case let .unsupportedFormat(name):
            "„\(name)“ hat ein Format, das pdfLaTeX nicht einbinden kann. Erlaubt sind PNG, JPG und PDF."
        case let .directoryNotCreated(path):
            "Der Ordner „\(path)“ konnte nicht angelegt werden."
        }
    }
}

/// Kopiert ein Bild ins Projekt (`images/`) und bestimmt den Pfad für `\includegraphics`.
enum ImageImport {
    static let supportedExtensions: Set<String> = ["png", "jpg", "jpeg", "pdf"]
    static let directoryName = "images"
    private static let transliterations: [Character: String] = [
        "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"
    ]

    static func isSupported(_ url: URL) -> Bool {
        supportedExtensions.contains(url.pathExtension.lowercased())
    }

    /// Leerzeichen und Sonderzeichen sind in LaTeX-Dateinamen heikel: `Mein Bild (1).PNG` → `Mein-Bild-1.png`.
    static func sanitizedName(_ filename: String) -> String {
        let url = URL(fileURLWithPath: filename)
        let fileExtension = url.pathExtension.lowercased()
        var base = ""
        for character in url.deletingPathExtension().lastPathComponent {
            if let replacement = transliterations[character] {
                base += replacement
            } else if character.isASCII, character.isLetter || character.isNumber || character == "_" || character == "-" {
                base.append(character)
            } else if !base.hasSuffix("-") {
                base.append("-")
            }
        }
        base = base.trimmingCharacters(in: CharacterSet(charactersIn: "-_"))
        if base.isEmpty { base = "bild" }
        return fileExtension.isEmpty ? base : "\(base).\(fileExtension)"
    }

    /// Ziel im Ordner: gleicher Inhalt → vorhandene Datei weiterverwenden, anderer Inhalt → durchnummerieren.
    static func destination(for source: URL, in directory: URL) -> (url: URL, needsCopy: Bool) {
        let manager = FileManager.default
        if source.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL {
            return (source, false)
        }
        let name = sanitizedName(source.lastPathComponent)
        let stem = URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent
        let fileExtension = URL(fileURLWithPath: name).pathExtension
        var candidate = directory.appendingPathComponent(name)
        var number = 2
        while manager.fileExists(atPath: candidate.path) {
            if manager.contentsEqual(atPath: candidate.path, andPath: source.path) { return (candidate, false) }
            candidate = directory.appendingPathComponent("\(stem)-\(number).\(fileExtension)")
            number += 1
        }
        return (candidate, true)
    }

    @discardableResult
    static func importImage(from source: URL, into directory: URL) throws -> URL {
        guard isSupported(source) else { throw ImageImportError.unsupportedFormat(source.lastPathComponent) }
        let manager = FileManager.default
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            throw ImageImportError.directoryNotCreated(directory.path)
        }
        let target = destination(for: source, in: directory)
        if target.needsCopy { try manager.copyItem(at: source, to: target.url) }
        return target.url.standardizedFileURL
    }
}

/// Pfad für `\includegraphics`, abhängig von `\graphicspath` der Hauptdatei.
enum GraphicsReference {
    static func path(for file: URL, projectRoot: URL, graphicsDirectories: [String]) -> String {
        let root = projectRoot.standardizedFileURL.path + "/"
        let full = file.standardizedFileURL.path
        guard full.hasPrefix(root) else { return file.lastPathComponent }
        let relative = String(full.dropFirst(root.count))
        for directory in graphicsDirectories where relative.hasPrefix(directory) {
            return String(relative.dropFirst(directory.count))
        }
        return relative
    }
}
