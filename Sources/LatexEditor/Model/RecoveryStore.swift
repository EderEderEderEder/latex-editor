import Foundation

/// Gesicherter, ungespeicherter Stand einer Datei.
struct RecoveryBackup: Codable, Equatable, Sendable {
    let path: String
    let savedAt: Date
    let text: String

    var url: URL { URL(fileURLWithPath: path) }
}

/// Automatische Sicherung ungespeicherter Texte: einige Sekunden nach der letzten Eingabe landet der Text
/// in einem eigenen Ordner der App. Nach einem Absturz bietet die App beim Öffnen des Projekts an, ihn
/// wiederherzustellen. Speichern oder ein bewusstes „Nicht speichern“ löscht die Sicherung.
@MainActor
final class RecoveryStore {
    static let defaultSaveDelay = Duration.seconds(5)
    private nonisolated static let appProcessName = "LatexEditor"

    /// Austauschbar für Tests
    var directory: URL
    var saveDelay = RecoveryStore.defaultSaveDelay
    private var scheduled: [URL: Task<Void, Never>] = [:]

    init(directory: URL = RecoveryStore.defaultDirectory()) {
        self.directory = directory
    }

    /// Im App-Prozess: „Application Support/LatexEditor/Wiederherstellung“. In jedem anderen Prozess
    /// (Tests) ein Temp-Ordner, damit Tests nie die Sicherungen des Nutzers berühren.
    nonisolated static func defaultDirectory() -> URL {
        guard ProcessInfo.processInfo.processName == appProcessName,
              let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return FileManager.default.temporaryDirectory.appendingPathComponent("LatexEditor-Wiederherstellung-\(ProcessInfo.processInfo.processIdentifier)")
        }
        return support.appendingPathComponent("LatexEditor/Wiederherstellung", isDirectory: true)
    }

    /// Nach einer Bearbeitung: Sicherung vormerken, solange die Datei ungespeichert ist. Gelöscht wird nur
    /// beim Speichern und bei „Nicht speichern“ – nicht hier: Beim Öffnen (Tabs wiederherstellen) meldet sich
    /// die Datei als unverändert, die Sicherung muss aber bis zur Rückfrage erhalten bleiben.
    func schedule(_ session: DocumentSession) {
        let url = session.url.standardizedFileURL
        scheduled[url]?.cancel()
        scheduled[url] = nil
        guard session.isDirty else { return }
        scheduled[url] = Task { [weak self, weak session] in
            try? await Task.sleep(for: self?.saveDelay ?? Self.defaultSaveDelay)
            guard !Task.isCancelled, let self, let session, session.isDirty else { return }
            await self.write(RecoveryBackup(path: url.path, savedAt: Date(), text: session.textStorage.string))
        }
    }

    /// Sofort sichern (Tests, vor riskanten Vorgängen)
    func write(_ backup: RecoveryBackup) async {
        let file = fileURL(for: backup.url)
        let directory = directory
        await Task.detached(priority: .utility) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard let data = try? JSONEncoder().encode(backup) else { return }
            try? data.write(to: file, options: .atomic)
        }.value
    }

    func remove(for url: URL) {
        scheduled[url.standardizedFileURL]?.cancel()
        scheduled[url.standardizedFileURL] = nil
        try? FileManager.default.removeItem(at: fileURL(for: url))
    }

    /// Sicherungen für Dateien im Projektordner, die sich vom Stand auf der Platte unterscheiden.
    /// Veraltete (gleicher Text wie auf der Platte) werden dabei gelöscht.
    func backups(under root: URL) -> [RecoveryBackup] {
        let prefix = root.standardizedFileURL.path + "/"
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        var result: [RecoveryBackup] = []
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file), let backup = try? JSONDecoder().decode(RecoveryBackup.self, from: data),
                  backup.path.hasPrefix(prefix) else { continue }
            let onDisk = try? String(contentsOf: backup.url, encoding: .utf8)
            if onDisk == backup.text {
                try? FileManager.default.removeItem(at: file)
            } else {
                result.append(backup)
            }
        }
        return result.sorted { $0.path < $1.path }
    }

    /// Ein Dateiname pro Pfad (FNV-1a, stabil über App-Starts)
    func fileURL(for url: URL) -> URL {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in url.standardizedFileURL.path.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return directory.appendingPathComponent(String(hash, radix: 16) + ".json")
    }
}
