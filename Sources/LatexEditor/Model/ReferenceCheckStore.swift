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
    /// Dateien, deren Text sich seit der letzten Prüfung geändert hat: nur für sie werden die Schreibhinweise neu
    /// berechnet (sie hängen nicht vom Index ab, ein neuer Index prüft nur die Verweise)
    @ObservationIgnored private var needsHints: Set<URL> = []
    @ObservationIgnored private var generation = 0

    func problems(for url: URL) -> [ReferenceProblem] {
        problems[url.standardizedFileURL] ?? []
    }

    func hints(for url: URL) -> [WritingHint] {
        hints[url.standardizedFileURL] ?? []
    }

    /// Nach einer Textänderung oder beim Öffnen einer .tex-Datei; `includingHints: false` nach einem neuen Index
    func schedule(_ session: DocumentSession, immediately: Bool = false, includingHints: Bool = true) {
        let url = session.url.standardizedFileURL
        guard FileKind(url: url) == .tex else { return }
        if includingHints { needsHints.insert(url) }
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

    /// Verweise nur, wenn der Index gelesen ist; Schreibhinweise nur nach einer Textänderung.
    private func check(_ session: DocumentSession, url: URL) async {
        let currentGeneration = generation
        let labels = knownLabels()
        let citations = knownCitations()
        let text = session.textStorage.string
        let computesHints = needsHints.contains(url)
        // Zeilenzustände passend zum Text: Die Hinweise färben nur Zeilen mit Kandidaten nach, nicht den ganzen Text
        let syntax = computesHints ? session.syntaxSnapshot() : nil
        let (foundProblems, foundHints) = await Task.detached(priority: .utility) {
            let masked = LatexMasking.scannable(text)
            let problems = labels.map { ReferenceChecker.problems(masked: masked as NSString, labels: $0, citations: citations) } ?? []
            return (problems, computesHints ? WritingHints.hints(in: text, masked: masked, syntax: syntax) : nil)
        }.value
        // Abgebrochen: Eine neuere Prüfung derselben Datei läuft schon (und braucht ihren Hinweis-Auftrag noch)
        guard !Task.isCancelled, currentGeneration == generation, session.url.standardizedFileURL == url else { return }
        scheduled[url] = nil
        Self.set(foundProblems, for: url, in: &problems)
        if let foundHints {
            needsHints.remove(url)
            Self.set(foundHints, for: url, in: &hints)
        }
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
        for session in openSessions { schedule(session, immediately: true, includingHints: false) }
    }

    /// Tabs haben sich geändert: Probleme geschlossener Dateien vergessen.
    func retain(_ urls: Set<URL>) {
        for url in problems.keys where !urls.contains(url) { problems[url] = nil }
        for url in hints.keys where !urls.contains(url) { hints[url] = nil }
        needsHints.formIntersection(urls)
    }

    func reset() {
        generation += 1
        scheduled.values.forEach { $0.cancel() }
        scheduled = [:]
        needsHints = []
        if !problems.isEmpty { problems = [:] }
        if !hints.isEmpty { hints = [:] }
        unusedLabels = []
        unusedSources = []
    }
}
