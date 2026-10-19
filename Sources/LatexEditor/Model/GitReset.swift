import Foundation

/// Was „Auf letzten Commit zurücksetzen“ mit einer Auswahl von Änderungen tut – bereitgestellt oder
/// nicht, in einem Schritt. Reine Logik.
struct GitResetPlan: Equatable, Sendable {
    /// Pfade, die es im letzten Commit gibt: Index und Arbeitsverzeichnis gehen auf diesen Stand zurück
    var restorePaths: [String] = []
    /// Pfade, die es dort nicht gibt (neu, bereitgestellt neu, Ziel einer Umbenennung): aus dem Index
    /// nehmen; die Datei selbst kommt in den Papierkorb
    var newPaths: [String] = []

    var allPaths: [String] { restorePaths + newPaths }
    var isEmpty: Bool { allPaths.isEmpty }

    /// Konflikte werden ausgelassen (sie löst man im Editor, nicht durch Zurücksetzen).
    static func make(for changes: [GitChange], hasCommits: Bool) -> GitResetPlan {
        let relevant = changes.filter { $0.kind != .conflicted }
        let newKinds: Set<GitChangeKind> = [.added, .untracked, .renamed, .copied]
        var newPaths = Set(relevant.filter { !hasCommits || newKinds.contains($0.kind) }.map(\.path))
        if !hasCommits { newPaths.formUnion(relevant.compactMap(\.originalPath)) }
        var plan = GitResetPlan()
        var seen: Set<String> = []
        for path in relevant.flatMap({ [$0.path] + ($0.originalPath.map { [$0] } ?? []) }) where seen.insert(path).inserted {
            if newPaths.contains(path) { plan.newPaths.append(path) } else { plan.restorePaths.append(path) }
        }
        return plan
    }
}

/// Stand der Dateien vor dem Zurücksetzen (inklusive ungespeichertem Editortext), für „Rückgängig“.
struct ResetSnapshot: Equatable, Sendable {
    struct Entry: Equatable, Sendable {
        let url: URL
        /// `nil`: Die Datei gab es vorher nicht (z. B. gelöscht), „Rückgängig“ entfernt sie wieder.
        let contents: Data?
        /// Hatte einen offenen Tab (wird nach „Rückgängig“ wieder geöffnet)
        let wasOpen: Bool
    }

    let entries: [Entry]

    var title: String {
        entries.count == 1 ? "„\(entries[0].url.lastPathComponent)“ zurückgesetzt" : "\(entries.count) Dateien zurückgesetzt"
    }
}
