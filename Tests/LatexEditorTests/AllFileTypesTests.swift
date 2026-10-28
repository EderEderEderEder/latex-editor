import Foundation
import Testing
@testable import LatexEditor

@Suite("Dateibaum: alle Dateitypen")
struct AllFileTypesTests {
    private func names(_ node: FileNode) -> [String] {
        (node.children ?? []).map { $0.isDirectory ? $0.name + "/" : $0.name }
    }

    @Test("Alle Dateien erscheinen, Build-Hilfsdateien nur auf Wunsch")
    func loader() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        for name in ["main.tex", "daten.csv", "skript.py", "archiv.zip", "main.aux", "main.log", "main.synctex.gz", "main.run.xml", "lit.bib", "bild.png", "main.pdf"] {
            try project.write(name, "x")
        }
        try project.write("ordner/notiz.txt", "x")
        try project.write("nur-hilfe/x.aux", "x")

        let standard = FileTreeLoader.load(root: project.root)
        #expect(names(standard) == ["ordner/", "archiv.zip", "bild.png", "daten.csv", "lit.bib", "main.pdf", "main.tex", "skript.py"])

        let all = FileTreeLoader.load(root: project.root, showsBuildFiles: true)
        let shown = names(all)
        #expect(shown.contains("main.aux") && shown.contains("main.synctex.gz") && shown.contains("main.run.xml") && shown.contains("nur-hilfe/"))
    }

    @Test("Hilfsdateien erkennen")
    func artifacts() {
        for name in ["a.aux", "a.log", "a.toc", "a.bbl", "a.blg", "a.synctex.gz", "a.run.xml", "a.fdb_latexmk", "a-blx.bib", "A.AUX"] {
            #expect(BuildArtifacts.isArtifact(URL(fileURLWithPath: "/p/\(name)")), "\(name)")
        }
        for name in ["a.tex", "lit.bib", "a.pdf", "log.txt", "a.png", "daten.csv", "synctex.md"] {
            #expect(!BuildArtifacts.isArtifact(URL(fileURLWithPath: "/p/\(name)")), "\(name)")
        }
    }

    @Test("Ereignisse für Hilfsdateien laden den Baum nur neu, wenn sie angezeigt werden")
    func events() {
        let created = FSEventStreamEventFlags(kFSEventStreamEventFlagItemCreated)
        let event = FileEvent(path: "/p/main.aux", flags: created)
        #expect(!event.changesTree(isInTree: { _ in false }, exists: { _ in true }))
        #expect(event.changesTree(showsBuildFiles: true, isInTree: { _ in false }, exists: { _ in true }))
        let data = FileEvent(path: "/p/daten.csv", flags: created)
        #expect(data.changesTree(isInTree: { _ in false }, exists: { _ in true }), "andere Dateitypen erscheinen jetzt im Baum")
    }

    @Test("Symbole nach Art der Datei")
    func glyphs() {
        func symbol(_ name: String) -> String { FileGlyph.symbol(for: URL(fileURLWithPath: "/p/\(name)")) }
        #expect(symbol("a.tex") == "doc.text")
        #expect(symbol("lit.bib") == "books.vertical")
        #expect(symbol("a.pdf") == "doc.richtext")
        #expect(symbol("a.PNG") == "photo")
        #expect(symbol("a.zip") == "doc.zipper")
        #expect(symbol("a.csv") == "tablecells")
        #expect(symbol("a.unbekannt") == "doc")
        #expect(symbol("Makefile") == "doc")
    }

    @MainActor
    @Test("Der Schalter lädt den Baum neu und wird gemerkt")
    func storeToggle() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "x")
        try project.write("main.aux", "x")
        let defaults = temporaryDefaults()
        let store = ProjectStore(defaults: defaults)
        #expect(!store.showsBuildFiles)
        await store.open(root: project.root)
        #expect(store.tree?.children?.map(\.name) == ["main.tex"])

        store.showsBuildFiles = true
        for _ in 0..<100 where store.tree?.children?.count != 2 { try await Task.sleep(for: .milliseconds(20)) }
        #expect(store.tree?.children?.map(\.name) == ["main.aux", "main.tex"])
        #expect(ProjectStore(defaults: defaults).showsBuildFiles, "bleibt für den nächsten Start")
    }
}
