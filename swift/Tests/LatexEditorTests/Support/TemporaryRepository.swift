import Foundation
import Testing
@testable import LatexEditor

/// Temporäres Git-Repository für Tests. Git läuft ohne globale und System-Konfiguration des Nutzers
/// (z. B. Signieren von Commits oder eigene Hooks), Name und E-Mail stehen im Repository selbst.
struct TemporaryRepository {
    static let isolatedEnvironment = ["GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"]

    let project: TemporaryProject
    let git: URL

    var root: URL { project.root }

    init(withIdentity: Bool = true) async throws {
        git = try #require(GitLocator.locate(), "Für die Git-Tests muss Git installiert sein")
        project = try TemporaryProject()
        try await run("init", "--quiet", "--initial-branch=main")
        if withIdentity {
            try await run("config", "user.name", "Test Person")
            try await run("config", "user.email", "test@example.com")
        }
    }

    @discardableResult
    func run(_ arguments: String..., in directory: URL? = nil) async throws -> String {
        let runner = GitRunner(executable: git, directory: directory ?? root, extraEnvironment: Self.isolatedEnvironment)
        let data = try await runner.run(arguments)
        return String(decoding: data, as: UTF8.self)
    }

    @discardableResult
    func write(_ relativePath: String, _ contents: String = "") throws -> URL {
        try project.write(relativePath, contents)
    }

    func url(_ relativePath: String) -> URL {
        project.url(relativePath)
    }

    /// Legt die Dateien an und committet sie.
    func commit(_ files: [String: String], message: String = "Start") async throws {
        for (path, contents) in files { try write(path, contents) }
        try await run("add", "--all")
        try await run("commit", "--quiet", "--message", message)
    }

    /// Legt ein lokales „Remote“ (bare) an, verbindet es als `origin` und pusht `main`. Ein zweiter Klon
    /// spielt den anderen Rechner, der Commits beisteuert. Nie ein echtes Netzwerk-Remote.
    func addRemote() async throws -> TemporaryRemote {
        let bare = try TemporaryProject()
        try await run("init", "--bare", "--quiet", "--initial-branch=main", ".", in: bare.root)
        try await run("remote", "add", "origin", bare.root.path)
        try await run("push", "--quiet", "--set-upstream", "origin", "main")
        let cloneParent = try TemporaryProject()
        let clone = cloneParent.root.appendingPathComponent("klon")
        try await run("clone", "--quiet", bare.root.path, clone.path, in: cloneParent.root)
        try await run("config", "user.name", "Anderer Rechner", in: clone)
        try await run("config", "user.email", "anders@example.com", in: clone)
        return TemporaryRemote(repository: self, bare: bare, cloneParent: cloneParent, clone: clone)
    }

    @MainActor
    func makeStore() -> GitStore {
        let store = GitStore()
        store.extraEnvironment = Self.isolatedEnvironment
        return store
    }

    func remove() {
        project.remove()
    }
}

/// Bare-Repository als Remote plus ein zweiter Klon („anderer Rechner“).
struct TemporaryRemote {
    let repository: TemporaryRepository
    let bare: TemporaryProject
    let cloneParent: TemporaryProject
    let clone: URL

    /// Commit im zweiten Klon und Push zum Remote.
    func commitElsewhere(_ files: [String: String], message: String = "Von woanders") async throws {
        for (path, contents) in files {
            let url = clone.appendingPathComponent(path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try contents.write(to: url, atomically: true, encoding: .utf8)
        }
        try await repository.run("add", "--all", in: clone)
        try await repository.run("commit", "--quiet", "--message", message, in: clone)
        try await repository.run("push", "--quiet", in: clone)
    }

    func remove() {
        bare.remove()
        cloneParent.remove()
    }
}
