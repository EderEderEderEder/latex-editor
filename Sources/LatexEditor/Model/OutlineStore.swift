import Foundation
import Observation

@MainActor
@Observable
final class OutlineStore {
    private(set) var entries: [OutlineEntry] = []
    private(set) var tree: [OutlineNode] = []
    private(set) var includingFile: [URL: URL] = [:]
    /// Abschnitt an der Cursorposition (wird nur gesetzt, wenn er sich ändert).
    private(set) var currentEntryID: String?

    @ObservationIgnored private var cursor: (file: URL, line: Int)?

    @ObservationIgnored private let parser = OutlineParser()
    @ObservationIgnored private var refreshTask: Task<Void, Never>?

    /// Parst im Hintergrund neu; unveränderte Dateien kommen aus dem Cache des Parsers.
    func refresh(mainFile: URL?) {
        refreshTask?.cancel()
        guard let mainFile else {
            entries = []
            tree = []
            includingFile = [:]
            currentEntryID = nil
            return
        }
        refreshTask = Task { [parser] in
            let result = await parser.outline(mainFile: mainFile)
            guard !Task.isCancelled else { return }
            apply(result)
        }
    }

    /// Include-Kette von der Hauptdatei bis `file` (z. B. main.tex, einleitung.tex).
    func includeChain(to file: URL, mainFile: URL?) -> [URL] {
        Self.includeChain(to: file, mainFile: mainFile, includingFile: includingFile)
    }

    nonisolated static func includeChain(to file: URL, mainFile: URL?, includingFile: [URL: URL]) -> [URL] {
        var chain = [file]
        var visited: Set<URL> = [file]
        while let parent = includingFile[chain[0]], visited.insert(parent).inserted {
            chain.insert(parent, at: 0)
        }
        if let mainFile, chain[0] != mainFile.standardizedFileURL, file != mainFile.standardizedFileURL {
            return [file]
        }
        return chain
    }

    /// Vom Editor entprellt gemeldete Cursorposition (1-basierte Zeile).
    func updateCursor(file: URL, line: Int) {
        cursor = (file, line)
        updateCurrentEntry()
    }

    private func updateCurrentEntry() {
        let newID = cursor.flatMap { OutlineTree.currentEntry(in: entries, file: $0.file, line: $0.line)?.id }
        if newID != currentEntryID { currentEntryID = newID }
    }

    private func apply(_ result: OutlineResult) {
        if result.entries != entries {
            entries = result.entries
            tree = OutlineTree.build(result.entries)
            updateCurrentEntry()
        }
        if result.includingFile != includingFile { includingFile = result.includingFile }
    }
}
