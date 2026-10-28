import Foundation
import Observation

/// Kleine Eingabefenster über dem Editor: ⌘P „Schnell öffnen“ und ⌘L „Gehe zu Zeile“.
enum Palette: String, Identifiable {
    case quickOpen
    case goToLine
    case imageLibrary

    var id: String { rawValue }
}

@MainActor
@Observable
final class PaletteStore {
    var active: Palette?
    /// Dateien für „Schnell öffnen“, beim Öffnen des Fensters erhoben
    private(set) var candidates: [QuickOpenCandidate] = []

    func presentQuickOpen(candidates: [QuickOpenCandidate]) {
        self.candidates = candidates
        active = .quickOpen
    }

    func presentGoToLine() {
        active = .goToLine
    }

    func presentImageLibrary() {
        active = .imageLibrary
    }
}

extension AppModel {
    /// ⌘P: bearbeitbare Dateien des Projekts, offene zuerst.
    func presentQuickOpen() {
        guard let root = project.rootURL?.standardizedFileURL, let tree = project.tree else { return }
        let openFiles = Set(editor.tabs.fileURLs)
        let candidates = tree.collectFiles().compactMap { file -> QuickOpenCandidate? in
            guard FileKind(url: file.url).isEditable else { return nil }
            let path = file.url.standardizedFileURL.path
            guard path.hasPrefix(root.path + "/") else { return nil }
            return QuickOpenCandidate(url: file.url, relativePath: String(path.dropFirst(root.path.count + 1)),
                                      isOpen: openFiles.contains(file.url.standardizedFileURL))
        }
        // Offene Dateien in Tab-Reihenfolge
        let order = Dictionary(uniqueKeysWithValues: editor.tabs.fileURLs.enumerated().map { ($1, $0) })
        palette.presentQuickOpen(candidates: candidates.sorted {
            (order[$0.url.standardizedFileURL] ?? Int.max) < (order[$1.url.standardizedFileURL] ?? Int.max)
        })
    }

    /// ⌘L: nur mit angezeigter Datei.
    func presentGoToLine() {
        guard editor.current != nil else { return }
        palette.presentGoToLine()
    }

    func goToLine(_ line: Int) async {
        guard let url = editor.current?.url else { return }
        await editor.open(url, line: line)
    }
}

extension AppModel {
    /// Alle Bilder des Projekts, die `\includegraphics` nehmen kann; ohne die PDF-Ausgabe der Hauptdatei
    func projectImages() -> [URL] {
        let output = pdf.pdfURL?.standardizedFileURL
        return (project.tree?.collectFiles().map(\.url) ?? [])
            .filter { FileKind(url: $0) == .image && ImageImport.isSupported($0) && $0.standardizedFileURL != output }
            .sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }

    func presentImageLibrary() {
        guard project.rootURL != nil else { return }
        palette.presentImageLibrary()
    }

    /// Aus der Bibliothek: Einfügen-Fenster mit diesem Bild
    func presentInsertImage(_ url: URL) {
        presentInsert(.image)
        insertion.image.file = url
    }
}

extension AppModel {
    /// Datei zu einem `\includegraphics`-Pfad: relativ zur Hauptdatei, zum Projekt und zur Datei selbst, mit `\graphicspath`
    func resolveGraphics(_ path: String, from file: URL) -> URL? {
        let bases = [project.mainFileURL?.deletingLastPathComponent(), project.rootURL, file.deletingLastPathComponent()].compactMap { $0 }
        return GraphicsResolver.resolve(path, bases: bases, graphicsDirectories: completionProvider.index.catalog.graphicsDirectories)
    }
}
