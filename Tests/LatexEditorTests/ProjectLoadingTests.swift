import Foundation
import Testing
@testable import LatexEditor

@Suite("FileTreeLoader")
struct FileTreeLoaderTests {
    @Test("Zeigt nur .tex, .bib und Bilder, versteckte Dateien nicht")
    func filtersFileKinds() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        for name in ["main.tex", "refs.bib", "logo.png", "foto.JPG", "grafik.pdf",
                     "main.aux", "main.log", "notizen.txt", ".versteckt.tex"] {
            try project.write(name)
        }

        let tree = FileTreeLoader.load(root: project.root)
        let names = Set(tree.collectFiles().map(\.url.lastPathComponent))

        #expect(names == ["main.tex", "refs.bib", "logo.png", "foto.JPG", "grafik.pdf"])
    }

    @Test("Lässt Ordner mit nur ausgeblendeten Dateien und versteckte Ordner weg, Ordner stehen vor Dateien")
    func prunesAndSortsDirectories() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("zeta.tex")
        try project.write("chapters/kapitel10.tex")
        try project.write("chapters/kapitel2.tex")
        try project.write("build/main.aux")
        try project.write(".git/config.tex")

        let tree = FileTreeLoader.load(root: project.root)
        let topLevel = tree.children?.map(\.name)
        let chapters = tree.children?.first?.children?.map(\.name)

        #expect(topLevel == ["chapters", "zeta.tex"])
        #expect(chapters == ["kapitel2.tex", "kapitel10.tex"])
    }

    @Test("Leerer Ordner ergibt leeren Baum")
    func handlesEmptyRoot() throws {
        let project = try TemporaryProject()
        defer { project.remove() }

        let tree = FileTreeLoader.load(root: project.root)

        #expect(tree.children == [])
        #expect(tree.collectFiles().isEmpty)
    }
}

@Suite("MainFileDetector")
struct MainFileDetectorTests {
    private func detect(in project: TemporaryProject) -> URL? {
        MainFileDetector.detect(in: FileTreeLoader.load(root: project.root))
    }

    @Test("Bevorzugt die Datei mit \\documentclass vor main.tex ohne")
    func prefersDocumentClass() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\chapter{Kein Hauptdokument}")
        try project.write("thesis.tex", "% Kopf\n\n  \\documentclass[a4paper]{report}")

        #expect(detect(in: project) == project.url("thesis.tex"))
    }

    @Test("Bei mehreren Kandidaten gewinnt main.tex auf oberster Ebene")
    func prefersMainOnTopLevel() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("anhang.tex", "\\documentclass{article}")
        try project.write("main.tex", "\\documentclass{article}")
        try project.write("sub/tiefer.tex", "\\documentclass{article}")

        #expect(detect(in: project) == project.url("main.tex"))
    }

    @Test("Oberste Ebene schlägt Unterordner")
    func prefersShallowFiles() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("a/main.tex", "\\documentclass{article}")
        try project.write("zz.tex", "\\documentclass{article}")

        #expect(detect(in: project) == project.url("zz.tex"))
    }

    @Test("Auskommentiertes \\documentclass zählt nicht, Fallback main.tex")
    func fallsBackToMainTex() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "% \\documentclass{article}")
        try project.write("other.tex", "%\\documentclass{article}")

        #expect(detect(in: project) == project.url("main.tex"))
    }

    @Test("Ohne Kandidat und ohne main.tex gibt es keine Hauptdatei")
    func returnsNilWithoutCandidates() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("kapitel.tex", "\\chapter{X}")

        #expect(detect(in: project) == nil)
    }
}
