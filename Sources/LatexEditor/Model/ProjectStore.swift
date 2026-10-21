import Foundation
import Observation

private struct ProjectSnapshot: Sendable {
    let tree: FileNode
    let mainFile: URL?
}

@MainActor
@Observable
final class ProjectStore {
    private(set) var rootURL: URL?
    private(set) var mainFileURL: URL?
    private(set) var tree: FileNode?
    private(set) var fileCount = 0
    /// Im Dateibaum markierter Eintrag (für „Neue Datei“ im Menü)
    var selectedURL: URL?

    @ObservationIgnored private var reloadTask: Task<Void, Never>?
    /// Alles, was der Baum zeigt, als normalisierte Pfade (für `isTreeChange`): FSEvents meldet `/private/var/…`,
    /// der Baum kennt `/var/…`
    @ObservationIgnored private var treePaths: Set<String> = []

    func open(root: URL) async {
        reloadTask?.cancel()
        let root = root.standardizedFileURL
        rootURL = root
        tree = nil
        treePaths = []
        mainFileURL = nil
        fileCount = 0
        guard let snapshot = await Self.makeSnapshot(root: root, keepingMainFile: nil) else { return }
        guard rootURL == root else { return }
        apply(snapshot)
    }

    /// Die Hauptdatei folgt einer umbenannten oder verschobenen Datei bzw. einem Ordner.
    @discardableResult
    func relocateMainFile(from old: URL, to new: URL) -> Bool {
        guard let main = mainFileURL else { return false }
        let moved = ReferenceUpdater.mapped(main.standardizedFileURL, from: old.standardizedFileURL, to: new.standardizedFileURL)
        guard let moved else { return false }
        mainFileURL = moved
        return true
    }

    /// Muss der Baum nach diesem Dateisystem-Ereignis neu geladen werden?
    func isTreeChange(_ event: FileEvent) -> Bool {
        event.changesTree(isInTree: { treePaths.contains(SyncTeXIndex.normalizedPath($0)) },
                          exists: { FileManager.default.fileExists(atPath: $0.path) })
    }

    /// Lädt nur den Baum neu (z. B. nach Dateisystem-Ereignissen). Spätere Aufrufe verdrängen frühere.
    func reloadTree() {
        guard let root = rootURL else { return }
        reloadTask?.cancel()
        let currentMain = mainFileURL
        reloadTask = Task {
            guard let snapshot = await Self.makeSnapshot(root: root, keepingMainFile: currentMain),
                  !Task.isCancelled, rootURL == root else { return }
            apply(snapshot)
        }
    }

    private func apply(_ snapshot: ProjectSnapshot) {
        if snapshot.tree != tree {
            tree = snapshot.tree
            treePaths = Set(snapshot.tree.allURLs().map(SyncTeXIndex.normalizedPath))
            fileCount = snapshot.tree.collectFiles().count
        }
        if snapshot.mainFile != mainFileURL { mainFileURL = snapshot.mainFile }
    }

    private nonisolated static func makeSnapshot(root: URL, keepingMainFile: URL?) async -> ProjectSnapshot? {
        await Task.detached(priority: .utility) {
            let tree = FileTreeLoader.load(root: root)
            let main = keepingMainFile.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
                ?? MainFileDetector.detect(in: tree)
            return ProjectSnapshot(tree: tree, mainFile: main)
        }.value
    }
}
