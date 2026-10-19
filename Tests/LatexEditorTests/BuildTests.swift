import Foundation
import Testing
@testable import LatexEditor

/// Zählt Aufrufe und lässt jeden Build eine kurze, feste Zeit laufen.
private actor FakeLatexmk {
    private(set) var requests: [LatexBuildRequest] = []
    private(set) var maximumConcurrent = 0
    private var running = 0

    func run(_ request: LatexBuildRequest, result: LatexBuildResult) async throws -> LatexBuildResult {
        requests.append(request)
        running += 1
        maximumConcurrent = max(maximumConcurrent, running)
        try await Task.sleep(for: .milliseconds(80))
        running -= 1
        return result
    }
}

private func result(exitCode: Int32 = 0, log: String? = nil) -> LatexBuildResult {
    LatexBuildResult(exitCode: exitCode, output: "latexmk-Ausgabe", latexLog: log, biberLog: nil, duration: .milliseconds(80))
}

private func request(_ name: String) -> LatexBuildRequest {
    LatexBuildRequest(mainFile: URL(fileURLWithPath: "/p/\(name).tex"))
}

@MainActor
private func waitUntilFinished(_ store: BuildStore) async throws {
    for _ in 0..<200 where store.isRunning { try await Task.sleep(for: .milliseconds(10)) }
    #expect(!store.isRunning)
}

@MainActor
private func makeDefaults() -> UserDefaults {
    UserDefaults(suiteName: "LatexEditorTests-\(UUID().uuidString)")!
}

@Suite("Build-Store", .serialized)
@MainActor
struct BuildStoreTests {
    @Test("Aufträge während eines Builds werden zusammengefasst, nie parallel")
    func coalescesRequests() async throws {
        let fake = FakeLatexmk()
        let store = BuildStore(defaults: makeDefaults()) { try await fake.run($0, result: result()) }

        store.requestBuild(request("erster"))
        try await Task.sleep(for: .milliseconds(20))
        store.requestBuild(request("zweiter"))
        store.requestBuild(request("dritter"))
        try await waitUntilFinished(store)

        #expect(await fake.requests == [request("erster"), request("dritter")])
        #expect(await fake.maximumConcurrent == 1)
        #expect(store.status == .succeeded)
    }

    @Test("Fehler im Log ergeben Status „fehlgeschlagen“ mit Zählern und Markierungen")
    func failedBuildWithIssues() async throws {
        let log = try LogFixture.text("errors.log")
        let store = BuildStore(defaults: makeDefaults()) { _ in result(exitCode: 12, log: log) }

        store.requestBuild(LatexBuildRequest(mainFile: URL(fileURLWithPath: "/p/main.tex")))
        try await waitUntilFinished(store)

        #expect(store.status == .failed)
        #expect(store.errorCount == 4)
        #expect(store.marksByFile[URL(fileURLWithPath: "/p/chapters/kapitel.tex")]?[3] == .error)
        #expect(store.rawLog.contains("latexmk-Ausgabe"))
    }

    @Test("Exit-Code ungleich 0 ohne erkannte Fehler erzeugt einen Hinweis auf das Log")
    func failureWithoutParsedErrors() async throws {
        let store = BuildStore(defaults: makeDefaults()) { _ in result(exitCode: 1, log: nil) }
        store.requestBuild(request("main"))
        try await waitUntilFinished(store)

        #expect(store.status == .failed)
        #expect(store.issues.first?.message.contains("Exit-Code 1") == true)
    }

    @Test("Fehlendes MacTeX ergibt eine verständliche Meldung")
    func missingToolchain() async throws {
        let store = BuildStore(defaults: makeDefaults()) { _ in throw LatexBuildError.toolchainMissing }
        store.requestBuild(request("main"))
        try await waitUntilFinished(store)

        #expect(store.status == .unavailable(LatexToolchain.missingMessage))
    }

    @Test("Projektwechsel während eines Builds verwirft dessen Ergebnis")
    func resetDiscardsRunningBuild() async throws {
        let fake = FakeLatexmk()
        let store = BuildStore(defaults: makeDefaults()) { try await fake.run($0, result: result(exitCode: 12, log: "./main.tex:1: X")) }
        store.requestBuild(request("alt"))
        try await Task.sleep(for: .milliseconds(20))
        store.reset()
        try await Task.sleep(for: .milliseconds(150))

        #expect(store.status == .idle)
        #expect(store.issues.isEmpty)
    }

    @Test("„Beim Speichern kompilieren“ ist standardmäßig an und wird gemerkt")
    func compileOnSavePreference() {
        let defaults = makeDefaults()
        let store = BuildStore(defaults: defaults) { _ in result() }
        #expect(store.compileOnSave)
        store.compileOnSave = false
        #expect(!BuildStore(defaults: defaults) { _ in result() }.compileOnSave)
    }

    @Test("PATH für den Prozess enthält MacTeX vor den Systempfaden, Log-Zeilen werden nicht umbrochen")
    func processEnvironment() {
        let environment = LatexToolchain.environment(base: ["PATH": "/usr/bin", "HOME": "/Users/x"])
        #expect(environment["PATH"]?.hasPrefix("/Library/TeX/texbin:") == true)
        #expect(environment["HOME"] == "/Users/x")
        #expect(environment["max_print_line"] == "10000")
        #expect(LatexToolchain.latexmk(in: URL(fileURLWithPath: "/gibt/es/nicht")) == nil)
    }
}

private let hasMacTeX = LatexToolchain.latexmk() != nil

@Suite("latexmk (echt, nur mit MacTeX)", .serialized, .enabled(if: hasMacTeX))
struct LatexmkIntegrationTests {
    private func makeProject() throws -> TemporaryProject {
        let project = try TemporaryProject()
        try project.makeDirectory("Ordner mit Leerzeichen")
        return project
    }

    @Test("Mini-Dokument kompiliert: PDF und SyncTeX entstehen neben der Hauptdatei")
    func compilesDocument() async throws {
        let project = try makeProject()
        defer { project.remove() }
        let main = try project.write("Ordner mit Leerzeichen/main.tex", """
            \\documentclass{article}
            \\begin{document}
            \\section{Hallo}
            Text.
            \\include{kapitel}
            \\end{document}
            """)
        try project.write("Ordner mit Leerzeichen/kapitel.tex", "\\section{Kapitel}\nMehr Text.\n")

        let result = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        let report = BuildReport.make(from: result, mainFile: main)

        #expect(result.succeeded, "\(result.output)")
        #expect(report.issues.filter { $0.severity == .error }.isEmpty)
        #expect(FileManager.default.fileExists(atPath: project.url("Ordner mit Leerzeichen/main.pdf").path))
        #expect(FileManager.default.fileExists(atPath: project.url("Ordner mit Leerzeichen/main.synctex.gz").path))
        print("⏱ latexmk Mini-Dokument: \(String(format: "%.0f", result.duration.milliseconds)) ms")
    }

    @Test("Fehler im eingebundenen Kapitel wird mit Datei und Zeile gemeldet")
    func reportsErrorInIncludedFile() async throws {
        let project = try makeProject()
        defer { project.remove() }
        let main = try project.write("Ordner mit Leerzeichen/main.tex", """
            \\documentclass{article}
            \\begin{document}
            \\include{chapters/zwei}
            \\end{document}
            """)
        try project.write("Ordner mit Leerzeichen/chapters/zwei.tex", "Erste Zeile.\nZweite Zeile.\nHier \\gibtsnicht{} kaputt.\n")

        let result = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        let report = BuildReport.make(from: result, mainFile: main)
        let error = try #require(report.issues.first { $0.severity == .error })

        #expect(!report.succeeded)
        #expect(error.fileURL == project.url("Ordner mit Leerzeichen/chapters/zwei.tex"))
        #expect(error.line == 3)
        #expect(error.message == "Undefined control sequence.")
    }

    @Test("Zweiter Build ohne Änderung („alles aktuell“) behält die Warnungen des gültigen Logs")
    func upToDateBuildKeepsWarnings() async throws {
        let project = try makeProject()
        defer { project.remove() }
        let main = try project.write("Ordner mit Leerzeichen/main.tex", """
            \\documentclass{article}
            \\begin{document}
            Siehe \\ref{fehlt}.
            \\end{document}
            """)

        let first = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        // Länger als die Zeitstempel-Toleranz warten, damit das Log eindeutig älter als der zweite Build ist.
        try await Task.sleep(for: .milliseconds(1_500))
        let second = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        let warnings = { (result: LatexBuildResult) in
            BuildReport.make(from: result, mainFile: main).issues.filter { $0.severity == .warning }.count
        }

        #expect(first.succeeded && second.succeeded)
        #expect(warnings(first) > 0)
        #expect(warnings(second) == warnings(first))
    }
}
