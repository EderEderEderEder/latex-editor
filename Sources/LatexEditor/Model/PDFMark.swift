import CryptoKit
import Foundation

/// Die Farben des Textmarkers. Der Name steht im Menü, damit die Farbe nicht allein etwas bedeutet.
enum MarkColor: String, Codable, CaseIterable, Sendable {
    case yellow
    case green
    case blue
    case pink
    case orange

    var title: String {
        switch self {
        case .yellow: "Gelb"
        case .green: "Grün"
        case .blue: "Blau"
        case .pink: "Rosa"
        case .orange: "Orange"
        }
    }
}

/// Eine Markierung im PDF, optional mit Kommentar. Sie hängt am Quelltext (`start`, `end`), nicht am PDF: Das PDF
/// entsteht bei jedem Kompilieren neu, die Markierung wird danach wieder daraufgelegt.
struct PDFMark: Codable, Identifiable, Equatable, Sendable {
    /// Textmarker über Text, oder Notiz an einer Zeile (ohne markierten Text, am Rand der Zeile)
    enum Kind: String, Codable, Sendable {
        case highlight
        case note
    }

    let id: UUID
    var kind: Kind
    var color: MarkColor
    var comment: String
    /// Der markierte Text, wie ihn das PDF lieferte (für die Liste)
    var text: String
    var start: MarkAnchor
    var end: MarkAnchor
    /// Seite beim Anlegen, 1-basiert (Sortierung der Liste, solange noch nichts zugeordnet ist)
    var pageHint: Int
    let createdAt: Date

    init(
        id: UUID, kind: Kind = .highlight, color: MarkColor, comment: String, text: String,
        start: MarkAnchor, end: MarkAnchor, pageHint: Int, createdAt: Date
    ) {
        self.id = id
        self.kind = kind
        self.color = color
        self.comment = comment
        self.text = text
        self.start = start
        self.end = end
        self.pageHint = pageHint
        self.createdAt = createdAt
    }

    /// Dateien ohne `kind` (vor den Notizen gespeichert) sind Textmarker
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        kind = try container.decodeIfPresent(Kind.self, forKey: .kind) ?? .highlight
        color = try container.decode(MarkColor.self, forKey: .color)
        comment = try container.decode(String.self, forKey: .comment)
        text = try container.decode(String.self, forKey: .text)
        start = try container.decode(MarkAnchor.self, forKey: .start)
        end = try container.decode(MarkAnchor.self, forKey: .end)
        pageHint = try container.decode(Int.self, forKey: .pageHint)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }
}

/// Wo eine Markierung nach dem letzten Kompilieren liegt
enum MarkResolution: Equatable {
    /// Am Wort (`words`) oder nur an der Zeile (`lines`), wenn das Wort im PDF nicht zu finden war
    enum Precision: Equatable {
        case words
        case lines
    }

    /// PDFKit-Seitenkoordinaten (unten links), Seitenindex 0-basiert
    struct Segment: Equatable {
        let pageIndex: Int
        let rect: CGRect
    }

    case placed(segments: [Segment], precision: Precision)
    /// Der Text ist neuer als das PDF: Die Zeilen des PDFs stimmen nicht mehr mit der Datei überein, bis neu kompiliert ist
    case pending
    /// Die Stelle im Quelltext gibt es nicht mehr
    case orphaned
}

/// Markierungen eines Projekts in einer eigenen Datei im Programmordner der App (nicht im Projekt, damit Git und das
/// Projektverzeichnis unberührt bleiben). Eine Datei je Projekt, benannt nach dem Pfad des Projektordners.
enum MarkStorage {
    static let currentVersion = 1
    private static let appProcessName = "LatexEditor"
    private static let hashLength = 16

    private struct FileContent: Codable {
        var version: Int
        var projectPath: String
        var marks: [PDFMark]
    }

    enum LoadError: Error, Equatable {
        case unreadable(String)
        case newerVersion(Int)
    }

    /// Im App-Prozess „Application Support/LatexEditor/Markierungen“; in jedem anderen Prozess (Tests) ein Temp-Ordner,
    /// damit Tests nie die Markierungen des Nutzers berühren.
    nonisolated static func defaultDirectory() -> URL {
        guard ProcessInfo.processInfo.processName == appProcessName,
              let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return FileManager.default.temporaryDirectory.appendingPathComponent("LatexEditor-Markierungen-\(ProcessInfo.processInfo.processIdentifier)")
        }
        return support.appendingPathComponent("LatexEditor/Markierungen", isDirectory: true)
    }

    static func fileURL(for root: URL, in directory: URL) -> URL {
        let path = root.standardizedFileURL.path
        let digest = SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(String(digest.prefix(hashLength)) + ".json")
    }

    /// Ohne Datei: leer. Eine unlesbare Datei wird nicht überschrieben (der Aufrufer meldet es und sichert sie).
    static func load(root: URL, in directory: URL) throws -> [PDFMark] {
        let file = fileURL(for: root, in: directory)
        guard FileManager.default.fileExists(atPath: file.path) else { return [] }
        do {
            let content = try decoder.decode(FileContent.self, from: Data(contentsOf: file))
            guard content.version <= currentVersion else { throw LoadError.newerVersion(content.version) }
            return content.marks
        } catch let error as LoadError {
            throw error
        } catch {
            throw LoadError.unreadable(error.localizedDescription)
        }
    }

    static func save(_ marks: [PDFMark], root: URL, in directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let content = FileContent(version: currentVersion, projectPath: root.standardizedFileURL.path, marks: marks)
        try encoder.encode(content).write(to: fileURL(for: root, in: directory), options: .atomic)
    }

    /// Legt eine unlesbare Datei beiseite, damit sie nicht beim nächsten Speichern verloren geht
    @discardableResult
    static func setAside(root: URL, in directory: URL) -> URL? {
        let file = fileURL(for: root, in: directory)
        let stamp = Int(Date().timeIntervalSince1970)
        let target = file.deletingPathExtension().appendingPathExtension("defekt-\(stamp).json")
        return (try? FileManager.default.moveItem(at: file, to: target)) == nil ? nil : target
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
