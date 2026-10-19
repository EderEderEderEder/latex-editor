import Foundation
import Observation

/// Prüft offene .tex-Dateien auf Verweise und Zitate ohne Ziel (rote Unterstreichung im Text) und auf Schreibhinweise
/// (`WritingHints`, blau gepunktet) und sammelt Hinweise auf ungenutzte Labels und Quellen. Gescannt wird entprellt im
/// Hintergrund, nie pro Tastendruck.
@MainActor
@Observable
final class ReferenceCheckStore {
    static let delay = Duration.milliseconds(600)

    /// Probleme pro offener Datei
    private(set) var problems: [URL: [ReferenceProblem]] = [:]
    /// Schreibhinweise pro offener Datei
    private(set) var hints: [URL: [WritingHint]] = [:]
    /// Labels, die nirgends verwendet werden (nach Datei und Zeile sortiert)
    private(set) var unusedLabels: [LabelEntry] = []
    /// Quellen der Literaturdatei, die nirgends zitiert werden
    private(set) var unusedSources: [BibEntry] = []

    /// `nil`: nicht prüfen (Index noch nicht gelesen)
    @ObservationIgnored var knownLabels: () -> Set<String>? = { nil }
    /// `nil`: Zitate nicht prüfen
    @ObservationIgnored var knownCitations: () -> Set<String>? = { nil }
    @ObservationIgnored private var scheduled: [URL: Task<Void, Never>] = [:]
    @ObservationIgnored private var generation = 0

    func problems(for url: URL) -> [ReferenceProblem] {
        problems[url.standardizedFileURL] ?? []
    }

    func hints(for url: URL) -> [WritingHint] {
        hints[url.standardizedFileURL] ?? []
    }

    /// Nach einer Textänderung oder beim Öffnen einer .tex-Datei
    func schedule(_ session: DocumentSession, immediately: Bool = false) {
        let url = session.url.standardizedFileURL
        guard FileKind(url: url) == .tex else { return }
        scheduled[url]?.cancel()
        scheduled[url] = Task { [weak self, weak session] in
            if !immediately { try? await Task.sleep(for: Self.delay) }
            guard !Task.isCancelled, let self, let session else { return }
            await self.check(session, url: url)
        }
    }

    func waitUntilIdle() async {
        for task in Array(scheduled.values) { await task.value }
    }

    /// Verweise nur, wenn der Index gelesen ist; Schreibhinweise immer.
    private func check(_ session: DocumentSession, url: URL) async {
        let currentGeneration = generation
        let labels = knownLabels()
        let citations = knownCitations()
        let text = session.textStorage.string
        let (foundProblems, foundHints) = await Task.detached(priority: .utility) {
            let problems = labels.map { ReferenceChecker.problems(in: text, labels: $0, citations: citations) } ?? []
            return (problems, WritingHints.hints(in: text))
        }.value
        guard currentGeneration == generation, session.url.standardizedFileURL == url else { return }
        scheduled[url] = nil
        Self.set(foundProblems, for: url, in: &problems)
        Self.set(foundHints, for: url, in: &hints)
    }

    /// Nur bei Änderung setzen, damit der Editor nicht ohne Grund neu bewertet wird
    private static func set<Element: Equatable>(_ list: [Element], for url: URL, in storage: inout [URL: [Element]]) {
        if list.isEmpty {
            if storage[url] != nil { storage[url] = nil }
        } else if storage[url] != list {
            storage[url] = list
        }
    }

    /// Der Projektindex ist neu: Hinweise ableiten, alle offenen Dateien neu prüfen.
    func indexChanged(_ index: CompletionIndex, isLoaded: Bool, openSessions: [DocumentSession]) {
        let labels = isLoaded ? index.catalog.labels.filter { !index.usedLabels.contains($0.label) } : []
        let sources = isLoaded && !index.citesEverything ? index.catalog.bibEntries.filter { !index.usedCitations.contains($0.key) } : []
        if unusedLabels != labels { unusedLabels = labels }
        if unusedSources != sources { unusedSources = sources }
        for session in openSessions { schedule(session, immediately: true) }
    }

    /// Tabs haben sich geändert: Probleme geschlossener Dateien vergessen.
    func retain(_ urls: Set<URL>) {
        for url in problems.keys where !urls.contains(url) { problems[url] = nil }
        for url in hints.keys where !urls.contains(url) { hints[url] = nil }
    }

    func reset() {
        generation += 1
        scheduled.values.forEach { $0.cancel() }
        scheduled = [:]
        if !problems.isEmpty { problems = [:] }
        if !hints.isEmpty { hints = [:] }
        unusedLabels = []
        unusedSources = []
    }
}
