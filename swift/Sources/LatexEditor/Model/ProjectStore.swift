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

    /// Hilfsdateien von LaTeX (`.aux`, `.log` …) im Dateibaum zeigen; gilt für alle Projekte
    var showsBuildFiles: Bool {
        didSet {
            guard showsBuildFiles != oldValue else { return }
            defaults.set(showsBuildFiles, forKey: Self.showsBuildFilesKey)
            reloadTree()
        }
    }

    /// Endungen (klein, ohne Punkt, „“ = ohne Endung), die der Dateibaum nicht zeigt; gilt für alle Projekte. Nur die
    /// Anzeige: Schnell öffnen, Zähler und Suche kennen weiter alle Dateien.
    private(set) var hiddenFileExtensions: Set<String> {
        didSet {
            guard hiddenFileExtensions != oldValue else { return }
            defaults.set(hiddenFileExtensions.sorted(), forKey: Self.hiddenFileExtensionsKey)
        }
    }

    static let showsBuildFilesKey = "showsBuildFiles"
    static let hiddenFileExtensionsKey = "hiddenFileExtensions"

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var reloadTask: Task<Void, Never>?
    /// Alles, was der Baum zeigt, als normalisierte Pfade (für `isTreeChange`): FSEvents meldet `/private/var/…`,
    /// der Baum kennt `/var/…`
    @ObservationIgnored private var treePaths: Set<String> = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showsBuildFiles = defaults.bool(forKey: Self.showsBuildFilesKey)
        hiddenFileExtensions = Set(defaults.stringArray(forKey: Self.hiddenFileExtensionsKey) ?? [])
    }

    func setFileType(_ fileExtension: String, hidden: Bool) {
        if hidden { hiddenFileExtensions.insert(fileExtension) } else { hiddenFileExtensions.remove(fileExtension) }
    }

    func showAllFileTypes() {
        hiddenFileExtensions = []
    }

    func open(root: URL) async {
        reloadTask?.cancel()
        let root = root.standardizedFileURL
        rootURL = root
        tree = nil
        treePaths = []
        mainFileURL = nil
        fileCount = 0
        guard let snapshot = await Self.makeSnapshot(root: root, keepingMainFile: nil, showsBuildFiles: showsBuildFiles) else { return }
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
        event.changesTree(showsBuildFiles: showsBuildFiles, isInTree: { treePaths.contains(SyncTeXIndex.normalizedPath($0)) },
                          exists: { FileManager.default.fileExists(atPath: $0.path) })
    }

    /// Lädt nur den Baum neu (z. B. nach Dateisystem-Ereignissen). Spätere Aufrufe verdrängen frühere.
    func reloadTree() {
        guard let root = rootURL else { return }
        reloadTask?.cancel()
        let currentMain = mainFileURL
        reloadTask = Task {
            guard let snapshot = await Self.makeSnapshot(root: root, keepingMainFile: currentMain, showsBuildFiles: showsBuildFiles),
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

    private nonisolated static func makeSnapshot(root: URL, keepingMainFile: URL?, showsBuildFiles: Bool) async -> ProjectSnapshot? {
        await Task.detached(priority: .utility) {
            let tree = FileTreeLoader.load(root: root, showsBuildFiles: showsBuildFiles)
            let main = keepingMainFile.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
                ?? MainFileDetector.detect(in: tree)
            return ProjectSnapshot(tree: tree, mainFile: main)
        }.value
    }
}
