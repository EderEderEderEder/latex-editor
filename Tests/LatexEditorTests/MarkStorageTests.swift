import Foundation
import Testing
@testable import LatexEditor

@MainActor
@Suite("PDF-Markierungen: Speichern")
struct MarkStorageTests {
    private func sampleMark(_ comment: String = "") -> PDFMark {
        let anchor = MarkAnchor(path: "kapitel/a.tex", line: 4, text: "Text", before: "davor", after: "danach", words: ["text"])
        return PDFMark(id: UUID(), color: .green, comment: comment, text: "Text", start: anchor, end: anchor, pageHint: 2, createdAt: Date(timeIntervalSince1970: 1_700_000_000))
    }

    private func makeDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("marks-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private let root = URL(fileURLWithPath: "/tmp/projekt-a")

    @Test("Speichern und Laden ergeben dasselbe; ohne Datei ist es leer; jedes Projekt hat seine eigene Datei")
    func roundTrip() throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        #expect(try MarkStorage.load(root: root, in: directory).isEmpty)

        let mark = sampleMark("Prüfen")
        try MarkStorage.save([mark], root: root, in: directory)
        #expect(try MarkStorage.load(root: root, in: directory) == [mark])
        #expect(try MarkStorage.load(root: URL(fileURLWithPath: "/tmp/projekt-b"), in: directory).isEmpty)
        #expect(MarkStorage.fileURL(for: root, in: directory) != MarkStorage.fileURL(for: URL(fileURLWithPath: "/tmp/projekt-b"), in: directory))
        #expect(MarkStorage.fileURL(for: root, in: directory) == MarkStorage.fileURL(for: URL(fileURLWithPath: "/tmp/projekt-a/"), in: directory))
    }

    @Test("Eine unlesbare Datei wird gemeldet und beiseitegelegt, nicht überschrieben")
    func corruptFile() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = MarkStorage.fileURL(for: root, in: directory)
        try Data("kein json".utf8).write(to: file)

        let store = MarkStore(directory: directory)
        var problems: [String] = []
        store.onProblem = { problems.append($0) }
        store.load(root: root)
        #expect(store.marks.isEmpty)
        #expect(problems.count == 1)
        #expect(!FileManager.default.fileExists(atPath: file.path))
        let kept = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.contains("defekt") }
        #expect(kept.count == 1, "Die defekte Datei bleibt erhalten")

        store.add(sampleMark())
        await store.flush()
        #expect(try MarkStorage.load(root: root, in: directory).count == 1)
    }

    @Test("Eine Datei aus einer neueren Version wird nicht verändert")
    func newerVersion() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = MarkStorage.fileURL(for: root, in: directory)
        let original = Data(#"{"version": 99, "projectPath": "/tmp/projekt-a", "marks": []}"#.utf8)
        try original.write(to: file)

        let store = MarkStore(directory: directory)
        var problems: [String] = []
        store.onProblem = { problems.append($0) }
        store.load(root: root)
        store.add(sampleMark())
        await store.flush()
        #expect(problems.count == 1)
        #expect(try Data(contentsOf: file) == original)
    }

    @Test("Beim Beenden steht die letzte Änderung sofort auf der Platte, ohne auf das Speichern im Hintergrund zu warten")
    func saveNowWritesImmediately() throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MarkStore(directory: directory, defaults: temporaryDefaults())
        store.load(root: root)
        let mark = sampleMark("kurz vor dem Beenden")
        store.add(mark)

        // Ohne `await`: Das Speichern im Hintergrund hat noch nicht begonnen
        store.saveNow()

        #expect(try MarkStorage.load(root: root, in: directory) == [mark])
    }

    @Test("Hinzufügen, Ändern und Entfernen werden gespeichert und beim nächsten Laden wiedergefunden")
    func storeEdits() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MarkStore(directory: directory)
        store.load(root: root)
        let first = sampleMark("eins")
        let second = sampleMark("zwei")
        store.add(first)
        store.add(second)
        store.update(first.id) { $0.comment = "geändert"; $0.color = .pink }
        store.remove(second.id)
        await store.flush()

        let reloaded = MarkStore(directory: directory)
        reloaded.load(root: root)
        #expect(reloaded.marks.map(\.comment) == ["geändert"])
        #expect(reloaded.marks.first?.color == .pink)

        reloaded.remove(UUID())
        reloaded.update(UUID()) { $0.comment = "x" }
        #expect(reloaded.marks.count == 1, "Unbekannte Markierungen ändern nichts")
    }

    @Test("Der Standardordner liegt im Test-Prozess nicht im Programmordner des Nutzers")
    func defaultDirectoryInTests() {
        #expect(!MarkStorage.defaultDirectory().path.contains("Application Support"))
    }
}

@MainActor
@Suite("PDF-Markierungen: Dateien umbenennen und alte Dateien")
struct MarkRelocationTests {
    private func mark(path: String) -> PDFMark {
        let anchor = MarkAnchor(path: path, line: 1, text: "Text", before: "", after: "", words: [])
        return PDFMark(id: UUID(), color: .blue, comment: "", text: "Text", start: anchor, end: anchor, pageHint: 1, createdAt: Date())
    }

    @Test("Beim Umbenennen oder Verschieben ziehen die Anker mit, auch bei Ordnern, und werden gespeichert")
    func relocate() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("marks-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let root = URL(fileURLWithPath: "/tmp/projekt-umbenennen")
        let store = MarkStore(directory: directory, defaults: temporaryDefaults())
        store.load(root: root)
        let single = mark(path: "kapitel/a.tex")
        let inFolder = mark(path: "kapitel/sub/b.tex")
        let other = mark(path: "anderes/c.tex")
        [single, inFolder, other].forEach { store.add($0) }

        store.relocate(from: root.appendingPathComponent("kapitel/a.tex"), to: root.appendingPathComponent("kapitel/neu.tex"))
        store.relocate(from: root.appendingPathComponent("kapitel"), to: root.appendingPathComponent("teile"))
        #expect(store.marks.map(\.start.path) == ["teile/neu.tex", "teile/sub/b.tex", "anderes/c.tex"])
        #expect(store.marks.map(\.end.path) == ["teile/neu.tex", "teile/sub/b.tex", "anderes/c.tex"])

        store.relocate(from: URL(fileURLWithPath: "/woanders/x.tex"), to: URL(fileURLWithPath: "/woanders/y.tex"))
        #expect(store.marks.count == 3, "Außerhalb des Projekts ändert sich nichts")
        await store.flush()
        let reloaded = MarkStore(directory: directory, defaults: temporaryDefaults())
        reloaded.load(root: root)
        #expect(reloaded.marks.map(\.start.path) == ["teile/neu.tex", "teile/sub/b.tex", "anderes/c.tex"])
    }

    @Test("Eine Datei aus der Zeit vor den Notizen (ohne „kind“) wird als Textmarker gelesen")
    func decodesOldFormat() throws {
        let json = #"""
        {"id":"6F1F3C58-0000-4000-8000-000000000001","color":"pink","comment":"","text":"Text","pageHint":3,"createdAt":"2026-11-02T10:00:00Z",
         "start":{"path":"a.tex","line":1,"text":"Text","before":"","after":"","words":["text"]},
         "end":{"path":"a.tex","line":1,"text":"Text","before":"","after":"","words":["text"]}}
        """#
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let mark = try decoder.decode(PDFMark.self, from: Data(json.utf8))
        #expect(mark.kind == .highlight)
        #expect(mark.color == .pink)
        let notes = try JSONEncoder().encode(PDFMark(id: UUID(), kind: .note, color: .blue, comment: "x", text: "", start: mark.start, end: mark.end, pageHint: 1, createdAt: Date()))
        #expect(try JSONDecoder().decode(PDFMark.self, from: notes).kind == .note)
    }
}
