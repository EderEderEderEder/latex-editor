import Foundation
import Testing
@testable import LatexEditor

@Suite("Dateibaum: Dateitypen ausblenden")
struct FileTypeFilterTests {
    private func tree(_ files: [String], emptyFolders: [String] = []) throws -> (FileNode, TemporaryProject) {
        let project = try TemporaryProject()
        for file in files { try project.write(file, "x") }
        for folder in emptyFolders {
            try FileManager.default.createDirectory(at: project.root.appendingPathComponent(folder), withIntermediateDirectories: true)
        }
        return (FileTreeLoader.load(root: project.root, showsBuildFiles: true), project)
    }

    private func names(_ node: FileNode) -> [String] {
        (node.children ?? []).map { $0.isDirectory ? $0.name + "/" : $0.name }
    }

    @Test("Der Katalog gruppiert die Endungen des Projekts und zählt sie")
    func catalog() throws {
        let (tree, project) = try tree(["main.tex", "a.tex", "lit.bib", "hgb.sty", "hgb.cls", "x.png", "y.pdf", "d.csv", "main.aux", "README", "z.xyz"])
        defer { project.remove() }
        let sections = FileTypeCatalog.sections(in: tree, hidden: [])
        #expect(sections.map(\.title) == ["LaTeX", "Literatur", "Pakete und Klassen", "Bilder", "PDF", "Tabellen", "Build-Dateien", "Sonstige"])
        #expect(sections[0].entries == [FileTypeEntry(fileExtension: "tex", count: 2)])
        #expect(sections[2].entries.map(\.fileExtension) == ["cls", "sty"])
        #expect(sections.last?.entries.map(\.fileExtension) == ["", "xyz"], "Ohne Endung und unbekannt")
        #expect(sections.last?.entries.first?.title == "Ohne Endung")
        #expect(sections[0].entries[0].title == ".tex")
    }

    @Test("Ein ausgeblendeter Typ ohne Datei im Projekt bleibt im Menü (mit 0), damit man ihn zurückholen kann")
    func hiddenButAbsentStaysListed() throws {
        let (tree, project) = try tree(["main.tex"])
        defer { project.remove() }
        let sections = FileTypeCatalog.sections(in: tree, hidden: ["sty"])
        let packages = try #require(sections.first { $0.title == "Pakete und Klassen" })
        #expect(packages.entries == [FileTypeEntry(fileExtension: "sty", count: 0)])
    }

    @Test("Ausgeblendete Typen verschwinden aus dem Baum, auch in Unterordnern; Endung egal ob groß oder klein")
    func pruning() throws {
        let (tree, project) = try tree(["main.tex", "hgb.sty", "Logo.PNG", "chapters/a.tex", "chapters/b.sty", "styles/only.sty"])
        defer { project.remove() }
        let pruned = tree.hidingFileTypes(["sty", "png"])
        #expect(names(pruned) == ["chapters/", "main.tex"], "Ordner mit nur ausgeblendeten Dateien entfällt")
        let chapters = try #require(pruned.children?.first)
        #expect(names(chapters) == ["a.tex"])
        #expect(names(tree.hidingFileTypes([])) == names(tree), "Ohne Filter bleibt alles")
    }

    @Test("Wirklich leere Ordner bleiben, die offene Datei bleibt trotz Filter sichtbar")
    func emptyFoldersAndOpenFile() throws {
        let (tree, project) = try tree(["main.tex", "hgb.sty"], emptyFolders: ["neu"])
        defer { project.remove() }
        #expect(names(tree.hidingFileTypes(["tex", "sty"])) == ["neu/"])
        let open = project.root.appendingPathComponent("main.tex").standardizedFileURL
        #expect(names(tree.hidingFileTypes(["tex", "sty"], keeping: open)) == ["neu/", "main.tex"])
    }

    @Test("Alles ausgeblendet ergibt einen leeren Baum statt eines Absturzes")
    func everythingHidden() throws {
        let (tree, project) = try tree(["a.tex", "sub/b.tex"])
        defer { project.remove() }
        #expect(names(tree.hidingFileTypes(["tex"])).isEmpty)
    }

    @MainActor
    @Test("Der Store merkt sich die ausgeblendeten Typen für den nächsten Start und ändert den Baum nicht")
    func storePersistence() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "x")
        try project.write("hgb.sty", "x")
        let defaults = temporaryDefaults()
        let store = ProjectStore(defaults: defaults)
        await store.open(root: project.root)
        #expect(store.hiddenFileExtensions.isEmpty)

        store.setFileType("sty", hidden: true)
        #expect(store.hiddenFileExtensions == ["sty"])
        #expect(store.tree?.children?.count == 2, "Nur die Anzeige: der Baum selbst bleibt vollständig")
        #expect(ProjectStore(defaults: defaults).hiddenFileExtensions == ["sty"])

        store.setFileType("sty", hidden: false)
        store.setFileType("pdf", hidden: true)
        store.showAllFileTypes()
        #expect(store.hiddenFileExtensions.isEmpty)
        #expect(ProjectStore(defaults: defaults).hiddenFileExtensions.isEmpty)
    }
}
