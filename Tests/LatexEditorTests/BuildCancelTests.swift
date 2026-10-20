import Foundation
import Testing
@testable import LatexEditor

/// Erster Aufruf hängt (bis zum Abbruch), danach läuft alles sofort durch.
private actor HangingThenFastLatexmk {
    private(set) var calls = 0

    func run(_ request: LatexBuildRequest) async throws -> LatexBuildResult {
        calls += 1
        if calls == 1 { try await Task.sleep(for: .seconds(30)) }
        return LatexBuildResult(exitCode: 0, output: "", latexLog: nil, biberLog: nil, duration: .milliseconds(1))
    }
}

@Suite("Kompilieren abbrechen", .serialized)
@MainActor
struct BuildCancelTests {
    private func makeDefaults() -> UserDefaults { temporaryDefaults() }

    @Test("Abbrechen: Status „abgebrochen“, Vorgemerktes entfällt, kein PDF-Neuladen; danach geht es wieder")
    func cancelStopsBuild() async throws {
        let fake = HangingThenFastLatexmk()
        let store = BuildStore(defaults: makeDefaults()) { try await fake.run($0) }
        var finished = 0
        store.onFinished = { finished += 1 }
        let request = LatexBuildRequest(mainFile: URL(fileURLWithPath: "/p/main.tex"))

        store.requestBuild(request)
        try await Task.sleep(for: .milliseconds(30))
        store.requestBuild(request)
        store.cancelBuild()
        for _ in 0..<200 where store.isRunning { try await Task.sleep(for: .milliseconds(10)) }

        #expect(!store.isRunning)
        #expect(store.status == .cancelled)
        #expect(await fake.calls == 1, "der vorgemerkte zweite Auftrag läuft nicht")
        #expect(finished == 0)

        store.requestBuild(request)
        for _ in 0..<200 where store.isRunning { try await Task.sleep(for: .milliseconds(10)) }
        #expect(store.status == .succeeded)
        #expect(finished == 1)
    }

    @Test("Abbrechen ohne laufenden Build tut nichts")
    func cancelWhenIdle() {
        let store = BuildStore(defaults: makeDefaults()) { _ in throw CancellationError() }
        store.cancelBuild()
        #expect(store.status == .idle)
    }

    @Test("Nächste und vorherige Meldung: Reihenfolge, Umlauf, ohne Auswahl der erste bzw. letzte")
    func adjacentIssues() {
        func issue(_ id: Int) -> BuildIssue {
            BuildIssue(id: id, severity: .error, message: "m\(id)", fileURL: URL(fileURLWithPath: "/p/a.tex"), line: id)
        }
        let issues = [issue(4), issue(7), issue(9)]
        #expect(AppModel.adjacentIssue(in: issues, after: nil, direction: 1)?.id == 4)
        #expect(AppModel.adjacentIssue(in: issues, after: nil, direction: -1)?.id == 9)
        #expect(AppModel.adjacentIssue(in: issues, after: 4, direction: 1)?.id == 7)
        #expect(AppModel.adjacentIssue(in: issues, after: 9, direction: 1)?.id == 4, "Umlauf")
        #expect(AppModel.adjacentIssue(in: issues, after: 4, direction: -1)?.id == 9, "Umlauf rückwärts")
        #expect(AppModel.adjacentIssue(in: [], after: nil, direction: 1) == nil)
    }
}

extension AppModelSuite {
@Suite("Kompilieren abbrechen und aufräumen mit echtem latexmk", .serialized, .enabled(if: LatexToolchain.latexmk() != nil))
@MainActor
struct RealLatexmkTests {
    /// Rechnet rund 40 s, wenn niemand abbricht
    private static let slowDocument = """
        \\documentclass{article}
        \\begin{document}
        \\newcount\\mycount \\mycount=0
        \\def\\myloop{\\advance\\mycount by 1 \\ifnum\\mycount<100000000 \\expandafter\\myloop\\fi}
        \\myloop
        Fertig.
        \\end{document}
        """

    private func isProcessRunning(matching pattern: String) throws -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-f", pattern]
        process.standardOutput = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus == 0
    }

    @Test("Abbruch beendet latexmk und seine Kindprozesse innerhalb weniger Sekunden")
    func cancelKillsLatexmkAndChildren() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        // Der Dateiname steht in den Kommandozeilen von latexmk und pdflatex und macht sie auffindbar
        let marker = "langsam-\(UUID().uuidString)"
        let main = try project.write("\(marker).tex", Self.slowDocument)

        let started = ContinuousClock.now
        let task = Task { try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main)) }
        try await Task.sleep(for: .milliseconds(1_200))
        #expect(try isProcessRunning(matching: marker), "der Build läuft")
        task.cancel()
        await #expect(throws: CancellationError.self) { _ = try await task.value }

        #expect(ContinuousClock.now - started < .seconds(15))
        for _ in 0..<50 where try isProcessRunning(matching: marker) { try await Task.sleep(for: .milliseconds(100)) }
        #expect(try !isProcessRunning(matching: marker), "kein pdflatex/latexmk übrig")
    }

    @Test("Hilfsdateien löschen: aux und log verschwinden, das PDF bleibt")
    func cleanKeepsPDF() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "\\documentclass{article}\n\\begin{document}\nHallo\n\\end{document}\n")
        let model = AppModel.shared
        model.confirmCleanup = { true }
        await model.openProject(project.root)
        let result = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        #expect(result.succeeded)
        #expect(FileManager.default.fileExists(atPath: project.url("main.aux").path))

        await model.cleanBuildFiles()

        #expect(!FileManager.default.fileExists(atPath: project.url("main.aux").path))
        #expect(!FileManager.default.fileExists(atPath: project.url("main.log").path))
        #expect(FileManager.default.fileExists(atPath: project.url("main.pdf").path))
        #expect(try String(contentsOf: main, encoding: .utf8).contains("Hallo"), "der Text bleibt")
    }

    @Test("Hilfsdateien löschen: „Abbrechen“ in der Rückfrage ändert nichts")
    func cleanCancelled() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "\\documentclass{article}\n\\begin{document}\nHallo\n\\end{document}\n")
        let model = AppModel.shared
        model.confirmCleanup = { false }
        await model.openProject(project.root)
        _ = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))

        await model.cleanBuildFiles()

        #expect(FileManager.default.fileExists(atPath: project.url("main.aux").path))
    }
}
}
