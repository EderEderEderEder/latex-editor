import Foundation

/// Findet latexmk und baut die Prozessumgebung. Eine GUI-App erbt nicht den PATH der Shell,
/// deshalb wird `/Library/TeX/texbin` (MacTeX) ausdrücklich vorangestellt.
enum LatexToolchain {
    static let texBinDirectory = URL(fileURLWithPath: "/Library/TeX/texbin", isDirectory: true)
    static let missingMessage = """
        MacTeX wurde nicht gefunden: latexmk fehlt in /Library/TeX/texbin. \
        Bitte MacTeX installieren (https://tug.org/mactex/) und die App neu starten.
        """
    private static let systemPath = "/usr/bin:/bin:/usr/sbin:/sbin"
    /// Verhindert Zeilenumbrüche im Log bei 79 Zeichen, die sonst Pfade und Meldungen zerreißen.
    private static let logLineSettings = ["max_print_line": "10000", "error_line": "254", "half_error_line": "238"]

    static func latexmk(in directory: URL = texBinDirectory) -> URL? {
        let candidate = directory.appendingPathComponent("latexmk")
        return FileManager.default.isExecutableFile(atPath: candidate.path) ? candidate : nil
    }

    static func environment(base: [String: String], texBin: URL = texBinDirectory) -> [String: String] {
        var environment = base
        let inherited = base["PATH"].map { ":" + $0 } ?? ""
        environment["PATH"] = texBin.path + ":" + systemPath + inherited
        environment.merge(logLineSettings) { _, new in new }
        return environment
    }
}

struct LatexBuildRequest: Equatable, Sendable {
    let mainFile: URL
}

struct LatexBuildResult: Sendable {
    let exitCode: Int32
    /// Ausgabe von latexmk (stdout und stderr)
    let output: String
    /// Inhalt von `<main>.log`, falls vorhanden
    let latexLog: String?
    /// Inhalt von `<main>.blg` (Biber), falls vorhanden
    let biberLog: String?
    let duration: Duration

    var succeeded: Bool { exitCode == 0 }
}

enum LatexBuildError: Error, Equatable {
    case toolchainMissing
    case launchFailed(String)
}

/// Startet `latexmk` für die Hauptdatei. Läuft vollständig abseits des Main-Threads.
enum LatexBuildRunner {
    static let arguments = ["-pdf", "-synctex=1", "-interaction=nonstopmode", "-file-line-error", "-cd"]
    /// Löscht die beim Kompilieren erzeugten Hilfsdateien (aux, log, toc, bbl …), das PDF bleibt.
    static let cleanArguments = ["-c", "-cd"]
    /// So lange darf latexmk nach „Abbrechen“ aufräumen, bevor es hart beendet wird
    private static let interruptGracePeriod = Duration.seconds(3)
    /// Dateisysteme speichern Änderungszeiten teils nur sekundengenau.
    private static let timestampTolerance: TimeInterval = 1

    static func run(_ request: LatexBuildRequest, latexmk: URL? = LatexToolchain.latexmk()) async throws -> LatexBuildResult {
        guard let latexmk else { throw LatexBuildError.toolchainMissing }
        let measurement = Signposts.begin("Build")
        defer { measurement.end() }
        let start = ContinuousClock.now
        let startDate = Date()
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("latexmk-\(UUID().uuidString).txt")
        defer { try? FileManager.default.removeItem(at: outputURL) }

        let exitCode = try await launch(latexmk, arguments: arguments, mainFile: request.mainFile, outputURL: outputURL)
        // Nach „Abbrechen“ sind Logs und PDF halb geschrieben: nichts davon auswerten.
        try Task.checkCancellation()
        // Erfolg ohne Neulauf („alles aktuell“): Das vorhandene Log ist gültig. Nach einem Fehlschlag
        // nur Logs dieses Builds lesen, sonst stammen die Meldungen vom letzten Lauf.
        let minimumDate = exitCode == 0 ? Date.distantPast : startDate
        return LatexBuildResult(
            exitCode: exitCode,
            output: (try? String(contentsOf: outputURL, encoding: .utf8)) ?? "",
            latexLog: readSibling(of: request.mainFile, extension: "log", notOlderThan: minimumDate),
            biberLog: readSibling(of: request.mainFile, extension: "blg", notOlderThan: minimumDate),
            duration: ContinuousClock.now - start
        )
    }

    /// Hilfsdateien löschen (`latexmk -c`); Ausgabe wird verworfen. Liefert den Exit-Code.
    static func clean(mainFile: URL, latexmk: URL? = LatexToolchain.latexmk()) async throws -> Int32 {
        guard let latexmk else { throw LatexBuildError.toolchainMissing }
        let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent("latexmk-clean-\(UUID().uuidString).txt")
        defer { try? FileManager.default.removeItem(at: outputURL) }
        return try await launch(latexmk, arguments: cleanArguments, mainFile: mainFile, outputURL: outputURL)
    }

    /// Prozess für den Abbruch: `Process` ist nicht `Sendable`, `interrupt`/`terminate` sind aber von jedem Thread erlaubt.
    private final class ProcessBox: @unchecked Sendable {
        let process = Process()
    }

    private static func launch(_ latexmk: URL, arguments: [String], mainFile: URL, outputURL: URL) async throws -> Int32 {
        FileManager.default.createFile(atPath: outputURL.path, contents: nil)
        let output = try FileHandle(forWritingTo: outputURL)
        defer { try? output.close() }

        let box = ProcessBox()
        let process = box.process
        process.executableURL = latexmk
        process.arguments = arguments + [mainFile.lastPathComponent]
        process.currentDirectoryURL = mainFile.deletingLastPathComponent()
        process.environment = LatexToolchain.environment(base: ProcessInfo.processInfo.environment)
        // Ausgabe in eine Datei statt in eine Pipe: Eine volle Pipe würde latexmk blockieren.
        process.standardOutput = output
        process.standardError = output
        process.standardInput = FileHandle.nullDevice

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                process.terminationHandler = { finished in
                    continuation.resume(returning: finished.terminationStatus)
                }
                do {
                    try process.run()
                } catch {
                    process.terminationHandler = nil
                    continuation.resume(throwing: LatexBuildError.launchFailed(error.localizedDescription))
                }
            }
        } onCancel: {
            interrupt(box)
        }
    }

    /// Wie Ctrl-C im Terminal: latexmk beendet seine Kindprozesse (pdflatex, biber) selbst. Reagiert es nicht, wird es hart beendet.
    private static func interrupt(_ box: ProcessBox) {
        guard box.process.isRunning else { return }
        box.process.interrupt()
        Task.detached {
            try? await Task.sleep(for: interruptGracePeriod)
            if box.process.isRunning { box.process.terminate() }
        }
    }

    /// Liest `<main>.<extension>`, aber nur, wenn die Datei in diesem Build geschrieben wurde.
    /// Bricht latexmk vor pdflatex ab, läge sonst das Log des letzten Builds mit veralteten Fehlern da.
    private static func readSibling(of mainFile: URL, extension fileExtension: String, notOlderThan date: Date) -> String? {
        let url = mainFile.deletingPathExtension().appendingPathExtension(fileExtension)
        let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        guard let modified, modified >= date.addingTimeInterval(-timestampTolerance),
              let data = try? Data(contentsOf: url) else { return nil }
        // TeX schreibt Logs nicht immer gültig in UTF-8 (z. B. Latin-1-Zeichen in Meldungen).
        return String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
    }
}
