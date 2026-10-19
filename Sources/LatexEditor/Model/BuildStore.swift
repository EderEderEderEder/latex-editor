import Foundation
import Observation

enum BuildStatus: Equatable, Sendable {
    case idle
    case running
    case succeeded
    case failed
    /// Vom Nutzer abgebrochen: Meldungen und PDF stammen noch vom Build davor
    case cancelled
    /// MacTeX fehlt oder latexmk ließ sich nicht starten
    case unavailable(String)
}

/// Ergebnis der Auswertung eines Builds (im Hintergrund berechnet).
struct BuildReport: Sendable {
    let issues: [BuildIssue]
    /// Pro Datei: Zeile → schwerste Meldung (für die Markierung in der Zeilennummernleiste)
    let marksByFile: [URL: [Int: BuildIssue.Severity]]
    let rawLog: String
    let succeeded: Bool

    static func make(from result: LatexBuildResult, mainFile: URL) -> BuildReport {
        let measurement = Signposts.begin("BuildReport")
        defer { measurement.end() }
        var issues = LatexLogParser.parse(result.latexLog ?? "", baseDirectory: mainFile.deletingLastPathComponent())
        issues += BiberLogParser.parse(result.biberLog ?? "", firstID: issues.count)
        let hasErrors = issues.contains { $0.severity == .error }
        if !result.succeeded, !hasErrors {
            let message = "latexmk ist fehlgeschlagen (Exit-Code \(result.exitCode)). Details im Log."
            issues.insert(BuildIssue(id: issues.count, severity: .error, message: message, fileURL: nil, line: nil), at: 0)
        }
        return BuildReport(
            issues: issues.sorted { ($0.severity, $0.id) < ($1.severity, $1.id) },
            marksByFile: marks(for: issues),
            rawLog: result.output + "\n\n===== \(mainFile.deletingPathExtension().lastPathComponent).log =====\n" + (result.latexLog ?? "(kein Log)"),
            succeeded: result.succeeded && !hasErrors
        )
    }

    private static func marks(for issues: [BuildIssue]) -> [URL: [Int: BuildIssue.Severity]] {
        var marks: [URL: [Int: BuildIssue.Severity]] = [:]
        for issue in issues {
            guard let file = issue.fileURL, let line = issue.line else { continue }
            marks[file, default: [:]][line] = min(marks[file]?[line] ?? issue.severity, issue.severity)
        }
        return marks
    }
}

/// Kompilieren per latexmk. Nie parallel: Kommt während eines Builds ein neuer Auftrag,
/// wird er vorgemerkt (höchstens einer) und danach ausgeführt. Abbrechen wäre riskant,
/// weil latexmk pdflatex/biber als Kindprozesse startet und halb geschriebene Hilfsdateien hinterlässt.
@MainActor
@Observable
final class BuildStore {
    typealias Runner = @Sendable (LatexBuildRequest) async throws -> LatexBuildResult

    private static let compileOnSaveKey = "compileOnSave"

    private(set) var status = BuildStatus.idle
    private(set) var issues: [BuildIssue] = []
    private(set) var marksByFile: [URL: [Int: BuildIssue.Severity]] = [:]
    private(set) var rawLog = ""
    private(set) var lastDuration: Duration?
    /// Zuletzt angesprungene Meldung (Klick in der Liste oder „Nächste Meldung“), wird im Listenbild hervorgehoben
    var selectedIssueID: Int?
    /// Sheet mit dem rohen Log sichtbar (UI-Zustand, nicht gespeichert)
    var isLogVisible = false
    var compileOnSave: Bool {
        didSet { defaults.set(compileOnSave, forKey: Self.compileOnSaveKey) }
    }

    /// Wird nach jedem abgeschlossenen Build aufgerufen (z. B. um das PDF einmalig neu zu laden).
    @ObservationIgnored var onFinished: (() -> Void)?
    @ObservationIgnored private(set) var isRunning = false
    @ObservationIgnored private var pendingRequest: LatexBuildRequest?
    @ObservationIgnored private var buildTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private let runner: Runner
    @ObservationIgnored private let defaults: UserDefaults

    var errorCount: Int { issues.count { $0.severity == .error } }
    var warningCount: Int { issues.count { $0.severity == .warning } }
    var badBoxCount: Int { issues.count { $0.severity == .badBox } }

    init(defaults: UserDefaults = .standard, runner: @escaping Runner = { try await LatexBuildRunner.run($0) }) {
        self.defaults = defaults
        self.runner = runner
        compileOnSave = defaults.object(forKey: Self.compileOnSaveKey) as? Bool ?? true
    }

    func requestBuild(_ request: LatexBuildRequest) {
        pendingRequest = request
        guard !isRunning else { return }
        isRunning = true
        if status != .running { status = .running }
        let currentGeneration = generation
        buildTask = Task { await processQueue(generation: currentGeneration) }
    }

    /// Bricht den laufenden Build ab (latexmk bekommt wie bei Ctrl-C ein Abbruchsignal); Vorgemerktes entfällt.
    func cancelBuild() {
        guard isRunning else { return }
        pendingRequest = nil
        buildTask?.cancel()
    }

    /// Beim Projektwechsel: Ergebnisse verwerfen; ein laufender Build darf danach nichts mehr setzen.
    func reset() {
        generation += 1
        pendingRequest = nil
        buildTask?.cancel()
        buildTask = nil
        isRunning = false
        status = .idle
        selectedIssueID = nil
        issues = []
        marksByFile = [:]
        rawLog = ""
        lastDuration = nil
    }

    private func processQueue(generation queueGeneration: Int) async {
        while let request = pendingRequest, queueGeneration == generation, !Task.isCancelled {
            pendingRequest = nil
            await perform(request, generation: queueGeneration)
        }
        guard queueGeneration == generation else { return }
        isRunning = false
        buildTask = nil
        // Nach einem Abbruch ist das PDF unter Umständen unvollständig: nicht neu laden
        if status != .cancelled { onFinished?() }
    }

    private func perform(_ request: LatexBuildRequest, generation buildGeneration: Int) async {
        do {
            let result = try await runner(request)
            try Task.checkCancellation()
            let report = await Task.detached(priority: .userInitiated) {
                BuildReport.make(from: result, mainFile: request.mainFile)
            }.value
            guard buildGeneration == generation else { return }
            apply(report, duration: result.duration)
        } catch {
            guard buildGeneration == generation else { return }
            if error is CancellationError || Task.isCancelled {
                status = .cancelled
                return
            }
            let message = (error as? LatexBuildError) == .toolchainMissing
                ? LatexToolchain.missingMessage
                : "latexmk konnte nicht gestartet werden: \(error.localizedDescription)"
            status = .unavailable(message)
        }
    }

    private func apply(_ report: BuildReport, duration: Duration) {
        selectedIssueID = nil
        issues = report.issues
        marksByFile = report.marksByFile
        rawLog = report.rawLog
        lastDuration = duration
        // Ein vorgemerkter Folge-Build hält die Anzeige auf „läuft“.
        status = pendingRequest != nil ? .running : (report.succeeded ? .succeeded : .failed)
    }
}
