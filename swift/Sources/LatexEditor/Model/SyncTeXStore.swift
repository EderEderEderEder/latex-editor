import Foundation
import Observation

/// Hält die SyncTeX-Daten des letzten Builds und die Einstellung „PDF folgt Cursor“.
/// Geladen wird im Hintergrund; schlägt das Laden fehl (Datei fehlt oder ist noch unvollständig),
/// bleiben die bisherigen Daten erhalten.
@MainActor
@Observable
final class SyncTeXStore {
    private static let followCursorKey = "pdfFollowsCursor"
    private static let fileExtensions = ["synctex.gz", "synctex"]

    var followCursor: Bool {
        didSet { defaults.set(followCursor, forKey: Self.followCursorKey) }
    }

    @ObservationIgnored private(set) var index: SyncTeXIndex?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        followCursor = defaults.bool(forKey: Self.followCursorKey)
    }

    /// `main.synctex.gz` (oder unkomprimiert `main.synctex`) neben der Hauptdatei.
    static func dataURL(for mainFile: URL) -> URL? {
        let base = mainFile.deletingPathExtension()
        return fileExtensions
            .map { base.appendingPathExtension($0) }
            .first { FileManager.default.fileExists(atPath: $0.path) }
    }

    func reload(mainFile: URL?) {
        loadTask?.cancel()
        guard let mainFile, let url = Self.dataURL(for: mainFile) else { return }
        loadTask = Task {
            let loaded = await Task.detached(priority: .utility) { try? SyncTeXIndex.load(contentsOf: url) }.value
            guard !Task.isCancelled, let loaded else { return }
            index = loaded
        }
    }

    /// Wartet auf ein laufendes Laden (für Tests und Abläufe direkt nach einem Build).
    func waitUntilLoaded() async {
        await loadTask?.value
    }

    func reset() {
        loadTask?.cancel()
        loadTask = nil
        index = nil
    }

    func forward(file: URL, line: Int) -> SyncTeXBox? {
        index?.forward(file: file, line: line)
    }

    func backward(page: Int, point: CGPoint) -> SyncTeXSourceLocation? {
        index?.backward(page: page, point: point)
    }
}
