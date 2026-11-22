import Foundation
import Testing
@testable import LatexEditor

@Suite("GitStore (echte temporäre Repositories)")
@MainActor
struct GitStoreTests {
    private func lastCommitMessage(_ repository: TemporaryRepository) async throws -> String {
        try await repository.run("log", "-1", "--format=%B").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func diffLines(_ store: GitStore, _ url: URL) -> [String] {
        guard case let .loaded(diff)? = store.diffs[url]?.state, case let .text(lines) = diff.content else { return [] }
        return lines.map(Self.render)
    }

    private static func render(_ line: DiffLine) -> String {
        switch line.kind {
        case .context: " " + line.text
        case .removed: "-" + line.text
        case .added: "+" + line.text
        }
    }

    /// Öffnet den Diff wie ein Klick in der Liste (ein Diff-Tab, aktiv) und wartet, bis er geladen ist.
    @discardableResult
    private func showDiff(_ store: GitStore, _ change: GitChange?) async throws -> URL {
        let change = try #require(change)
        let url = try #require(store.url(for: change))
        store.prepareDiff(for: change)
        store.updateDiffTabs(open: [url], active: url)
        try await waitForDiff(store, url)
        return url
    }

    private func waitForDiff(_ store: GitStore, _ url: URL) async throws {
        let attempts = 200
        for _ in 0..<attempts where store.diffs[url]?.state == .loading { try await Task.sleep(for: .milliseconds(10)) }
        #expect(store.diffs[url]?.state != .loading)
    }

    @Test("Kein Repository, kein Git")
    func availability() async throws {
        let folder = try TemporaryProject()
        defer { folder.remove() }
        let store = GitStore()
        await store.open(project: folder.root)
        #expect(store.availability == .notRepository)

        let withoutGit = GitStore(locate: { nil })
        await withoutGit.open(project: folder.root)
        #expect(withoutGit.availability == .unavailable(GitLocator.missingMessage))
    }

    @Test("Status: Listen, Branch, Markierungen für Dateien und Ordner")
    func status() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n", "kapitel/eins.tex": "1\n"])
        try repository.write("kapitel/eins.tex", "1 geändert\n")
        try repository.write("bilder/logo.png", "PNG")
        try repository.write("main.tex", "b\n")
        try await repository.run("add", "main.tex")

        let store = repository.makeStore()
        await store.open(project: repository.root)

        #expect(store.availability == .ready)
        #expect(store.branch.head == "main")
        #expect(store.staged.map(\.path) == ["main.tex"])
        #expect(store.unstaged.map(\.path) == ["kapitel/eins.tex", "bilder/logo.png"])
        #expect(store.marker(for: repository.url("kapitel/eins.tex")) == .modified)
        #expect(store.marker(for: repository.url("bilder/logo.png")) == .untracked)
        #expect(store.containsChanges(repository.url("kapitel")))
        #expect(!store.containsChanges(repository.root))
        #expect(store.changeCount == 3)
    }

    @Test("Bereitstellen und zurücknehmen, einzeln und alle")
    func stageAndUnstage() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["a.tex": "a\n", "weg.tex": "w\n"])
        try repository.write("a.tex", "A\n")
        try repository.write("neu.tex", "n\n")
        try FileManager.default.removeItem(at: repository.url("weg.tex"))
        let store = repository.makeStore()
        await store.open(project: repository.root)

        await store.stage(store.unstaged.filter { $0.path == "neu.tex" })
        #expect(store.staged.map(\.path) == ["neu.tex"])
        #expect(store.staged.first?.kind == .added)

        await store.stageAll()
        #expect(Set(store.staged.map(\.path)) == ["a.tex", "neu.tex", "weg.tex"])
        #expect(store.unstaged.isEmpty)

        await store.unstage(store.staged.filter { $0.path == "weg.tex" })
        #expect(store.unstaged.map(\.kind) == [.deleted])

        await store.unstageAll()
        #expect(store.staged.isEmpty)
        #expect(store.errorMessage == nil)
    }

    @Test("Zurücknehmen im neuen Repository ohne ersten Commit")
    func unstageWithoutCommits() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try repository.write("main.tex", "x\n")
        let store = repository.makeStore()
        await store.open(project: repository.root)

        await store.stageAll()
        #expect(store.staged.map(\.kind) == [.added])
        await store.unstageAll()
        #expect(store.unstaged.map(\.kind) == [.untracked])
        #expect(store.errorMessage == nil)
    }

    @Test("Commit: nur Bereitgestelltes, mehrzeilige Nachricht, Feld wird geleert")
    func commitStaged() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["a.tex": "a\n", "b.tex": "b\n"])
        try repository.write("a.tex", "A\n")
        try repository.write("b.tex", "B\n")
        let store = repository.makeStore()
        await store.open(project: repository.root)
        await store.stage(store.unstaged.filter { $0.path == "a.tex" })

        store.commitMessage = "Einleitung überarbeitet\n\nDetails: \"Zitate\" & #Raute"
        let succeeded = await store.commit(stagingAll: false)

        #expect(succeeded)
        #expect(try await lastCommitMessage(repository) == "Einleitung überarbeitet\n\nDetails: \"Zitate\" & #Raute")
        #expect(store.commitMessage.isEmpty)
        #expect(store.staged.isEmpty)
        #expect(store.unstaged.map(\.path) == ["b.tex"])
        #expect(store.branch.hasCommits)
    }

    @Test("Commit mit allem, auch neuen und gelöschten Dateien, und erster Commit überhaupt")
    func commitAll() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try repository.write("main.tex", "x\n")
        try repository.write("kapitel/eins.tex", "1\n")
        let store = repository.makeStore()
        await store.open(project: repository.root)

        store.commitMessage = "Erster Stand"
        #expect(await store.commit(stagingAll: true))
        #expect(!store.hasChanges)
        #expect(try await repository.run("ls-files").split(separator: "\n") == ["kapitel/eins.tex", "main.tex"])
    }

    @Test("Fehler: fehlende Identität, abgelehnter Hook, leere Nachricht – nichts wird committet")
    func commitErrors() async throws {
        let repository = try await TemporaryRepository(withIdentity: false)
        defer { repository.remove() }
        try repository.write("a.tex", "a\n")
        let store = repository.makeStore()
        // Sonst rät Git Name und E-Mail aus Benutzer und Rechnername
        store.extraEnvironment.merge(["GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "user.useConfigOnly", "GIT_CONFIG_VALUE_0": "true"]) { _, new in new }
        await store.open(project: repository.root)

        store.commitMessage = "   "
        #expect(await !store.commit(stagingAll: true))
        #expect(store.errorMessage == "Bitte eine Commit-Nachricht eingeben.")

        store.commitMessage = "Versuch"
        #expect(await !store.commit(stagingAll: true))
        #expect(store.errorMessage?.contains("git config --global user.name") == true)
        #expect(store.commitMessage == "Versuch")

        try await repository.run("config", "user.name", "Test")
        try await repository.run("config", "user.email", "t@example.com")
        let hook = try repository.write(".git/hooks/pre-commit", "#!/bin/sh\necho 'Hook sagt nein' >&2\nexit 1\n")
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hook.path)
        store.errorMessage = nil
        #expect(await !store.commit(stagingAll: false))
        #expect(store.errorMessage?.contains("Hook sagt nein") == true)
        #expect(!store.branch.hasCommits)
    }

    @Test("Diff-Tab: nicht bereitgestellt gegen Index, bereitgestellt gegen HEAD; folgt beim Bereitstellen, Umschalten, schließt nach Commit")
    func diffs() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["a.tex": "eins\nzwei\ndrei\n"])
        try repository.write("a.tex", "eins\nZWEI\ndrei\n")
        let store = repository.makeStore()
        var obsolete: [URL] = []
        store.onDiffObsolete = { obsolete.append($0) }
        await store.open(project: repository.root)

        let url = try await showDiff(store, store.unstaged.first)
        #expect(diffLines(store, url) == [" eins", "-zwei", "+ZWEI", " drei"])

        await store.stage(store.unstaged)
        try await waitForDiff(store, url)
        #expect(store.diffs[url]?.showsStaged == true)
        #expect(diffLines(store, url) == [" eins", "-zwei", "+ZWEI", " drei"])

        try repository.write("a.tex", "eins\nZWEI\ndrei\nvier\n")
        await store.refresh()
        store.selectSide(staged: false, for: url)
        try await waitForDiff(store, url)
        #expect(diffLines(store, url) == [" eins", " ZWEI", " drei", "+vier"])

        store.commitMessage = "x"
        await store.commit(stagingAll: true)
        #expect(obsolete == [url])
    }

    @Test("Aufgeklappte Bereiche bleiben pro Diff-Tab erhalten, geschlossene Tabs werden vergessen")
    func diffTabState() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["a.tex": "a\n", "b.tex": "b\n"])
        try repository.write("a.tex", "A\n")
        try repository.write("b.tex", "B\n")
        let store = repository.makeStore()
        await store.open(project: repository.root)
        let a = repository.url("a.tex"), b = repository.url("b.tex")

        store.updateDiffTabs(open: [a, b], active: a)
        try await waitForDiff(store, a)
        store.setExpanded([3], for: a)
        store.updateDiffTabs(open: [a, b], active: b)
        try await waitForDiff(store, b)
        #expect(store.diffs[a]?.expanded == [3])

        store.updateDiffTabs(open: [b], active: b)
        #expect(store.diffs[a] == nil)
        #expect(store.diffs.keys.sorted { $0.path < $1.path } == [b])
    }

    @Test("Diff neuer, gelöschter, umbenannter und binärer Dateien")
    func specialDiffs() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["alt.tex": "a\nb\n", "weg.tex": "w\n", "bild.png": "PNG"])
        try repository.write("neu.tex", "n\n")
        try FileManager.default.removeItem(at: repository.url("weg.tex"))
        try await repository.run("mv", "alt.tex", "umbenannt.tex")
        try repository.write("bild.png", "PNG2")
        let store = repository.makeStore()
        await store.open(project: repository.root)

        var url = try await showDiff(store, store.unstaged.first { $0.path == "neu.tex" })
        #expect(diffLines(store, url) == ["+n"])
        url = try await showDiff(store, store.unstaged.first { $0.path == "weg.tex" })
        #expect(diffLines(store, url) == ["-w"])
        url = try await showDiff(store, store.staged.first { $0.kind == .renamed })
        #expect(diffLines(store, url) == [" a", " b"])
        url = try await showDiff(store, store.unstaged.first { $0.path == "bild.png" })
        #expect(store.diffs[url]?.state == .loaded(FileDiff(content: .binary)))
    }

    @Test("Projekt im Unterordner: nur dessen Änderungen, Bereitgestelltes außerhalb wird gezählt")
    func projectInSubfolder() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["README.md": "r\n", "thesis/main.tex": "m\n"])
        try repository.write("README.md", "R\n")
        try await repository.run("add", "README.md")
        try repository.write("thesis/main.tex", "M\n")
        let store = repository.makeStore()
        await store.open(project: repository.url("thesis"))

        #expect(store.unstaged.map(\.path) == ["thesis/main.tex"])
        #expect(store.staged.isEmpty)
        #expect(store.stagedOutsideProject == 1)
        #expect(store.marker(for: repository.url("thesis/main.tex")) == .modified)
        #expect(store.url(for: try #require(store.unstaged.first)) == repository.url("thesis/main.tex"))
    }

    @Test("Status lesen verändert den Index nicht (optionale Sperren aus)")
    func statusDoesNotWriteIndex() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["a.tex": "a\n"])
        // Zeitstempel ändern, Inhalt gleich: Ein normales `git status` würde den Index auffrischen.
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(10)], ofItemAtPath: repository.url("a.tex").path)
        let index = repository.url(".git/index")
        let before = try Data(contentsOf: index)

        let store = repository.makeStore()
        await store.open(project: repository.root)
        await store.refresh()

        #expect(try Data(contentsOf: index) == before)
        #expect(!store.hasChanges)
    }
}
