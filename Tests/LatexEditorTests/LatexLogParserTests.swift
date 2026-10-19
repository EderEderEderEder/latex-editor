import Foundation
import Testing
@testable import LatexEditor

/// Echte Logs, erzeugt mit MacTeX 2026 und den Flags der App (siehe TESTING.md).
enum LogFixture {
    static func text(_ name: String) throws -> String {
        let url = try #require(Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: nil))
        return try String(contentsOf: url, encoding: .utf8)
    }
}

private let project = URL(fileURLWithPath: "/Users/x/5 Semster/Projekt", isDirectory: true)
private let mainFile = project.appendingPathComponent("main.tex").standardizedFileURL
private let chapterFile = project.appendingPathComponent("chapters/kapitel.tex").standardizedFileURL

private func parse(_ fixture: String) throws -> [BuildIssue] {
    LatexLogParser.parse(try LogFixture.text(fixture), baseDirectory: project)
}

private func summary(_ issues: [BuildIssue]) -> [String] {
    issues.map { "\($0.severity) \($0.fileURL?.lastPathComponent ?? "-"):\($0.line.map(String.init) ?? "-") \($0.message)" }
}

@Suite("Log-Parser mit echten Logs")
struct LatexLogParserTests {
    @Test("Fehler mit Datei und Zeile, auch im eingebundenen Kapitel")
    func errors() throws {
        let issues = try parse("errors.log")
        #expect(summary(issues) == [
            "error kapitel.tex:3 Undefined control sequence.",
            "error kapitel.tex:6 LaTeX Error: \\begin{itemize} on input line 4 ended by \\end{enumerate}.",
            "error main.tex:5 Undefined control sequence.",
            "error main.tex:7 Missing $ inserted."
        ])
        #expect(issues[0].fileURL == chapterFile)
        #expect(issues[0].detail == "l.3 Ein \\undefiniert")
        #expect(issues[2].fileURL == mainFile)
    }

    @Test("Fehlendes Paket: Ursache statt Folgefehler, Datei aus dem Stapel, Zeile aus dem Kontext")
    func fatalMissingPackage() throws {
        let issues = try parse("fatal.log")
        #expect(summary(issues) == ["error main.tex:3 LaTeX Error: File `nichtvorhandenespaket.sty' not found."])
    }

    @Test("Warnungen: Referenzen, Zitate, mehrzeilige Package-Warnung, Box-Warnungen mit Dateistapel")
    func warnings() throws {
        let issues = try parse("warnings.log")
        #expect(summary(issues) == [
            "warning main.tex:7 Reference `sec:fehlt' on page 1 undefined",
            "warning main.tex:7 Citation `knuth1984' on page 1 undefined",
            "warning main.tex:8 Erste Zeile der Warnung zweite Zeile der Warnung",
            "badBox main.tex:10 Overfull \\hbox (198.77888pt too wide) in paragraph at lines 10--11",
            "warning kapitel.tex:2 Reference `gibtsnicht' on page 2 undefined",
            "badBox kapitel.tex:4 Underfull \\hbox (badness 10000) in paragraph at lines 4--5",
            "warning main.tex:- There were undefined references."
        ])
    }

    @Test("Sauberes Log ergibt keine Meldungen")
    func clean() throws {
        #expect(try parse("clean.log").isEmpty)
    }

    @Test("biblatex/biber: fehlender Eintrag im LaTeX-Log und im Biber-Log")
    func biber() throws {
        let latex = try parse("biber.log").filter { $0.severity == .warning }
        #expect(latex.contains { $0.message.contains("Citation 'fehlt' on page 1 undefined") && $0.line == 5 })

        let biber = BiberLogParser.parse(try LogFixture.text("biber.blg"), firstID: 100)
        #expect(biber.map(\.message) == ["Biber: I didn't find a database entry for 'fehlt' (section 0)"])
        #expect(biber.first?.severity == .warning)
        #expect(biber.first?.id == 100)
    }
}

@Suite("Log-Parser: Grenzfälle")
struct LatexLogParserEdgeCaseTests {
    @Test("Unausgeglichene Klammern im Fehlerkontext verfälschen den Dateistapel nicht")
    func unbalancedParenthesesInErrorContext() {
        let log = """
            (./main.tex (./chapters/a.tex
            ./chapters/a.tex:4: Undefined control sequence.
            l.4 Text (offen \\foo
                                 (noch offen
            )
            LaTeX Warning: Reference `x' on page 1 undefined on input line 9.

            """
        let issues = LatexLogParser.parse(log, baseDirectory: project)
        #expect(summary(issues) == [
            "error a.tex:4 Undefined control sequence.",
            "warning main.tex:9 Reference `x' on page 1 undefined"
        ])
    }

    @Test("Klammern im Box-Inhalt werden ignoriert")
    func parenthesesInBadBoxContent() {
        let log = """
            (./main.tex
            Overfull \\hbox (1.0pt too wide) in paragraph at lines 3--3
            []\\OT1/cmr/m/n/10 Text (mit offener Klammer
             []

            LaTeX Warning: Citation `k' on page 1 undefined on input line 5.

            """
        let issues = LatexLogParser.parse(log, baseDirectory: project)
        #expect(issues.last?.fileURL == mainFile)
        #expect(issues.last?.line == 5)
    }

    @Test("Absolute Pfade mit Leerzeichen und Pfade mit ./")
    func pathResolution() {
        let log = """
            /Users/x/5 Semster/Projekt/kapitel.tex:12: Undefined control sequence.
            ./sub/../main.tex:3: Missing $ inserted.
            """
        let issues = LatexLogParser.parse(log, baseDirectory: project)
        #expect(issues.map(\.fileURL) == [project.appendingPathComponent("kapitel.tex").standardizedFileURL, mainFile])
        #expect(issues.map(\.line) == [12, 3])
    }

    @Test("Keine Fehlerzeile bei Info-Zeilen mit Doppelpunkten")
    func infoLinesAreNotErrors() {
        let log = """
            Package hyperref Info: Option `colorlinks' set `true' on input line 12.
            Document Class: article 2024/06/29 v1.4n Standard LaTeX document class
            LaTeX Font Info:    Checking defaults for OML/cmm/m/it on input line 5.
            """
        #expect(LatexLogParser.parse(log, baseDirectory: project).isEmpty)
    }

    @Test("Leeres und abgeschnittenes Log (Build läuft noch)")
    func emptyAndTruncated() {
        #expect(LatexLogParser.parse("", baseDirectory: project).isEmpty)
        let truncated = "(./main.tex\n./main.tex:3: Undefined control sequence.\nl.3"
        #expect(LatexLogParser.parse(truncated, baseDirectory: project).first?.line == 3)
    }
}
