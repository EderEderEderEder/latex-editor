import Foundation

/// Ein Dateityp (Endung) im Filter des Dateibaums. `count` ist 0, wenn das Projekt keine solche Datei hat, der Typ
/// aber ausgeblendet ist: Er bleibt im Menü, damit man ihn wieder einblenden kann.
struct FileTypeEntry: Identifiable, Equatable, Sendable {
    let fileExtension: String
    let count: Int

    var id: String { fileExtension }

    /// „.sty“, bei Dateien ohne Endung „Ohne Endung“
    var title: String { fileExtension.isEmpty ? FileTypeCatalog.noExtensionTitle : "." + fileExtension }
}

struct FileTypeSection: Identifiable, Equatable, Sendable {
    let title: String
    let entries: [FileTypeEntry]

    var id: String { title }
}

/// Welche Dateitypen es im Projekt gibt und wie sie im Filtermenü gruppiert sind. Reine Logik ohne Oberfläche.
enum FileTypeCatalog {
    static let noExtensionTitle = "Ohne Endung"
    private static let texTitle = "LaTeX"
    private static let bibTitle = "Literatur"
    private static let buildTitle = "Build-Dateien"
    private static let otherTitle = "Sonstige"

    /// Reihenfolge der Gruppen im Menü: zuerst, was man schreibt, dann Pakete, dann der Rest
    private static let sectionOrder: [String] = {
        let lead = [texTitle, bibTitle, "Pakete und Klassen", "Bilder", "PDF"]
        let rest = FileGlyph.groupTitles.filter { !lead.contains($0) }
        return lead + rest + [buildTitle, otherTitle]
    }()

    static func key(for url: URL) -> String {
        url.pathExtension.lowercased()
    }

    /// Gruppen mit ihren Endungen (alphabetisch). Ausgeblendete Endungen ohne Datei im Projekt stehen mit `count` 0 dabei.
    static func sections(in tree: FileNode?, hidden: Set<String>) -> [FileTypeSection] {
        var counts: [String: Int] = [:]
        for file in tree?.collectFiles() ?? [] where file.depth > 0 {
            counts[key(for: file.url), default: 0] += 1
        }
        for fileExtension in hidden where counts[fileExtension] == nil { counts[fileExtension] = 0 }

        let grouped = Dictionary(grouping: counts.keys, by: sectionTitle(forExtension:))
        return sectionOrder.compactMap { title in
            guard let extensions = grouped[title] else { return nil }
            let entries = extensions.sorted().map { FileTypeEntry(fileExtension: $0, count: counts[$0] ?? 0) }
            return FileTypeSection(title: title, entries: entries)
        }
    }

    static func sectionTitle(forExtension fileExtension: String) -> String {
        switch fileExtension {
        case "tex": texTitle
        case "bib": bibTitle
        case _ where BuildArtifacts.isArtifactExtension(fileExtension): buildTitle
        default: FileGlyph.groupTitle(forExtension: fileExtension) ?? otherTitle
        }
    }
}

extension FileNode {
    /// Der Baum ohne Dateien der ausgeblendeten Typen. Ordner, die dadurch leer würden, entfallen mit (wirklich leere
    /// Ordner bleiben). Die Datei `keeping` (die offene) bleibt sichtbar, damit sie nicht aus dem Baum verschwindet.
    func hidingFileTypes(_ hidden: Set<String>, keeping: URL? = nil) -> FileNode {
        guard !hidden.isEmpty else { return self }
        return pruned(hiding: hidden, keeping: keeping) ?? FileNode(url: url, children: [])
    }

    private func pruned(hiding hidden: Set<String>, keeping: URL?) -> FileNode? {
        guard let children else {
            let isHidden = hidden.contains(FileTypeCatalog.key(for: url)) && url != keeping
            return isHidden ? nil : self
        }
        let remaining = children.compactMap { $0.pruned(hiding: hidden, keeping: keeping) }
        guard !remaining.isEmpty || children.isEmpty else { return nil }
        return FileNode(url: url, children: remaining)
    }
}
