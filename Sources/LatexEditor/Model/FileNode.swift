import Foundation

enum FileKind: Sendable {
    case tex
    case bib
    case image
    case other

    private static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "svg", "pdf", "tif", "tiff"
    ]

    init(url: URL) {
        let fileExtension = url.pathExtension.lowercased()
        switch fileExtension {
        case "tex": self = .tex
        case "bib": self = .bib
        case _ where Self.imageExtensions.contains(fileExtension): self = .image
        default: self = .other
        }
    }

    var isEditable: Bool { self == .tex || self == .bib }
    var isShownInTree: Bool { self != .other }

    var symbolName: String {
        switch self {
        case .tex: "doc.text"
        case .bib: "books.vertical"
        case .image: "photo"
        case .other: "doc"
        }
    }
}

/// Knoten des Dateibaums. `children == nil` bedeutet Datei, sonst Ordner.
struct FileNode: Identifiable, Hashable, Sendable {
    let url: URL
    var children: [FileNode]?

    var id: URL { url }
    var name: String { url.lastPathComponent }
    var isDirectory: Bool { children != nil }
    var kind: FileKind { FileKind(url: url) }

    /// Alle Einträge (Dateien und Ordner, mit der Wurzel), für den Abgleich mit Dateisystem-Ereignissen
    func allURLs() -> Set<URL> {
        var result: Set<URL> = [url]
        for child in children ?? [] { result.formUnion(child.allURLs()) }
        return result
    }

    /// Alle Dateien (ohne Ordner) mit ihrer Tiefe, Wurzel = 0.
    func collectFiles(depth: Int = 0) -> [(url: URL, depth: Int)] {
        guard let children else { return [(url, depth)] }
        return children.flatMap { $0.collectFiles(depth: depth + 1) }
    }
}
