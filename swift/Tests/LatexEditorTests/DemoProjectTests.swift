import Foundation
import Testing
@testable import LatexEditor

/// Das Demo-Projekt muss so aufgebaut sein, wie die Tests und die Handtests es voraussetzen.
@Suite("Demo-Projekt (Testdaten/HgbDemo)", .enabled(if: DemoProject.exists))
struct DemoProjectTests {
    private func copy() throws -> TemporaryProject {
        let project = try TemporaryProject()
        try DemoProject.copy(to: project.root)
        return project
    }

    @Test("Hauptdatei, Labels, Literatur und Bildordner werden erkannt")
    func catalog() throws {
        let project = try copy()
        defer { project.remove() }
        let tree = FileTreeLoader.load(root: project.root)
        let main = try #require(MainFileDetector.detect(in: tree))
        #expect(main.lastPathComponent == "main.tex")

        let files = tree.collectFiles().map(\.url)
        let catalog = ProjectCatalog.scan(files: files, mainFile: main)
        #expect(catalog.labelNames.isSuperset(of: ["chap:einleitung", "fig:verlauf", "tab:sprachen", "prog:gruss", "eq:pythagoras"]))
        #expect(Set(catalog.bibEntries.map(\.key)) == ["knuth1984", "lamport1994", "mittelbach2004", "ungenutzt2026"])
        #expect(catalog.graphicsDirectories == ["images/"])
    }

    @Test("Genau ein Verweis ist absichtlich unbekannt, ein Label und eine Quelle sind ungenutzt")
    func intentionalProblems() throws {
        let project = try copy()
        defer { project.remove() }
        let tree = FileTreeLoader.load(root: project.root)
        let main = try #require(MainFileDetector.detect(in: tree))
        let files = tree.collectFiles().map(\.url).filter { $0.pathExtension == "tex" || $0.pathExtension == "bib" }
        let catalog = ProjectCatalog.scan(files: files, mainFile: main)

        var used = Set<String>()
        var unknown: [String] = []
        for file in files where file.pathExtension == "tex" {
            let text = try String(contentsOf: file, encoding: .utf8)
            for occurrence in LatexReferences.scan(text) {
                switch occurrence.kind {
                case .labelUse:
                    used.insert(occurrence.key)
                    if !catalog.labelNames.contains(occurrence.key) { unknown.append(occurrence.key) }
                case .citation:
                    used.insert(occurrence.key)
                    if !catalog.bibEntries.contains(where: { $0.key == occurrence.key }) { unknown.append(occurrence.key) }
                case .labelDefinition:
                    break
                }
            }
        }
        #expect(unknown == ["fig:fehlt"])
        #expect(catalog.labelNames.contains("sec:ungenutzt") && !used.contains("sec:ungenutzt"))
        #expect(!used.contains("ungenutzt2026"))
    }

    @Test("Klassenoptionen der Demo-Klasse sind für die Vervollständigung lesbar")
    func classOptions() throws {
        let project = try copy()
        defer { project.remove() }
        let names = ["hgbthesis.cls", "hgbdict.sty", "hgblistings.sty", "hgbtheme-default.sty", "hgbtheme-kompakt.sty"]
        let options = try #require(OptionScanner.scan(names.map { project.url($0) })["hgbthesis"])
        #expect(options.keys["type"] == ["bachelor", "master"])
        #expect(options.keys["degree"] == ["engineering", "law"])
        #expect(options.keys["theme"] == ["default", "kompakt"])
        #expect(options.keys["codestyle"] == ["color", "mono", "classic"])
        #expect(options.keys["twoside"] == ["true", "false"])
    }

    @Test("Alle Sprachumgebungen des Einfügen-Menüs sind in der Demo-Vorlage definiert")
    func codeEnvironments() throws {
        let listings = try String(contentsOf: DemoProject.template.appendingPathComponent("hgblistings.sty"), encoding: .utf8)
        for language in CodeLanguage.all {
            #expect(listings.contains("\\hgb@DefineCode{\(language.environment)}"), "\(language.environment) fehlt")
        }
    }
}
