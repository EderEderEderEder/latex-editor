import Foundation
import Testing
@testable import LatexEditor

@Suite("OutlineParser")
struct OutlineParserTests {
    private func outline(_ project: TemporaryProject, main: String = "main.tex") async -> OutlineResult {
        await OutlineParser().outline(mainFile: project.url(main))
    }

    @Test("Folgt \\include und \\input mit und ohne .tex-Endung")
    func followsIncludes() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", """
            \\documentclass{article}
            \\begin{document}
            \\include{chapters/einleitung}
            \\input{chapters/schluss.tex}
            \\end{document}
            """)
        try project.write("chapters/einleitung.tex", "\\chapter{Einleitung}")
        try project.write("chapters/schluss.tex", "\\chapter{Schluss}")

        let result = await outline(project)

        #expect(result.entries.map(\.title) == ["Einleitung", "Schluss"])
        #expect(result.entries.map(\.fileURL) == [
            project.url("chapters/einleitung.tex"),
            project.url("chapters/schluss.tex")
        ])
    }

    @Test("Behält die Dokumentreihenfolge über verschachtelte Includes bei")
    func preservesDocumentOrder() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\chapter{A}\n\\input{b}\n\\chapter{C}")
        try project.write("b.tex", "\\section{B1}\n\\input{sub/b2}")
        try project.write("sub/b2.tex", "\\subsection{B2}")

        let result = await outline(project)

        #expect(result.entries.map(\.title) == ["A", "B1", "B2", "C"])
        #expect(result.entries.map(\.level) == [.chapter, .section, .subsection, .chapter])
    }

    @Test("Ignoriert auskommentierte Befehle, aber nicht escapte Prozentzeichen")
    func ignoresComments() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", """
            % \\chapter{Auskommentiert}
              %\\include{fehlt}
            50\\% Text \\section{Nach escaptem Prozent}
            \\section{Echt} % \\section{Im Kommentar}
            """)

        let result = await outline(project)

        #expect(result.entries.map(\.title) == ["Nach escaptem Prozent", "Echt"])
        #expect(result.includingFile.isEmpty)
    }

    @Test("Zeilennummern sind 1-basiert und beziehen sich auf die jeweilige Datei")
    func reportsLineNumbers() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\n\n\\chapter{Drei}\n\\input{kapitel}\n")
        try project.write("kapitel.tex", "Text\n\n\n\n\\section{Fünf}")

        let result = await outline(project)

        #expect(result.entries.map(\.line) == [3, 5])
    }

    @Test("Bereinigt Titel mit Stern, optionalem Argument und verschachtelten Klammern")
    func cleansTitles() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", """
            \\chapter*{Vorwort}
            \\section[Kurz]{Ein \\emph{langer} Titel mit {Gruppe}}
            \\subsection {Mit Leerzeichen}
            """)

        let result = await outline(project)

        #expect(result.entries.map(\.title) == ["Vorwort", "Ein langer Titel mit Gruppe", "Mit Leerzeichen"])
    }

    @Test("Zyklische und fehlende Includes führen nicht zu Endlosschleifen")
    func survivesCyclesAndMissingFiles() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\chapter{Main}\n\\input{a}\n\\input{fehlt}")
        try project.write("a.tex", "\\section{A}\n\\input{main}")

        let result = await outline(project)

        #expect(result.entries.map(\.title) == ["Main", "A"])
    }

    @Test("Erkennt Änderungen trotz Cache")
    func refreshesChangedFiles() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\chapter{Alt}")
        let parser = OutlineParser()
        let first = await parser.outline(mainFile: project.url("main.tex"))

        try project.write("main.tex", "\\chapter{Neu und länger}")
        let second = await parser.outline(mainFile: project.url("main.tex"))

        #expect(first.entries.map(\.title) == ["Alt"])
        #expect(second.entries.map(\.title) == ["Neu und länger"])
    }

    @Test("Include-Kette führt von der Hauptdatei zur eingebundenen Datei")
    func buildsIncludeChain() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\include{kapitel}")
        try project.write("kapitel.tex", "\\input{abschnitt}")
        try project.write("abschnitt.tex", "\\section{Tief}")
        try project.write("lose.tex", "\\section{Nicht eingebunden}")
        let main = project.url("main.tex")

        let result = await outline(project)
        let chain = { (file: URL) in
            OutlineStore.includeChain(to: file, mainFile: main, includingFile: result.includingFile)
        }

        #expect(chain(project.url("abschnitt.tex")) == [main, project.url("kapitel.tex"), project.url("abschnitt.tex")])
        #expect(chain(main) == [main])
        #expect(chain(project.url("lose.tex")) == [project.url("lose.tex")])
    }
}
