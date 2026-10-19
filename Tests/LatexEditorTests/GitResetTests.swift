import AppKit
import Foundation
import Testing
@testable import LatexEditor

@Suite("Zurücksetzen: Plan")
struct GitResetPlanTests {
    private func change(_ path: String, _ kind: GitChangeKind, staged: Bool, from original: String? = nil) -> GitChange {
        GitChange(path: path, originalPath: original, kind: kind, isStaged: staged)
    }

    @Test("Geänderte, gelöschte und doppelt gelistete Dateien gehen auf HEAD, neue aus dem Index")
    func plan() {
        let plan = GitResetPlan.make(for: [
            change("a.tex", .modified, staged: true),
            change("a.tex", .modified, staged: false),
            change("weg.tex", .deleted, staged: false),
            change("neu.tex", .untracked, staged: false),
            change("neu2.tex", .added, staged: true),
            change("b2.tex", .renamed, staged: true, from: "b.tex"),
            change("konflikt.tex", .conflicted, staged: false),
        ], hasCommits: true)

        #expect(plan.restorePaths == ["a.tex", "weg.tex", "b.tex"])
        #expect(plan.newPaths == ["neu.tex", "neu2.tex", "b2.tex"])
    }

    @Test("Ohne ersten Commit ist alles neu")
    func withoutCommits() {
        let plan = GitResetPlan.make(for: [change("a.tex", .added, staged: true), change("a.tex", .modified, staged: false)], hasCommits: false)

        #expect(plan.restorePaths.isEmpty)
        #expect(plan.newPaths == ["a.tex"])
    }
}

extension AppModelSuite {
@Suite("Zurücksetzen auf den letzten Commit (App-Ebene)")
@MainActor
struct GitResetTests {
    private let model = AppModel.shared

    /// Ersatz-Papierkorb und Rückfrage; liefert den Papierkorb-Ordner.
    private func open(_ repository: TemporaryRepository, confirm: Bool = true) async throws -> (TemporaryProject, () -> [String]) {
        let trash = try TemporaryProject()
        model.git.extraEnvironment = TemporaryRepository.isolatedEnvironment
        model.moveToTrash = { url in
            try FileManager.default.moveItem(at: url, to: trash.root.appendingPathComponent(url.lastPathComponent))
        }
        var details: [String] = []
        model.confirmReset = { _, lines in details = lines; return confirm }
        await model.openProject(repository.root)
        return (trash, { details })
    }

    private func text(_ url: URL) throws -> String {
        try String(contentsOf: url, encoding: .utf8)
    }

    private func trashed(_ trash: TemporaryProject) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: trash.root.path).sorted()
    }

    @Test("Bereitgestellte Änderung (Fall vorwort.tex): ein Schritt, Datei bleibt sichtbar, Sicherung, Rückgängig")
    func stagedChangeInOneStep() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["front/vorwort.tex": "\\chapter{Vorwort}\n\n"])
        try repository.write("front/vorwort.tex", "\\chapter{Vorwort}\nMein Text.\n")
        try await repository.run("add", "front/vorwort.tex")
        let (trash, details) = try await open(repository)
        defer { trash.remove() }
        let url = repository.url("front/vorwort.tex")
        model.showChange(try #require(model.git.staged.first), keep: true)

        await model.resetToLastCommit(file: url)

        #expect(details() == ["vorwort.tex: 2 geänderte Zeilen gehen verloren"])
        #expect(FileManager.default.fileExists(atPath: url.path))
        #expect(try text(url) == "\\chapter{Vorwort}\n\n")
        #expect(!model.git.hasChanges)
        #expect(model.editor.tabs.activeFileURL == url, "Statt des geschlossenen Diff-Tabs ist die Datei zu sehen")
        #expect(model.editor.current?.textStorage.string == "\\chapter{Vorwort}\n\n")
        let backup = try #require(try trashed(trash).first)
        #expect(backup.hasPrefix("vorwort (verworfen "))
        #expect(try text(trash.root.appendingPathComponent(backup)) == "\\chapter{Vorwort}\nMein Text.\n")
        #expect(model.git.lastReset?.title == "„vorwort.tex“ zurückgesetzt")
        #expect(model.sidebar.tab == .changes)

        await model.undoLastReset()

        #expect(try text(url) == "\\chapter{Vorwort}\nMein Text.\n")
        #expect(model.editor.current?.textStorage.string == "\\chapter{Vorwort}\nMein Text.\n")
        #expect(model.git.unstaged.map(\.path) == ["front/vorwort.tex"])
        #expect(model.git.lastReset == nil)
    }

    @Test("Ungespeicherter Editortext wird mitgesichert und kommt mit Rückgängig zurück")
    func unsavedTextIsBackedUp() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "alt\n"])
        try repository.write("main.tex", "gespeichert\n")
        let (trash, _) = try await open(repository)
        defer { trash.remove() }
        let session = try #require(model.editor.current)
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: session.textStorage.length), with: "ungespeichert\n")

        await model.resetToLastCommit(file: repository.url("main.tex"))
        #expect(session.textStorage.string == "alt\n" && !session.isDirty)
        let backup = try #require(try trashed(trash).first)
        #expect(try text(trash.root.appendingPathComponent(backup)) == "ungespeichert\n")

        await model.undoLastReset()
        #expect(try text(repository.url("main.tex")) == "ungespeichert\n")
        #expect(session.textStorage.string == "ungespeichert\n")
    }

    @Test("Neue Dateien (nicht versioniert und bereitgestellt neu): Papierkorb, Tabs zu; Rückgängig holt sie samt Tab zurück")
    func newFiles() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "m\n"])
        try repository.write("neu.tex", "neu\n")
        try repository.write("neu2.tex", "neu2\n")
        try await repository.run("add", "neu2.tex")
        let (trash, details) = try await open(repository)
        defer { trash.remove() }
        await model.editor.open(repository.url("neu.tex"), asPreview: false)

        await model.resetToLastCommit(model.git.staged + model.git.unstaged)

        #expect(details().sorted() == ["neu.tex: neue Datei, kommt in den Papierkorb", "neu2.tex: neue Datei, kommt in den Papierkorb"])
        #expect(try trashed(trash) == ["neu.tex", "neu2.tex"])
        #expect(!model.git.hasChanges)
        #expect(!model.editor.tabs.contains(repository.url("neu.tex")))

        await model.undoLastReset()
        #expect(try text(repository.url("neu.tex")) == "neu\n")
        #expect(try text(repository.url("neu2.tex")) == "neu2\n")
        #expect(model.editor.tabs.contains(repository.url("neu.tex")))
        #expect(Set(model.git.unstaged.map(\.path)) == ["neu.tex", "neu2.tex"])
    }

    @Test("Gelöschte und umbenannte Dateien; Rückgängig stellt den Zustand davor her")
    func deletedAndRenamed() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["weg.tex": "w\n", "alt.tex": "a\n"])
        try FileManager.default.removeItem(at: repository.url("weg.tex"))
        try await repository.run("mv", "alt.tex", "neu.tex")
        let (trash, details) = try await open(repository)
        defer { trash.remove() }

        await model.resetToLastCommit(model.git.staged + model.git.unstaged)

        #expect(details().contains("weg.tex: wird wiederhergestellt"))
        #expect(try text(repository.url("weg.tex")) == "w\n")
        #expect(try text(repository.url("alt.tex")) == "a\n")
        #expect(!FileManager.default.fileExists(atPath: repository.url("neu.tex").path))
        #expect(!model.git.hasChanges)

        await model.undoLastReset()
        #expect(!FileManager.default.fileExists(atPath: repository.url("weg.tex").path))
        #expect(!FileManager.default.fileExists(atPath: repository.url("alt.tex").path))
        #expect(try text(repository.url("neu.tex")) == "a\n")
    }

    @Test("Abbrechen ändert nichts, auch nicht am Bereitgestellten")
    func cancelled() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "alt\n"])
        try repository.write("main.tex", "neu\n")
        try await repository.run("add", "main.tex")
        let (trash, _) = try await open(repository, confirm: false)
        defer { trash.remove() }

        await model.resetToLastCommit(file: repository.url("main.tex"))

        #expect(try text(repository.url("main.tex")) == "neu\n")
        #expect(model.git.staged.map(\.path) == ["main.tex"])
        #expect(try trashed(trash).isEmpty)
        #expect(model.git.lastReset == nil)
    }
}
}
