import Foundation
import Testing
@testable import LatexEditor

@Suite("Git: Abrufen, Pull, Push, Branches (lokales Bare-Repository)")
@MainActor
struct GitRemoteTests {
    private func setUp() async throws -> (TemporaryRepository, TemporaryRemote, GitStore) {
        let repository = try await TemporaryRepository()
        try await repository.commit(["main.tex": "eins\n"])
        let remote = try await repository.addRemote()
        let store = repository.makeStore()
        await store.open(project: repository.root)
        return (repository, remote, store)
    }

    @Test("Abrufen zeigt neue Commits als ↓, Pull holt sie (nur Vorspulen)")
    func fetchAndPull() async throws {
        let (repository, remote, store) = try await setUp()
        defer { repository.remove(); remote.remove() }
        #expect(store.remotes == ["origin"])
        #expect(store.branch.upstream == "origin/main")

        try await remote.commitElsewhere(["main.tex": "eins\nzwei\n"])
        #expect(store.branch.behind == 0, "Ohne Abrufen weiß die App nichts davon")
        #expect(await store.fetch())
        #expect(store.branch.behind == 1)

        #expect(await store.pull())
        #expect(store.branch.behind == 0)
        #expect(try String(contentsOf: repository.url("main.tex"), encoding: .utf8) == "eins\nzwei\n")
    }

    @Test("Push sendet Commits; neuer Branch bekommt beim ersten Push seinen Upstream")
    func pushAndUpstream() async throws {
        let (repository, remote, store) = try await setUp()
        defer { repository.remove(); remote.remove() }
        try repository.write("main.tex", "eins\nlokal\n")
        await store.refresh()
        store.commitMessage = "Lokal"
        await store.commit(stagingAll: true)
        #expect(store.branch.ahead == 1)

        #expect(await store.push())
        #expect(store.branch.ahead == 0)
        let remoteHead = try await repository.run("rev-parse", "main", in: remote.bare.root)
        let localHead = try await repository.run("rev-parse", "HEAD")
        #expect(remoteHead == localHead)

        #expect(await store.createBranch(named: "kapitel-3"))
        #expect(store.branch.head == "kapitel-3")
        #expect(store.branch.upstream == nil)
        #expect(store.branches == ["kapitel-3", "main"])
        #expect(await store.push())
        #expect(store.branch.upstream == "origin/kapitel-3")
    }

    @Test("Auseinandergelaufen: Pull bricht ab, Push wird abgelehnt – mit verständlicher Meldung, nichts geht verloren")
    func diverged() async throws {
        let (repository, remote, store) = try await setUp()
        defer { repository.remove(); remote.remove() }
        try await remote.commitElsewhere(["anderes.tex": "x\n"])
        try repository.write("main.tex", "eins\nlokal\n")
        await store.refresh()
        store.commitMessage = "Lokal"
        await store.commit(stagingAll: true)
        await store.fetch()
        #expect(store.branch.ahead == 1 && store.branch.behind == 1)

        #expect(await !store.pull())
        #expect(store.errorMessage?.contains("auseinandergelaufen") == true)
        store.errorMessage = nil
        #expect(await !store.push())
        #expect(store.errorMessage?.contains("Erst Pull") == true)
        #expect(try String(contentsOf: repository.url("main.tex"), encoding: .utf8) == "eins\nlokal\n")
        #expect(!FileManager.default.fileExists(atPath: repository.url("anderes.tex").path))
    }

    @Test("Pull, der lokale Änderungen überschreiben würde, bricht ab und nennt die Datei")
    func pullWouldOverwrite() async throws {
        let (repository, remote, store) = try await setUp()
        defer { repository.remove(); remote.remove() }
        try await remote.commitElsewhere(["main.tex": "eins\nvon woanders\n"])
        try repository.write("main.tex", "eins\nlokal ungespeichert committet nicht\n")
        await store.fetch()

        #expect(await !store.pull())
        #expect(store.errorMessage?.contains("Lokale Änderungen würden überschrieben") == true)
        #expect(store.errorMessage?.contains("main.tex") == true)
        #expect(try String(contentsOf: repository.url("main.tex"), encoding: .utf8) == "eins\nlokal ungespeichert committet nicht\n")
    }

    @Test("Branches wechseln und anlegen; ungültiger oder doppelter Name wird gemeldet")
    func branches() async throws {
        let (repository, remote, store) = try await setUp()
        defer { repository.remove(); remote.remove() }
        #expect(await store.createBranch(named: "test"))
        try repository.write("nur-hier.tex", "x\n")
        await store.refresh()
        store.commitMessage = "Nur auf test"
        await store.commit(stagingAll: true)

        #expect(await store.switchBranch(to: "main"))
        #expect(store.branch.head == "main")
        #expect(!FileManager.default.fileExists(atPath: repository.url("nur-hier.tex").path))

        #expect(await !store.createBranch(named: "mit leerzeichen"))
        #expect(store.errorMessage?.contains("Ungültiger Branch-Name") == true)
        store.errorMessage = nil
        #expect(await !store.createBranch(named: "test"))
        #expect(store.errorMessage?.contains("existiert bereits") == true)
    }

    @Test("Ohne Remote: Push meldet das, Abrufen ist harmlos")
    func withoutRemote() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "x\n"])
        let store = repository.makeStore()
        await store.open(project: repository.root)

        #expect(!store.hasRemote)
        #expect(await !store.push())
        #expect(store.errorMessage == "Für dieses Repository ist kein Remote eingerichtet.")
    }

    @Test("Stand aus HEAD für die Änderungsmarken; neue Dateien haben keinen")
    func headContents() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["kapitel/a.tex": "alt\n"])
        try repository.write("kapitel/a.tex", "neu\n")
        try repository.write("neu.tex", "n\n")
        let store = repository.makeStore()
        await store.open(project: repository.root)

        #expect(await store.headContents(of: repository.url("kapitel/a.tex")) == Data("alt\n".utf8))
        #expect(await store.headContents(of: repository.url("neu.tex")) == nil)
    }
}
