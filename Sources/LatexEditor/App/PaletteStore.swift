import Foundation
import Observation

/// Kleine Eingabefenster über dem Editor: ⌘P „Schnell öffnen“ und ⌘L „Gehe zu Zeile“.
enum Palette: String, Identifiable {
    case quickOpen
    case goToLine

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
