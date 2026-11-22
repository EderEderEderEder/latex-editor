import Foundation
import Testing
@testable import LatexEditor

@Suite("GitStatusParser")
struct GitStatusParserTests {
    private let hash = String(repeating: "a", count: 40)

    private func data(_ records: [String]) -> Data {
        Data((records.joined(separator: "\0") + "\0").utf8)
    }

    @Test("Branch-Zeilen: Name, Commit, Upstream, voraus/zurück")
    func branchHeaders() {
        let snapshot = GitStatusParser.parse(data([
            "# branch.oid \(hash)", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -1",
        ]))

        #expect(snapshot.branch == GitBranchInfo(head: "main", commit: hash, upstream: "origin/main", ahead: 2, behind: 1))
        #expect(snapshot.entries.isEmpty)
    }

    @Test("Neues Repository ohne Commit und losgelöster HEAD")
    func initialAndDetached() {
        let initial = GitStatusParser.parse(data(["# branch.oid (initial)", "# branch.head main"]))
        let detached = GitStatusParser.parse(data(["# branch.oid \(hash)", "# branch.head (detached)"]))

        #expect(!initial.branch.hasCommits)
        #expect(initial.branch.displayName == "main")
        #expect(detached.branch.head == nil)
        #expect(detached.branch.displayName == "aaaaaaa")
    }

    @Test("Geändert, bereitgestellt, gelöscht, nicht versioniert, Konflikt; Pfade mit Leerzeichen und Umlauten")
    func entryKinds() {
        let modes = "N... 100644 100644 100644 \(hash) \(hash)"
        let snapshot = GitStatusParser.parse(data([
            "1 .M \(modes) kapitel/einleitung.tex",
            "1 MM \(modes) main.tex",
            "1 A. \(modes) neu mit Leerzeichen.tex",
            "1 .D \(modes) alt.tex",
            "? bilder/Größe.png",
            "u UU N... 100644 100644 100644 100644 \(hash) \(hash) \(hash) konflikt.tex",
        ]))

        #expect(snapshot.stagedChanges.map(\.path) == ["main.tex", "neu mit Leerzeichen.tex"])
        #expect(snapshot.stagedChanges.map(\.kind) == [.modified, .added])
        #expect(snapshot.unstagedChanges.map(\.path) == ["kapitel/einleitung.tex", "main.tex", "alt.tex", "bilder/Größe.png", "konflikt.tex"])
        #expect(snapshot.unstagedChanges.map(\.kind) == [.modified, .modified, .deleted, .untracked, .conflicted])
    }

    @Test("Umbenennung: ursprünglicher Pfad folgt als eigener Eintrag")
    func renamed() {
        let snapshot = GitStatusParser.parse(data([
            "2 R. N... 100644 100644 100644 \(hash) \(hash) R100 kapitel/neu name.tex", "kapitel/alt.tex",
            "1 .M N... 100644 100644 100644 \(hash) \(hash) danach.tex",
        ]))

        #expect(snapshot.stagedChanges == [GitChange(path: "kapitel/neu name.tex", originalPath: "kapitel/alt.tex", kind: .renamed, isStaged: true)])
        #expect(snapshot.unstagedChanges.map(\.path) == ["danach.tex"])
    }

    @Test("Echte Ausgabe von git status wird vollständig gelesen")
    func realOutput() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["a.tex": "a\n", "b.tex": "b\n", "c d.tex": "c\n"])
        try repository.write("a.tex", "geändert\n")
        try repository.write("neu/ä.tex", "neu\n")
        try await repository.run("mv", "b.tex", "b2.tex")
        try FileManager.default.removeItem(at: repository.url("c d.tex"))

        let output = try await repository.run("status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
        let snapshot = GitStatusParser.parse(Data(output.utf8))

        #expect(snapshot.branch.head == "main")
        #expect(snapshot.stagedChanges.map(\.kind) == [.renamed])
        #expect(snapshot.stagedChanges.first?.originalPath == "b.tex")
        #expect(Set(snapshot.unstagedChanges.map(\.path)) == ["a.tex", "c d.tex", "neu/ä.tex"])
    }
}

@Suite("Git: Programm, Meldungen, Ereignisse")
struct GitSupportTests {
    @Test("Homebrew vor Command Line Tools, nicht vorhandene Kandidaten werden übersprungen")
    func locatorOrder() {
        let found = GitLocator.locate(in: ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/clt/git"]) { $0 != "/opt/homebrew/bin/git" }

        #expect(found?.path == "/usr/local/bin/git")
        #expect(GitLocator.locate(in: ["/x/git"]) { _ in false } == nil)
    }

    @Test("Umgebung: englische Meldungen, keine Abfragen, keine optionalen Sperren, wörtliche Pfade")
    func environment() {
        let environment = GitRunner.environment(base: ["PATH": "/eigen/bin", "HOME": "/Users/x"])

        #expect(environment["LC_ALL"] == "C")
        #expect(environment["GIT_TERMINAL_PROMPT"] == "0")
        #expect(environment["GIT_OPTIONAL_LOCKS"] == "0")
        #expect(environment["GIT_LITERAL_PATHSPECS"] == "1")
        #expect(environment["HOME"] == "/Users/x")
        #expect(environment["PATH"]?.hasSuffix(":/eigen/bin") == true)
    }

    @Test("Fehlende Identität, Sperre und leere Commits werden verständlich gemeldet")
    func userMessages() {
        #expect(GitError.userMessage(for: "*** Please tell me who you are.\n\nRun …").contains("git config --global user.email"))
        #expect(GitError.userMessage(for: "fatal: Unable to create '/r/.git/index.lock': File exists.").contains("index.lock"))
        #expect(GitError.userMessage(for: "nothing to commit, working tree clean") == "Es gibt nichts zu committen.")
        #expect(GitError.userMessage(for: "pre-commit: Bitte keine TODOs") == "Git meldet:\npre-commit: Bitte keine TODOs")
        #expect(GitError.userMessage(for: "fatal: Authentication failed for 'https://github.com/x/y.git/'").contains("Schlüsselbund"))
        #expect(GitError.userMessage(for: "fatal: unable to access '…': Could not resolve host: github.com").contains("nicht erreichbar"))
        #expect(GitError.userMessage(for: " ! [rejected]        main -> main (fetch first)").contains("Erst Pull"))
        #expect(GitError.userMessage(for: "fatal: Not possible to fast-forward, aborting.").contains("auseinandergelaufen"))
        let overwrite = "error: Your local changes to the following files would be overwritten by merge:\n\tkapitel/a.tex\nPlease commit"
        #expect(GitError.userMessage(for: overwrite).hasSuffix("kapitel/a.tex"))
    }

    @Test("Ereignisse in .git zählen nur für Index, HEAD und Refs")
    func internalPaths() {
        let gitDirectory = URL(fileURLWithPath: "/private/var/r/.git")

        #expect(GitStore.pathInsideGitDirectory("/var/r/.git/index", gitDirectory: gitDirectory) == "index")
        #expect(GitStore.pathInsideGitDirectory("/private/var/r/.git/refs/heads/main", gitDirectory: gitDirectory) == "refs/heads/main")
        #expect(GitStore.pathInsideGitDirectory("/var/r/kapitel/a.tex", gitDirectory: gitDirectory) == nil)
        #expect(GitStore.isRelevantInternalPath("index"))
        #expect(GitStore.isRelevantInternalPath("refs/heads/main"))
        #expect(!GitStore.isRelevantInternalPath("index.lock"))
        #expect(!GitStore.isRelevantInternalPath("objects/ab/cdef"))
        #expect(!GitStore.isRelevantInternalPath("logs/HEAD"))
    }

    @Test("Projekt in einem Unterordner des Repositorys: nur Pfade darunter gehören zum Projekt")
    func projectPrefix() {
        let repository = GitRepository(
            root: URL(fileURLWithPath: "/r"), gitDirectory: URL(fileURLWithPath: "/r/.git"),
            projectRoot: URL(fileURLWithPath: "/r/thesis")
        )

        #expect(repository.projectPrefix == "thesis")
        #expect(repository.projectURL(forRepositoryPath: "thesis/main.tex")?.path == "/r/thesis/main.tex")
        #expect(repository.projectURL(forRepositoryPath: "thesis-alt/main.tex") == nil)
        #expect(repository.projectURL(forRepositoryPath: "README.md") == nil)
    }
}
