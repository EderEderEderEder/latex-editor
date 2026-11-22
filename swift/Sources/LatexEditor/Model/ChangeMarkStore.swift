import Foundation
import Observation

/// Änderungsmarken der offenen Dateien gegenüber HEAD. Verglichen wird der aktuelle Editortext
/// (auch ungespeichert), 0,3 s nach der letzten Eingabe und im Hintergrund – pro Tastendruck passiert
/// nur das Neustarten eines Timers. Der Stand aus HEAD wird pro Datei einmal gelesen und beim
/// nächsten Commit, Pull oder Branch-Wechsel verworfen.
@MainActor
@Observable
final class ChangeMarkStore {
    static let delay = Duration.milliseconds(300)

    private(set) var marks: [URL: ChangeMarks] = [:]

    /// Inhalt der Datei in HEAD, `nil` wenn sie dort nicht existiert oder es kein Repository gibt
    @ObservationIgnored var loadBase: (URL) async -> Data? = { _ in nil }
    @ObservationIgnored private var bases: [URL: String] = [:]
    /// Dateien ohne Stand in HEAD (neu, kein Repository) – keine Marken
    @ObservationIgnored private var filesWithoutBase: Set<URL> = []
    @ObservationIgnored private var baseCommit: String?
    @ObservationIgnored private var scheduled: [URL: Task<Void, Never>] = [:]
    @ObservationIgnored private var generation = 0

    func marks(for url: URL) -> ChangeMarks {
        marks[url.standardizedFileURL] ?? ChangeMarks()
    }

    /// Nach einer Textänderung oder beim Öffnen: Neuberechnung entprellt vormerken.
    func schedule(_ session: DocumentSession) {
        let url = session.url.standardizedFileURL
        scheduled[url]?.cancel()
        scheduled[url] = Task { [weak self, weak session] in
            try? await Task.sleep(for: Self.delay)
            guard !Task.isCancelled, let self, let session else { return }
            await self.update(session)
        }
    }

    /// HEAD hat sich (vielleicht) geändert. Nur bei einem anderen Commit werden die Stände neu gelesen.
    func headChanged(to commit: String?, openSessions: [DocumentSession]) {
        guard commit != baseCommit else { return }
        // Laufende Berechnungen gegen den alten Stand verwerfen
        generation += 1
        baseCommit = commit
        bases = [:]
        filesWithoutBase = []
        for session in openSessions { schedule(session) }
    }

    /// Marken geschlossener Dateien vergessen.
    func retain(_ urls: Set<URL>) {
        for url in marks.keys where !urls.contains(url) { marks[url] = nil }
        for url in bases.keys where !urls.contains(url) { bases[url] = nil }
    }

    /// Beim Projektwechsel
    func reset() {
        generation += 1
        scheduled.values.forEach { $0.cancel() }
        scheduled = [:]
        bases = [:]
        filesWithoutBase = []
        baseCommit = nil
        if !marks.isEmpty { marks = [:] }
    }

    /// Sofort berechnen (Tests und nach dem Öffnen); `schedule` ist der Normalfall.
    func update(_ session: DocumentSession) async {
        let url = session.url.standardizedFileURL
        let currentGeneration = generation
        guard let base = await base(for: url), currentGeneration == generation else {
            if marks[url] != nil { marks[url] = nil }
            return
        }
        let text = session.textStorage.string
        let computed = await Task.detached(priority: .utility) { ChangeMarks.compute(base: base, current: text) }.value
        guard currentGeneration == generation, session.url.standardizedFileURL == url, marks[url] != computed else { return }
        marks[url] = computed
    }

    private func base(for url: URL) async -> String? {
        if let cached = bases[url] { return cached }
        if filesWithoutBase.contains(url) { return nil }
        guard let data = await loadBase(url),
              let text = ProjectText.decode(data)?.text else {
            filesWithoutBase.insert(url)
            return nil
        }
        bases[url] = text
        return text
    }
}
