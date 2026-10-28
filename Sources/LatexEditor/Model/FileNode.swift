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

    var symbolName: String {
        switch self {
        case .tex: "doc.text"
        case .bib: "books.vertical"
        case .image: "photo"
        case .other: "doc"
        }
    }
}

/// Symbol einer Datei im Baum nach ihrer Endung (SF Symbols; ein Symbol pro Art, nicht pro Endung)
enum FileGlyph {
    private static let groups: [(symbol: String, extensions: Set<String>)] = [
        ("doc.richtext", ["pdf"]),
        ("photo", ["png", "jpg", "jpeg", "gif", "tif", "tiff", "svg", "heic", "webp", "bmp", "eps"]),
        ("doc.zipper", ["zip", "gz", "tar", "tgz", "7z", "rar", "bz2", "xz"]),
        ("chevron.left.forwardslash.chevron.right", ["py", "swift", "java", "c", "cpp", "h", "hpp", "js", "ts", "sh", "rb", "go", "rs", "cs", "php", "kt", "m", "r", "sql", "html", "css"]),
        ("tablecells", ["csv", "tsv", "xlsx", "xls", "numbers", "ods"]),
        ("doc.plaintext", ["txt", "md", "markdown", "rtf"]),
        ("gearshape", ["sty", "cls", "bst", "def", "cfg", "clo", "ini"]),
        ("curlybraces", ["json", "xml", "yaml", "yml", "toml", "plist"]),
        ("film", ["mp4", "mov", "m4v", "avi"]),
        ("waveform", ["mp3", "wav", "m4a", "aac"]),
        ("rectangle.on.rectangle", ["pptx", "ppt", "key"]),
        ("doc.text", ["docx", "doc", "pages", "odt"]),
    ]

    static func symbol(for url: URL) -> String {
        switch FileKind(url: url) {
        case .tex: return "doc.text"
        case .bib: return "books.vertical"
        case .image, .other:
            let fileExtension = url.pathExtension.lowercased()
            return groups.first { $0.extensions.contains(fileExtension) }?.symbol ?? "doc"
        }
    }
}

/// Hilfsdateien, die LaTeX und latexmk neben dem Dokument anlegen (`.aux`, `.log`, `.synctex.gz` …). Der Dateibaum zeigt
/// sonst alles; diese bleiben verborgen, bis „Build-Dateien zeigen“ gewählt ist.
enum BuildArtifacts {
    private static let extensions: Set<String> = [
        "aux", "log", "toc", "lof", "lot", "out", "bbl", "blg", "bcf", "fls", "fdb_latexmk", "nav", "snm", "vrb", "idx", "ind", "ilg",
        "glo", "gls", "glg", "acn", "acr", "alg", "xdv", "dvi", "synctex", "thm", "loa", "lol",
    ]
    private static let suffixes = [".synctex.gz", ".run.xml", "-blx.bib", ".synctex(busy)", ".bib.bak"]

    static func isArtifact(_ url: URL) -> Bool {
        let name = url.lastPathComponent.lowercased()
        return suffixes.contains { name.hasSuffix($0) } || extensions.contains(url.pathExtension.lowercased())
    }

    /// Soll der Dateibaum diese Datei zeigen?
    static func isShownInTree(_ url: URL, showsBuildFiles: Bool) -> Bool {
        showsBuildFiles || !isArtifact(url)
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
