import Foundation
import Observation

enum GitAvailability: Equatable, Sendable {
    /// Noch nicht geprüft oder kein Projekt offen
    case unknown
    case notRepository
    /// Git fehlt oder das Repository lässt sich nicht lesen
    case unavailable(String)
    case ready
}

enum DiffState: Equatable, Sendable {
    case loading
    case loaded(FileDiff)
    case failed(String)
}

/// Ein offener Diff-Tab: welche Seite er zeigt (bereitgestellt oder nicht), was geladen ist und
/// welche unveränderten Bereiche aufgeklappt sind.
struct DiffPresentation: Equatable, Sendable {
    var showsStaged: Bool
    var state = DiffState.loading
    var expanded: Set<Int> = []
}

/// Git-Status des Projekts: Branch, Änderungen (bereitgestellt / nicht bereitgestellt), Markierungen
/// für den Dateibaum, Diff der gewählten Datei. Git-Befehle laufen nacheinander und abseits des
/// Main-Threads; nach einem Projektwechsel verworfene Ergebnisse erkennt `generation`.
@MainActor
@Observable
final class GitStore {
    typealias Locator = @Sendable () -> URL?

    static let refreshDelay = Duration.milliseconds(300)
    private nonisolated static let statusArguments = ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"]
    /// Interna von `.git`, deren Änderung den Status betrifft (Index, aktueller Branch, Refs)
    private nonisolated static let relevantGitFiles: Set<String> = ["index", "HEAD", "packed-refs", "MERGE_HEAD", "CHERRY_PICK_HEAD", "config"]

    private(set) var availability = GitAvailability.unknown
    private(set) var branch = GitBranchInfo()
    private(set) var staged: [GitChange] = []
    private(set) var unstaged: [GitChange] = []
    /// Bereitgestellte Dateien außerhalb des Projektordners (werden beim Commit mitcommittet)
    private(set) var stagedOutsideProject = 0
    /// Lokale Branches (sortiert)
    private(set) var branches: [String] = []
    /// Namen der eingerichteten Remotes
    private(set) var remotes: [String] = []
    /// Laufender Netzwerk- oder Branch-Vorgang für die Anzeige („Pull …“), sonst nil
    private(set) var activity: String?
    /// Letztes Zurücksetzen, solange es sich rückgängig machen lässt (Hinweis im Änderungen-Tab)
    var lastReset: ResetSnapshot?
    /// Statusbuchstabe pro Dateipfad (`standardizedFileURL.path`) für den Dateibaum
    private(set) var markers: [String: GitChangeKind] = [:]
    /// Ordner (Pfade), in denen etwas geändert ist
    private(set) var foldersWithChanges: Set<String> = []
    private(set) var isBusy = false
    /// Offene Diff-Tabs, nach Datei
    private(set) var diffs: [URL: DiffPresentation] = [:]
    var errorMessage: String?
    /// Bleibt pro Projekt erhalten, solange die App läuft.
    var commitMessage = "" {
        didSet { if let project { commitMessages[project] = commitMessage } }
    }

    @ObservationIgnored private(set) var repository: GitRepository?
    @ObservationIgnored private var runner: GitRunner?
    @ObservationIgnored private let locate: Locator
    /// Zusätzliche Umgebung für Git (Tests: eigene Konfiguration)
    @ObservationIgnored var extraEnvironment: [String: String] = [:]
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var queueTail: Task<Void, Never>?
    @ObservationIgnored private var scheduledRefresh: Task<Void, Never>?
    @ObservationIgnored private var project: String?
    @ObservationIgnored private var commitMessages: [String: String] = [:]
    /// Der Diff-Tab einer Datei ohne Änderungen soll schließen (z. B. nach dem Commit).
    @ObservationIgnored var onDiffObsolete: ((URL) -> Void)?
    @ObservationIgnored private var activeDiff: URL?
    /// Diffs, die nach einem Statuslauf neu geladen werden müssen, sobald ihr Tab aktiv wird
    @ObservationIgnored private var staleDiffs: Set<URL> = []
    /// Nach jedem Statuslauf (z. B. damit die Änderungsmarken einen neuen HEAD bemerken)
    @ObservationIgnored var onStatusApplied: (() -> Void)?
    /// Seite, die ein neu geöffneter Diff-Tab zeigen soll (die angeklickte Zeile)
    @ObservationIgnored private var requestedSides: [URL: Bool] = [:]
    /// Branches und Remotes beim nächsten Statuslauf neu lesen (zwei Prozesse mehr, deshalb nicht bei jedem Speichern)
    @ObservationIgnored private var needsReferences = true
    @ObservationIgnored private var runningOperations = 0 {
        didSet { if isBusy != (runningOperations > 0) { isBusy = runningOperations > 0 } }
    }

    init(locate: @escaping Locator = { GitLocator.locate() }) {
        self.locate = locate
    }

    var isReady: Bool { availability == .ready }
    var hasChanges: Bool { !staged.isEmpty || !unstaged.isEmpty }
    /// Anzahl geänderter Dateien (eine Datei kann bereitgestellt und zusätzlich geändert sein)
    var changeCount: Int { Set((staged + unstaged).map(\.path)).count }
    var trimmedCommitMessage: String { commitMessage.trimmingCharacters(in: .whitespacesAndNewlines) }
    var canCommit: Bool { isReady && !isBusy && hasChanges && !trimmedCommitMessage.isEmpty }
    var hasRemote: Bool { !remotes.isEmpty }

    func url(for change: GitChange) -> URL? {
        repository?.projectURL(forRepositoryPath: change.path)
    }

    func url(forRepositoryPath path: String) -> URL? {
        repository?.projectURL(forRepositoryPath: path)
    }

    /// Alle Änderungen einer Datei (bereitgestellt und nicht bereitgestellt).
    func changes(for url: URL) -> [GitChange] {
        let key = url.standardizedFileURL
        return (staged + unstaged).filter { self.url(for: $0) == key }
    }

    func marker(for url: URL) -> GitChangeKind? {
        markers[url.standardizedFileURL.path]
    }

    func containsChanges(_ folder: URL) -> Bool {
        foldersWithChanges.contains(folder.standardizedFileURL.path)
    }

    // MARK: Projekt

    func open(project root: URL) async {
        reset()
        project = root.standardizedFileURL.path
        commitMessage = commitMessages[root.standardizedFileURL.path] ?? ""
        let currentGeneration = generation
        guard let git = locate() else {
            availability = .unavailable(GitLocator.missingMessage)
            return
        }
        do {
            let found = try await GitRepository.discover(project: root, git: git)
            guard currentGeneration == generation else { return }
            guard let found else {
                availability = .notRepository
                return
            }
            repository = found
            runner = GitRunner(executable: git, directory: found.root, extraEnvironment: extraEnvironment)
            availability = .ready
            await refresh()
        } catch {
            guard currentGeneration == generation else { return }
            availability = .unavailable(error.localizedDescription)
        }
    }

    /// Beim Projektwechsel: alles verwerfen; laufende Befehle dürfen danach nichts mehr setzen.
    func reset() {
        generation += 1
        scheduledRefresh?.cancel()
        scheduledRefresh = nil
        repository = nil
        runner = nil
        project = nil
        commitMessage = ""
        if availability != .unknown { availability = .unknown }
        apply(GitStatusSnapshot(), outsideProject: 0)
        if !diffs.isEmpty { diffs = [:] }
        activeDiff = nil
        staleDiffs = []
        requestedSides = [:]
        runningOperations = 0
        needsReferences = true
        errorMessage = nil
        if !branches.isEmpty { branches = [] }
        if !remotes.isEmpty { remotes = [] }
        activity = nil
        lastReset = nil
    }

    // MARK: Status

    /// Fasst Dateisystem-Ereignisse zusammen: höchstens ein Statuslauf pro `refreshDelay`.
    /// Auch nach einem fehlgeschlagenen Statuslauf (z. B. während eines Git-Befehls im Terminal):
    /// Der nächste erfolgreiche macht den Änderungen-Tab wieder bereit.
    func scheduleRefresh() {
        guard runner != nil, scheduledRefresh == nil else { return }
        scheduledRefresh = Task { [weak self] in
            try? await Task.sleep(for: Self.refreshDelay)
            guard let self, !Task.isCancelled else { return }
            self.scheduledRefresh = nil
            await self.refresh()
        }
    }

    func refresh() async {
        guard let runner, let repository else { return }
        let currentGeneration = generation
        let loadsReferences = needsReferences
        needsReferences = false
        let result: Result<(GitStatusSnapshot, GitReferences?), Error> = await enqueue {
            do {
                let data = try await runner.run(Self.statusArguments)
                let references = loadsReferences ? try await GitReferences.load(with: runner) : nil
                return .success((await Task.detached(priority: .utility) { GitStatusParser.parse(data) }.value, references))
            } catch {
                return .failure(error)
            }
        }
        guard currentGeneration == generation else { return }
        switch result {
        case let .success((snapshot, references)):
            if availability != .ready { availability = .ready }
            applyFiltered(snapshot, repository: repository)
            if let references {
                if branches != references.branches { branches = references.branches }
                if remotes != references.remotes { remotes = references.remotes }
            }
            onStatusApplied?()
            await updateDiffsAfterRefresh()
        case let .failure(error):
            needsReferences = needsReferences || loadsReferences
            availability = .unavailable(error.localizedDescription)
        }
    }

    /// Nur Dateien im Projektordner; bereitgestellte Dateien außerhalb werden gezählt.
    private func applyFiltered(_ snapshot: GitStatusSnapshot, repository: GitRepository) {
        var filtered = snapshot
        filtered.entries = snapshot.entries.filter { repository.isInsideProject(repositoryPath: $0.path) }
        let outside = snapshot.entries.count { $0.indexKind != nil && !repository.isInsideProject(repositoryPath: $0.path) }
        apply(filtered, outsideProject: outside)
    }

    private func apply(_ snapshot: GitStatusSnapshot, outsideProject: Int) {
        if branch != snapshot.branch { branch = snapshot.branch }
        let newStaged = snapshot.stagedChanges
        let newUnstaged = snapshot.unstagedChanges
        if staged != newStaged { staged = newStaged }
        if unstaged != newUnstaged { unstaged = newUnstaged }
        if stagedOutsideProject != outsideProject { stagedOutsideProject = outsideProject }
        let newMarkers = makeMarkers(snapshot.entries)
        if markers != newMarkers { markers = newMarkers }
        let newFolders = makeFolders(for: newMarkers.keys)
        if foldersWithChanges != newFolders { foldersWithChanges = newFolders }
    }

    /// Die Änderung im Arbeitsverzeichnis hat Vorrang, sie ist die neuere.
    private func makeMarkers(_ entries: [GitStatusEntry]) -> [String: GitChangeKind] {
        guard let repository else { return [:] }
        var result: [String: GitChangeKind] = [:]
        for entry in entries {
            guard let kind = entry.worktreeKind ?? entry.indexKind,
                  let url = repository.projectURL(forRepositoryPath: entry.path) else { continue }
            result[url.path] = kind
        }
        return result
    }

    private func makeFolders(for paths: Dictionary<String, GitChangeKind>.Keys) -> Set<String> {
        guard let root = repository?.projectRoot.standardizedFileURL.path else { return [] }
        var folders: Set<String> = []
        for path in paths {
            var folder = (path as NSString).deletingLastPathComponent
            while folder.hasPrefix(root + "/"), folders.insert(folder).inserted {
                folder = (folder as NSString).deletingLastPathComponent
            }
        }
        return folders
    }

    // MARK: Dateisystem-Ereignisse

    /// Ob ein Ereignis den Status ändern kann. Dateien im Arbeitsverzeichnis immer; in `.git` nur Index,
    /// HEAD und Refs (Objekte, Logs und Sperrdateien ändern sich bei jedem Befehl).
    /// Merkt sich außerdem, ob Branches und Remotes neu gelesen werden müssen (Refs oder Konfiguration geändert).
    func registerChange(atPath path: String) -> Bool {
        guard let repository else { return false }
        guard let internalPath = Self.pathInsideGitDirectory(path, gitDirectory: repository.gitDirectory) else { return true }
        guard Self.isRelevantInternalPath(internalPath) else { return false }
        if internalPath != "index" { needsReferences = true }
        return true
    }

    nonisolated static func isRelevantInternalPath(_ path: String) -> Bool {
        guard !path.hasSuffix(".lock") else { return false }
        return relevantGitFiles.contains(path) || path.hasPrefix("refs/")
    }

    /// Pfad relativ zum `.git`-Ordner, `nil` für Dateien außerhalb. FSEvents liefert echte Pfade
    /// (`/private/var/…`), geöffnete Ordner können aber auch als `/var/…` vorliegen.
    nonisolated static func pathInsideGitDirectory(_ path: String, gitDirectory: URL) -> String? {
        let gitPath = gitDirectory.standardizedFileURL.path
        let variants = [gitPath, gitPath.hasPrefix("/private/") ? String(gitPath.dropFirst("/private".count)) : "/private" + gitPath]
        for variant in variants {
            if path == variant { return "" }
            if path.hasPrefix(variant + "/") { return String(path.dropFirst(variant.count + 1)) }
        }
        if let range = path.range(of: "/.git/", options: .backwards) { return String(path[range.upperBound...]) }
        return path.hasSuffix("/.git") ? "" : nil
    }

    // MARK: Remote und Branches

    /// Holt den Stand des Remotes (ändert keine Dateien), danach stimmen ↑/↓.
    @discardableResult
    func fetch() async -> Bool {
        await performShowing("Abrufen …") { runner in try await runner.run(["fetch", "--quiet", "--prune"]) }
    }

    /// Nur „Vorspulen“: Sind lokal und Remote auseinandergelaufen, bricht Git ab und es bleibt alles, wie es ist.
    @discardableResult
    func pull() async -> Bool {
        await performShowing("Pull …") { runner in try await runner.run(["pull", "--ff-only", "--quiet"]) }
    }

    /// Ohne Upstream wird er beim ersten Push gesetzt (bevorzugt `origin`). Nie mit `--force`.
    @discardableResult
    func push() async -> Bool {
        let arguments: [String]
        if branch.upstream != nil {
            arguments = ["push", "--quiet"]
        } else {
            guard let head = branch.head, let remote = remotes.first(where: { $0 == "origin" }) ?? remotes.first else {
                errorMessage = branch.head == nil
                    ? "Im losgelösten HEAD (kein Branch) ist kein Push möglich."
                    : "Für dieses Repository ist kein Remote eingerichtet."
                return false
            }
            arguments = ["push", "--quiet", "--set-upstream", remote, head]
        }
        return await performShowing("Push …") { runner in try await runner.run(arguments) }
    }

    @discardableResult
    func switchBranch(to name: String) async -> Bool {
        guard name != branch.head else { return true }
        return await performShowing("Wechsle zu \(name) …") { runner in try await runner.run(["switch", "--quiet", name]) }
    }

    /// Legt einen Branch am aktuellen Stand an und wechselt hinein (Änderungen bleiben erhalten).
    @discardableResult
    func createBranch(named rawName: String) async -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            errorMessage = "Bitte einen Namen für den Branch eingeben."
            return false
        }
        return await performShowing("Lege \(name) an …") { runner in try await runner.run(["switch", "--quiet", "--create", name]) }
    }

    private func performShowing(_ title: String, _ operation: @escaping @Sendable (GitRunner) async throws -> Void) async -> Bool {
        activity = title
        defer { activity = nil }
        return await perform(operation)
    }

    // MARK: Verwerfen, Stand aus HEAD

    /// Index und Arbeitsverzeichnis auf den letzten Commit; neue Pfade nur aus dem Index nehmen
    /// (ihre Dateien hat der Aufrufer schon in den Papierkorb gelegt).
    @discardableResult
    func resetToHead(_ plan: GitResetPlan) async -> Bool {
        guard !plan.isEmpty else { return true }
        return await perform { runner in
            if !plan.restorePaths.isEmpty {
                try await runner.run(["restore", "--source=HEAD", "--staged", "--worktree", "--"] + plan.restorePaths)
            }
            if !plan.newPaths.isEmpty {
                try await runner.run(["rm", "--cached", "--quiet", "--ignore-unmatch", "--"] + plan.newPaths)
            }
        }
    }

    /// Inhalt der Datei im letzten Commit, `nil`, wenn sie dort nicht existiert. Läuft bewusst außerhalb
    /// der Warteschlange: Ein langsamer Pull soll die Änderungsmarken nicht aufhalten.
    func headContents(of url: URL) async -> Data? {
        guard let runner, let repository, branch.hasCommits, let path = repository.repositoryPath(for: url) else { return nil }
        let output = try? await runner.execute(["cat-file", "blob", "HEAD:" + path])
        guard let output, output.status == 0 else { return nil }
        return output.standardOutput
    }

    // MARK: Bereitstellen, Commit

    func stage(_ changes: [GitChange]) async {
        let paths = Self.paths(of: changes)
        guard !paths.isEmpty else { return }
        await perform { runner in try await runner.run(["add", "--"] + paths) }
    }

    func unstage(_ changes: [GitChange]) async {
        let paths = Self.paths(of: changes)
        guard !paths.isEmpty else { return }
        // Ohne ersten Commit gibt es kein HEAD, auf das `restore --staged` zurücksetzen könnte.
        let arguments = branch.hasCommits ? ["restore", "--staged", "--"] : ["rm", "--cached", "--quiet", "--"]
        await perform { runner in try await runner.run(arguments + paths) }
    }

    func stageAll() async {
        await stage(unstaged)
    }

    func unstageAll() async {
        await unstage(staged)
    }

    /// Committet den Index. `stagingAll`: vorher alle Änderungen im Projekt bereitstellen.
    @discardableResult
    func commit(stagingAll: Bool) async -> Bool {
        let message = trimmedCommitMessage
        guard !message.isEmpty else {
            errorMessage = "Bitte eine Commit-Nachricht eingeben."
            return false
        }
        let pathsToStage = stagingAll ? Self.paths(of: unstaged) : []
        let succeeded = await perform { runner in
            if !pathsToStage.isEmpty { try await runner.run(["add", "--"] + pathsToStage) }
            try await Self.commit(message: message, with: runner)
        }
        if succeeded { commitMessage = "" }
        return succeeded
    }

    /// Nachricht über eine Datei statt über Argumente: mehrzeilig, beliebige Zeichen, keine Längengrenze.
    private nonisolated static func commit(message: String, with runner: GitRunner) async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("commit-\(UUID().uuidString).txt")
        try message.write(to: file, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: file) }
        try await runner.run(["commit", "--file", file.path])
    }

    private nonisolated static func paths(of changes: [GitChange]) -> [String] {
        var seen: Set<String> = []
        return changes.flatMap { [$0.path] + ($0.originalPath.map { [$0] } ?? []) }.filter { seen.insert($0).inserted }
    }

    /// Führt eine Änderung am Repository aus und lädt danach den Status neu. `false` bei Fehler.
    @discardableResult
    private func perform(_ operation: @escaping @Sendable (GitRunner) async throws -> Void) async -> Bool {
        guard let runner else { return false }
        let currentGeneration = generation
        runningOperations += 1
        let failure: String? = await enqueue {
            do {
                try await operation(runner)
                return nil
            } catch {
                return error.localizedDescription
            }
        }
        guard currentGeneration == generation else { return false }
        runningOperations -= 1
        needsReferences = true
        if let failure { errorMessage = failure }
        await refresh()
        return failure == nil
    }

    // MARK: Diff-Tabs

    /// Die Änderung einer Datei auf einer Seite (bereitgestellt oder nicht), falls vorhanden.
    func change(for url: URL, staged: Bool) -> GitChange? {
        let key = url.standardizedFileURL
        return (staged ? self.staged : unstaged).first { self.url(for: $0) == key }
    }

    /// Vor dem Öffnen des Diff-Tabs: Er soll die Seite der angeklickten Zeile zeigen.
    func prepareDiff(for change: GitChange) {
        guard let url = url(for: change) else { return }
        requestedSides[url] = change.isStaged
        if diffs[url] != nil { selectSide(staged: change.isStaged, for: url) }
    }

    /// Umschalter in der Kopfzeile: bereitgestellt / nicht bereitgestellt.
    func selectSide(staged: Bool, for url: URL) {
        let key = url.standardizedFileURL
        guard var presentation = diffs[key], presentation.showsStaged != staged else { return }
        presentation.showsStaged = staged
        presentation.state = .loading
        presentation.expanded = []
        diffs[key] = presentation
        Task { await loadDiff(for: key) }
    }

    func setExpanded(_ expanded: Set<Int>, for url: URL) {
        let key = url.standardizedFileURL
        guard diffs[key]?.expanded != expanded else { return }
        diffs[key]?.expanded = expanded
    }

    /// Gleicht die Diffs mit den offenen Tabs ab: neue laden, geschlossene vergessen, veraltete beim Aktivieren nachladen.
    func updateDiffTabs(open: Set<URL>, active: URL?) {
        for url in diffs.keys where !open.contains(url) {
            diffs[url] = nil
            staleDiffs.remove(url)
        }
        activeDiff = active
        var toLoad: [URL] = []
        for url in open where diffs[url] == nil {
            let staged = requestedSides.removeValue(forKey: url) ?? (change(for: url, staged: false) == nil)
            diffs[url] = DiffPresentation(showsStaged: staged)
            toLoad.append(url)
        }
        if let active, staleDiffs.remove(active) != nil { toLoad.append(active) }
        guard !toLoad.isEmpty else { return }
        Task { for url in toLoad { await loadDiff(for: url) } }
    }

    private func loadDiff(for url: URL) async {
        guard let presentation = diffs[url], let runner, let repository,
              let change = change(for: url, staged: presentation.showsStaged) else { return }
        let currentGeneration = generation
        let hasCommits = branch.hasCommits
        let state: DiffState = await enqueue {
            await Self.makeDiff(for: change, hasCommits: hasCommits, runner: runner, root: repository.root)
        }
        guard currentGeneration == generation, diffs[url]?.showsStaged == presentation.showsStaged,
              diffs[url]?.state != state else { return }
        diffs[url]?.state = state
    }

    /// Nach einem neuen Status: Ist die gezeigte Seite weg (bereitgestellt/zurückgenommen), wechselt
    /// der Tab auf die andere; hat die Datei gar keine Änderungen mehr, schließt er. Der aktive Diff
    /// wird sofort neu geladen, die übrigen beim nächsten Aktivieren.
    private func updateDiffsAfterRefresh() async {
        for (url, presentation) in diffs {
            let hasStaged = change(for: url, staged: true) != nil
            let hasUnstaged = change(for: url, staged: false) != nil
            guard hasStaged || hasUnstaged else {
                onDiffObsolete?(url)
                continue
            }
            if presentation.showsStaged ? !hasStaged : !hasUnstaged {
                diffs[url] = DiffPresentation(showsStaged: hasStaged)
            }
            staleDiffs.insert(url)
        }
        guard let active = activeDiff, staleDiffs.remove(active) != nil else { return }
        await loadDiff(for: active)
    }

    private nonisolated static func makeDiff(for change: GitChange, hasCommits: Bool, runner: GitRunner, root: URL) async -> DiffState {
        guard change.kind != .conflicted else { return .loaded(FileDiff(content: .conflict)) }
        do {
            let (old, new) = try await contents(of: change, hasCommits: hasCommits, runner: runner, root: root)
            let isBinaryKind = FileKind(url: URL(fileURLWithPath: change.path)) == .image
            let diff = await Task.detached(priority: .userInitiated) {
                FileDiff.make(old: old, new: new, isBinaryKind: isBinaryKind)
            }.value
            return .loaded(diff)
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    /// Bereitgestellt: HEAD gegen Index. Nicht bereitgestellt: Index gegen Arbeitsverzeichnis (gespeicherter Stand).
    private nonisolated static func contents(of change: GitChange, hasCommits: Bool, runner: GitRunner, root: URL) async throws -> (Data?, Data?) {
        let oldPath = change.originalPath ?? change.path
        let blob = { (spec: String) in try await runner.run(["cat-file", "blob", spec]) }
        if change.isStaged {
            let old = change.kind == .added || !hasCommits ? nil : try await blob("HEAD:" + oldPath)
            let new = change.kind == .deleted ? nil : try await blob(":" + change.path)
            return (old, new)
        }
        let old = change.kind == .untracked ? nil : try await blob(":" + oldPath)
        let new = change.kind == .deleted ? nil : try? Data(contentsOf: root.appendingPathComponent(change.path))
        return (old, new)
    }

    // MARK: Warteschlange

    /// Git-Befehle nie gleichzeitig: Jeder wartet auf den vorherigen (sonst Konflikte um `index.lock`).
    private func enqueue<T: Sendable>(_ work: @escaping @Sendable () async -> T) async -> T {
        let previous = queueTail
        let task = Task.detached(priority: .userInitiated) {
            await previous?.value
            return await work()
        }
        queueTail = Task { _ = await task.value }
        return await task.value
    }
}

/// Lokale Branches und Remotes (für das Branch-Menü und Push ohne Upstream).
struct GitReferences: Sendable {
    let branches: [String]
    let remotes: [String]

    static func load(with runner: GitRunner) async throws -> GitReferences {
        let branchOutput = try await runner.run(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        let remoteOutput = try await runner.run(["remote"])
        return GitReferences(branches: lines(branchOutput).sorted(), remotes: lines(remoteOutput))
    }

    private static func lines(_ data: Data) -> [String] {
        String(decoding: data, as: UTF8.self).split(separator: "\n").map(String.init)
    }
}
