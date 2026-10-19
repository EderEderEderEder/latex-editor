import Foundation

/// Findet ein Git-Programm. `/usr/bin/git` wird bewusst nicht aufgerufen: Ohne Command Line Tools
/// öffnet es den Installationsdialog von macOS, statt einfach zu fehlen.
enum GitLocator {
    static let missingMessage = """
        Git wurde nicht gefunden. Git gehört zu den Xcode Command Line Tools: \
        im Terminal „xcode-select --install“ ausführen und die App neu starten.
        """
    /// Ziel von `xcode-select -s` (Xcode oder Command Line Tools)
    private static let developerDirectoryLink = "/var/db/xcode_select_link"
    private static let fixedCandidates = [
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
        "/Library/Developer/CommandLineTools/usr/bin/git",
        "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
    ]

    static func locate() -> URL? {
        locate(in: candidates(), isExecutable: FileManager.default.isExecutableFile(atPath:))
    }

    static func locate(in candidates: [String], isExecutable: (String) -> Bool) -> URL? {
        candidates.first(where: isExecutable).map { URL(fileURLWithPath: $0) }
    }

    private static func candidates() -> [String] {
        let selected = try? FileManager.default.destinationOfSymbolicLink(atPath: developerDirectoryLink)
        let selectedGit = selected.map { $0 + "/usr/bin/git" }
        return Array(fixedCandidates.prefix(2)) + [selectedGit].compactMap { $0 } + fixedCandidates.dropFirst(2)
    }
}

enum GitError: Error, Equatable, LocalizedError {
    case gitMissing
    case launchFailed(String)
    /// Git hat mit Fehler beendet; `message` enthält stderr (und stdout, z. B. Ausgaben von Hooks).
    case commandFailed(command: String, status: Int32, message: String)

    var errorDescription: String? {
        switch self {
        case .gitMissing: GitLocator.missingMessage
        case let .launchFailed(reason): "Git konnte nicht gestartet werden: \(reason)"
        case let .commandFailed(_, _, message): Self.userMessage(for: message)
        }
    }

    /// Übersetzt häufige Git-Meldungen (Git läuft mit `LC_ALL=C`, also auf Englisch).
    static func userMessage(for message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let contains = { (patterns: [String]) in patterns.contains { trimmed.contains($0) } }
        if contains(["Author identity unknown", "Please tell me who you are", "empty ident name"]) {
            return """
                Git kennt deinen Namen und deine E-Mail-Adresse noch nicht. Bitte einmalig im Terminal setzen:

                git config --global user.name "Vorname Nachname"
                git config --global user.email "name@example.com"
                """
        }
        if trimmed.contains("index.lock") {
            return "Ein anderer Git-Vorgang läuft gerade (index.lock existiert). Bitte kurz warten und erneut versuchen."
        }
        if contains(["nothing to commit", "nothing added to commit"]) { return "Es gibt nichts zu committen." }
        return networkMessage(for: trimmed, contains: contains)
            ?? branchMessage(for: trimmed, contains: contains)
            ?? (trimmed.isEmpty ? "Git ist fehlgeschlagen." : "Git meldet:\n\(trimmed)")
    }

    private static func networkMessage(for message: String, contains: ([String]) -> Bool) -> String? {
        if contains(["Authentication failed", "could not read Username", "could not read Password",
                     "terminal prompts disabled", "Permission denied (publickey"]) {
            return """
                Die Anmeldung beim Remote ist fehlgeschlagen. Die App kann nicht nach Passwörtern fragen.
                Bitte einmal im Terminal „git push“ (bzw. „git pull“) im Projektordner ausführen und sich anmelden. \
                Danach liegt die Anmeldung im Schlüsselbund, und die App kann sie benutzen.
                """
        }
        if contains(["Could not resolve host", "Network is unreachable", "Operation timed out", "Connection refused",
                     "Connection timed out", "Failed to connect", "too slow", "Could not read from remote"]) {
            return "Der Remote ist nicht erreichbar. Besteht eine Internetverbindung?\n\n\(message)"
        }
        if contains(["[rejected]", "fetch first", "non-fast-forward"]) {
            return "Der Remote hat Commits, die lokal noch fehlen. Erst Pull, dann Push."
        }
        if contains(["Not possible to fast-forward", "Diverging branches", "have diverged"]) {
            return """
                Lokaler Stand und Remote sind auseinandergelaufen: Beide haben neue Commits. \
                Die App holt nur Änderungen, die sich ohne Zusammenführen übernehmen lassen. \
                Zusammenführen bitte im Terminal („git pull“).
                """
        }
        if contains(["There is no tracking information", "has no upstream branch"]) {
            return "Für diesen Branch ist noch kein Remote-Branch eingerichtet. Zuerst Push ausführen."
        }
        if contains(["No configured push destination", "No remote repository specified", "does not appear to be a git repository"]) {
            return "Für dieses Repository ist kein Remote eingerichtet."
        }
        return nil
    }

    private static func branchMessage(for message: String, contains: ([String]) -> Bool) -> String? {
        if contains(["would be overwritten by", "untracked working tree files would be"]) {
            let files = message.split(separator: "\n").filter { $0.hasPrefix("\t") }.map { $0.trimmingCharacters(in: .whitespaces) }
            let list = files.isEmpty ? "" : "\n\n" + files.joined(separator: "\n")
            return "Lokale Änderungen würden überschrieben. Bitte zuerst committen oder verwerfen.\(list)"
        }
        if contains(["is not a valid branch name"]) { return "Ungültiger Branch-Name (keine Leerzeichen, kein „..“, nicht mit „-“ beginnen)." }
        if contains(["already exists"]) { return "Ein Branch mit diesem Namen existiert bereits." }
        return nil
    }
}

/// Startet Git-Befehle per `Process`, abseits des Main-Threads. Ausgaben gehen in Temp-Dateien statt
/// in Pipes, damit eine volle Pipe Git nie blockiert.
struct GitRunner: Sendable {
    struct Output: Sendable {
        let status: Int32
        let standardOutput: Data
        let standardError: String
    }

    let executable: URL
    let directory: URL
    /// Zusätzliche Umgebung (Tests: z. B. eigene Git-Konfiguration)
    var extraEnvironment: [String: String] = [:]

    private static let systemPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    private static let fixedEnvironment = [
        // Englische Meldungen, damit `GitError.userMessage` sie erkennt
        "LC_ALL": "C",
        // Nie nach Passwörtern fragen und nie einen Editor oder Pager öffnen
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_EDITOR": "true",
        "GIT_PAGER": "cat",
        // `git status` schreibt sonst den Index neu (Konflikte mit index.lock, Änderungen in fremden Repos)
        "GIT_OPTIONAL_LOCKS": "0",
        // Pfade mit `*`, `?` oder `:` sind Dateinamen, keine Muster
        "GIT_LITERAL_PATHSPECS": "1",
        // Netzwerk: abbrechen, wenn 30 s lang weniger als 1 KB/s ankommt (sonst hängt ein Pull ewig)
        "GIT_HTTP_LOW_SPEED_LIMIT": "1000",
        "GIT_HTTP_LOW_SPEED_TIME": "30",
    ]
    /// SSH ohne Rückfragen (kein Terminal) und mit Zeitlimit; eine eigene Einstellung des Nutzers hat Vorrang.
    private static let sshCommand = "ssh -o BatchMode=yes -o ConnectTimeout=15"

    static func environment(base: [String: String]) -> [String: String] {
        var environment = base
        let inherited = base["PATH"].map { ":" + $0 } ?? ""
        environment["PATH"] = systemPath + inherited
        environment.merge(fixedEnvironment) { _, new in new }
        if environment["GIT_SSH_COMMAND"] == nil { environment["GIT_SSH_COMMAND"] = sshCommand }
        return environment
    }

    /// Führt Git aus und wirft bei einem Exit-Code ungleich 0.
    @discardableResult
    func run(_ arguments: [String]) async throws -> Data {
        let output = try await execute(arguments)
        guard output.status == 0 else {
            let stdout = String(decoding: output.standardOutput, as: UTF8.self)
            throw GitError.commandFailed(
                command: arguments.first ?? "",
                status: output.status,
                message: [output.standardError, stdout].filter { !$0.isEmpty }.joined(separator: "\n")
            )
        }
        return output.standardOutput
    }

    func execute(_ arguments: [String]) async throws -> Output {
        let temporary = FileManager.default.temporaryDirectory
        let stdoutURL = temporary.appendingPathComponent("git-\(UUID().uuidString).out")
        let stderrURL = temporary.appendingPathComponent("git-\(UUID().uuidString).err")
        defer {
            try? FileManager.default.removeItem(at: stdoutURL)
            try? FileManager.default.removeItem(at: stderrURL)
        }
        let status = try await launch(arguments, stdoutURL: stdoutURL, stderrURL: stderrURL)
        return Output(
            status: status,
            standardOutput: (try? Data(contentsOf: stdoutURL)) ?? Data(),
            standardError: (try? String(contentsOf: stderrURL, encoding: .utf8)) ?? ""
        )
    }

    private func launch(_ arguments: [String], stdoutURL: URL, stderrURL: URL) async throws -> Int32 {
        FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
        FileManager.default.createFile(atPath: stderrURL.path, contents: nil)
        let stdout = try FileHandle(forWritingTo: stdoutURL)
        let stderr = try FileHandle(forWritingTo: stderrURL)
        defer {
            try? stdout.close()
            try? stderr.close()
        }

        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = directory
        process.environment = Self.environment(base: ProcessInfo.processInfo.environment).merging(extraEnvironment) { _, new in new }
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = FileHandle.nullDevice

        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { finished in
                continuation.resume(returning: finished.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                process.terminationHandler = nil
                continuation.resume(throwing: GitError.launchFailed(error.localizedDescription))
            }
        }
    }
}

/// Ein gefundenes Repository. Der Projektordner kann das Repository selbst oder ein Unterordner davon sein.
struct GitRepository: Equatable, Sendable {
    /// Wurzel des Arbeitsverzeichnisses (echter Pfad, Arbeitsordner für alle Git-Aufrufe)
    let root: URL
    /// `.git`-Ordner (echter Pfad, kann außerhalb des Projektordners liegen)
    let gitDirectory: URL
    /// Projektordner, wie er geöffnet wurde (so entstehen auch die URLs im Dateibaum)
    let projectRoot: URL
    /// Pfad des Projektordners relativ zur Wurzel, `nil`, wenn beide gleich sind
    let projectPrefix: String?

    init(root: URL, gitDirectory: URL, projectRoot: URL) {
        self.root = root
        self.gitDirectory = gitDirectory
        self.projectRoot = projectRoot
        let rootPath = Self.canonicalPath(root)
        let projectPath = Self.canonicalPath(projectRoot)
        projectPrefix = projectPath.hasPrefix(rootPath + "/") ? String(projectPath.dropFirst(rootPath.count + 1)) : nil
    }

    /// Sucht das Repository, zu dem der Ordner gehört. `nil`: kein Git-Repository.
    static func discover(project: URL, git: URL) async throws -> GitRepository? {
        let runner = GitRunner(executable: git, directory: project)
        let output = try await runner.execute(["rev-parse", "--show-toplevel", "--absolute-git-dir"])
        guard output.status == 0 else {
            if output.standardError.contains("not a git repository") { return nil }
            throw GitError.commandFailed(command: "rev-parse", status: output.status, message: output.standardError)
        }
        let lines = String(decoding: output.standardOutput, as: UTF8.self).split(separator: "\n").map(String.init)
        // Im `.git`-Ordner selbst gibt es kein Arbeitsverzeichnis
        guard lines.count == 2 else { return nil }
        return GitRepository(
            root: URL(fileURLWithPath: lines[0], isDirectory: true),
            gitDirectory: URL(fileURLWithPath: lines[1], isDirectory: true),
            projectRoot: project
        )
    }

    /// Datei im Projekt zu einem Pfad relativ zur Wurzel, `nil` für Dateien außerhalb des Projektordners.
    func projectURL(forRepositoryPath path: String) -> URL? {
        guard let projectPrefix else { return projectRoot.appendingPathComponent(path).standardizedFileURL }
        guard path.hasPrefix(projectPrefix + "/") else { return nil }
        return projectRoot.appendingPathComponent(String(path.dropFirst(projectPrefix.count + 1))).standardizedFileURL
    }

    /// Pfad relativ zur Wurzel des Repositorys für eine Datei im Projekt.
    func repositoryPath(for url: URL) -> String? {
        let projectPath = projectRoot.standardizedFileURL.path
        let filePath = url.standardizedFileURL.path
        guard filePath.hasPrefix(projectPath + "/") else { return nil }
        let relative = String(filePath.dropFirst(projectPath.count + 1))
        return projectPrefix.map { $0 + "/" + relative } ?? relative
    }

    func isInsideProject(repositoryPath path: String) -> Bool {
        projectURL(forRepositoryPath: path) != nil
    }

    /// Echter Pfad ohne Symlinks. `/var` und `/private/var` sind sonst zwei verschiedene Ordner;
    /// `URL.resolvingSymlinksInPath` hilft nicht, weil es `/private` gerade wieder entfernt.
    static func canonicalPath(_ url: URL) -> String {
        guard let resolved = realpath(url.path, nil) else { return url.standardizedFileURL.path }
        defer { free(resolved) }
        return String(cString: resolved)
    }
}
