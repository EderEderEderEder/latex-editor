import Foundation
import Observation

/// Wörter pro Datei und im Projekt für die Statusleiste. Gezählt wird nie pro Tastendruck, sondern entprellt im
/// Hintergrund: offene Dateien aus dem Editortext (auch ungespeichert), alle anderen von der Platte, mit
/// Zwischenspeicher nach Änderungsdatum und Größe.
@MainActor
@Observable
final class WordCountStore {
    static let delay = Duration.milliseconds(500)

    /// Wörter der Dateien mit Tab (Stand des Editortexts)
    private(set) var openFileWords: [URL: Int] = [:]
    /// Wörter aller Dateien, die vom Hauptdokument eingebunden werden; `nil`, solange es nichts zu zählen gibt
    private(set) var projectWords: Int?

    /// Hauptdatei und alles, was sie einbindet
    @ObservationIgnored var projectFiles: () -> [URL] = { [] }
    @ObservationIgnored private let cache = DiskWordCache()
    @ObservationIgnored private var scheduledFiles: [URL: Task<Void, Never>] = [:]
    @ObservationIgnored private var projectTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    func words(inOpenFile url: URL) -> Int? {
        openFileWords[url.standardizedFileURL]
    }

    /// Nach einer Textänderung oder beim Öffnen: Zählung der Datei vormerken (setzt eine frühere zurück).
    func schedule(_ session: DocumentSession) {
        let url = session.url.standardizedFileURL
        scheduledFiles[url]?.cancel()
        scheduledFiles[url] = Task { [weak self, weak session] in
            try? await Task.sleep(for: Self.delay)
            guard !Task.isCancelled, let self, let session else { return }
            await self.count(session, url: url)
        }
    }

    private func count(_ session: DocumentSession, url: URL) async {
        let currentGeneration = generation
        let text = session.textStorage.string
        let words = await Task.detached(priority: .utility) { WordCounter.count(in: text) }.value
        guard currentGeneration == generation, session.url.standardizedFileURL == url else { return }
        scheduledFiles[url] = nil
        if openFileWords[url] != words { openFileWords[url] = words }
        refreshProject()
    }

    /// Projektsumme neu bilden (entprellt); `immediately` für Tests.
    func refreshProject(immediately: Bool = false) {
        projectTask?.cancel()
        let currentGeneration = generation
        projectTask = Task { [weak self] in
            if !immediately { try? await Task.sleep(for: Self.delay) }
            guard !Task.isCancelled, let self else { return }
            await self.sumProject(generation: currentGeneration)
        }
    }

    func waitUntilIdle() async {
        await projectTask?.value
    }

    private func sumProject(generation expected: Int) async {
        let files = projectFiles().map(\.standardizedFileURL)
        guard !files.isEmpty else {
            if projectWords != nil { projectWords = nil }
            return
        }
        let known = openFileWords
        let cache = cache
        let total = await Task.detached(priority: .utility) {
            var sum = 0
            for file in files { sum += known[file] ?? cache.words(in: file) }
            return sum
        }.value
        guard !Task.isCancelled, expected == generation else { return }
        if projectWords != total { projectWords = total }
    }

    /// Tabs haben sich geändert: Zählungen geschlossener Dateien verwerfen (ihr Text könnte verworfen worden sein).
    func retain(_ urls: Set<URL>) {
        let stale = openFileWords.keys.filter { !urls.contains($0) }
        guard !stale.isEmpty else { return }
        for url in stale {
            openFileWords[url] = nil
            scheduledFiles[url]?.cancel()
            scheduledFiles[url] = nil
        }
        refreshProject()
    }

    /// Beim Projektwechsel
    func reset() {
        generation += 1
        scheduledFiles.values.forEach { $0.cancel() }
        scheduledFiles = [:]
        projectTask?.cancel()
        projectTask = nil
        if !openFileWords.isEmpty { openFileWords = [:] }
        projectWords = nil
        cache.removeAll()
    }
}

/// Zählung von Dateien auf der Platte, gemerkt nach Änderungsdatum und Größe. Wird nur aus Hintergrundaufgaben benutzt.
private final class DiskWordCache: @unchecked Sendable {
    private struct Entry {
        let stamp: String
        let words: Int
    }

    private let lock = NSLock()
    private var entries: [URL: Entry] = [:]

    func words(in url: URL) -> Int {
        let stamp = Self.stamp(of: url)
        lock.lock()
        let cached = entries[url]
        lock.unlock()
        if let cached, cached.stamp == stamp { return cached.words }
        guard let data = try? Data(contentsOf: url) else { return 0 }
        let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        let words = WordCounter.count(in: text)
        lock.lock()
        entries[url] = Entry(stamp: stamp, words: words)
        lock.unlock()
        return words
    }

    func removeAll() {
        lock.lock()
        entries = [:]
        lock.unlock()
    }

    private static func stamp(of url: URL) -> String {
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        return "\(values?.contentModificationDate?.timeIntervalSince1970 ?? 0)-\(values?.fileSize ?? 0)"
    }
}
