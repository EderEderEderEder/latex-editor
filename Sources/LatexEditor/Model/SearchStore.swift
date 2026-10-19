import Foundation
import Observation

/// Woher die Suche den Text einer Datei nimmt: offene Dateien aus dem Editor (auch ungespeichert), sonst von der Platte.
enum SearchSource: Sendable {
    case text(URL, String)
    case file(URL)
}

/// Zustand der Seitenleisten-Ansicht „Suchen“: Eingaben, Optionen und das letzte Ergebnis.
/// Gesucht wird entprellt im Hintergrund, nie pro Tastendruck im Text.
@MainActor
@Observable
final class SearchStore {
    static let delay = Duration.milliseconds(250)

    var query = "" {
        didSet { if query != oldValue { scheduleSearch() } }
    }
    var replacement = ""
    var options = SearchOptions() {
        didSet { if options != oldValue { scheduleSearch() } }
    }
    var showsReplace = false
    private(set) var result = SearchResult()
    private(set) var isSearching = false
    /// Meldung zur letzten Aktion („12 Ersetzungen in 3 Dateien …“)
    var notice: String?
    /// Neue ID: Suchfeld fokussieren (⇧⌘F)
    private(set) var focusRequest: UUID?

    @ObservationIgnored var sources: () -> [SearchSource] = { [] }
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    func requestFocus() {
        focusRequest = UUID()
    }

    /// Sucht entprellt neu (bei geänderter Eingabe, nach dem Speichern, nach dem Ersetzen).
    func scheduleSearch(immediately: Bool = false) {
        task?.cancel()
        generation += 1
        let currentGeneration = generation
        guard !query.isEmpty else {
            isSearching = false
            if !result.hits.isEmpty || result.isTruncated { result = SearchResult() }
            return
        }
        isSearching = true
        let query = query
        let options = options
        task = Task { [weak self] in
            if !immediately { try? await Task.sleep(for: Self.delay) }
            guard !Task.isCancelled, let self else { return }
            let sources = sources()
            let found = await Task.detached(priority: .userInitiated) {
                let documents = sources.compactMap { source -> (url: URL, text: String)? in
                    switch source {
                    case let .text(url, text): return (url, text)
                    case let .file(url): return Self.read(url).map { (url, $0) }
                    }
                }
                return ProjectSearch.search(query, options: options, in: documents)
            }.value
            guard !Task.isCancelled, currentGeneration == generation else { return }
            isSearching = false
            if result != found { result = found }
        }
    }

    func waitUntilIdle() async {
        await task?.value
    }

    func reset() {
        task?.cancel()
        generation += 1
        query = ""
        replacement = ""
        notice = nil
        isSearching = false
        result = SearchResult()
    }

    private nonisolated static func read(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
    }
}
