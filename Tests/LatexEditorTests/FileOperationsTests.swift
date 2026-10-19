import Foundation
import Testing
@testable import LatexEditor

@Suite("Dateioperationen")
struct FileOperationsTests {
    @Test("Namen werden geprüft: leer, Sonderzeichen, versteckt, zu lang", arguments: [
        ("", FileOperationError.emptyName), ("   ", .emptyName), ("a/b", .invalidCharacters), ("a:b", .invalidCharacters),
        ("a\\b", .invalidCharacters), (".versteckt", .hiddenName), (String(repeating: "x", count: 121), .nameTooLong)
    ])
    func invalidNames(name: String, error: FileOperationError) {
        #expect(throws: error) { try FileOperations.validateName(name) }
    }

    @Test("Neue Dateien bekommen .tex, vorhandene Endungen bleiben")
    func newFileNames() throws {
        #expect(try FileOperations.newFileName(from: " kapitel ") == "kapitel.tex")
        #expect(try FileOperations.newFileName(from: "refs.bib") == "refs.bib")
        #expect(try FileOperations.newFileName(from: "Größe & Maß") == "Größe & Maß.tex")
    }

    @Test("Umbenennen behält die Endung, wenn keine getippt wird; bei Ordnern gibt es keine")
    func renamedNames() throws {
        let file = URL(fileURLWithPath: "/p/einleitung.tex")
        #expect(try FileOperations.renamedFileName(from: "intro", original: file) == "intro.tex")
        #expect(try FileOperations.renamedFileName(from: "intro.txt", original: file) == "intro.txt")
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.makeDirectory("ordner.v2")
        #expect(try FileOperations.renamedFileName(from: "neu", original: project.url("ordner.v2")) == "neu")
    }

    @Test("Datei und Ordner anlegen, Kollision wird gemeldet und nichts überschrieben")
    func creating() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let file = try FileOperations.createFile(named: "kapitel", in: project.root, contents: "\\chapter{Kapitel}\n")
        #expect(file == project.url("kapitel.tex"))
        #expect(try String(contentsOf: file, encoding: .utf8) == "\\chapter{Kapitel}\n")
        let folder = try FileOperations.createFolder(named: "bilder", in: project.root)
        #expect(FileOperations.isDirectory(folder))

        #expect(throws: FileOperationError.alreadyExists("kapitel.tex")) {
            try FileOperations.createFile(named: "kapitel.tex", in: project.root, contents: "NEU")
        }
        #expect(try String(contentsOf: file, encoding: .utf8) == "\\chapter{Kapitel}\n")
        #expect(throws: FileOperationError.alreadyExists("bilder")) { try FileOperations.createFolder(named: "bilder", in: project.root) }
    }

    @Test("Umbenennen im selben Ordner, Kollision, nicht vorhandene Datei")
    func renaming() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let source = try project.write("chapters/alt.tex", "Inhalt")
        try project.write("chapters/belegt.tex")

        let renamed = try FileOperations.rename(source, toFileName: "neu.tex")
        #expect(renamed == project.url("chapters/neu.tex"))
        #expect(try String(contentsOf: renamed, encoding: .utf8) == "Inhalt")
        #expect(!FileManager.default.fileExists(atPath: source.path))
        #expect(throws: FileOperationError.alreadyExists("belegt.tex")) { try FileOperations.rename(renamed, toFileName: "belegt.tex") }
        #expect(throws: FileOperationError.self) { try FileOperations.rename(source, toFileName: "x.tex") }
    }

    @Test("Nur die Groß-/Kleinschreibung ändern funktioniert (case-insensitives Dateisystem)")
    func caseOnlyRename() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let source = try project.write("einleitung.tex", "x")
        let renamed = try FileOperations.rename(source, toFileName: "Einleitung.tex")
        #expect(renamed.lastPathComponent == "Einleitung.tex")
        let names = try FileManager.default.contentsOfDirectory(atPath: project.root.path)
        #expect(names == ["Einleitung.tex"])
    }

    @Test("Duplizieren nummeriert durch")
    func duplicating() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let source = try project.write("kapitel.tex", "Inhalt")
        let first = try FileOperations.duplicate(source)
        let second = try FileOperations.duplicate(source)
        #expect(first.lastPathComponent == "kapitel Kopie.tex")
        #expect(second.lastPathComponent == "kapitel Kopie 2.tex")
        #expect(try String(contentsOf: second, encoding: .utf8) == "Inhalt")
    }

    @Test("Verschieben in Ordner, nie aus dem Projekt, nie in sich selbst, nie über Vorhandenes")
    func moving() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let outside = try TemporaryProject()
        defer { outside.remove() }
        let file = try project.write("a.tex", "x")
        try project.makeDirectory("ziel")
        try project.write("ziel/b.tex")
        try project.write("ordner/innen/c.tex")
        let foreign = try outside.write("fremd.tex")

        #expect(try FileOperations.move(file, into: project.url("ziel"), projectRoot: project.root) == project.url("ziel/a.tex"))
        #expect(throws: FileOperationError.cannotMoveIntoItself) {
            try FileOperations.move(project.url("ordner"), into: project.url("ordner/innen"), projectRoot: project.root)
        }
        #expect(throws: FileOperationError.outsideProject) {
            try FileOperations.move(foreign, into: project.url("ziel"), projectRoot: project.root)
        }
        #expect(throws: FileOperationError.outsideProject) {
            try FileOperations.move(project.url("ziel/b.tex"), into: outside.root, projectRoot: project.root)
        }
        try project.write("b.tex", "andere")
        #expect(throws: FileOperationError.alreadyExists("b.tex")) {
            try FileOperations.move(project.url("b.tex"), into: project.url("ziel"), projectRoot: project.root)
        }
        #expect(throws: FileOperationError.isProjectRoot) {
            try FileOperations.move(project.root, into: project.url("ziel"), projectRoot: project.root)
        }
    }

    @Test("Zielordner für „Neue Datei“")
    func targetFolder() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let file = try project.write("chapters/a.tex")
        #expect(FileOperations.targetFolder(for: nil, projectRoot: project.root) == project.root)
        #expect(FileOperations.targetFolder(for: file, projectRoot: project.root) == project.url("chapters"))
        #expect(FileOperations.targetFolder(for: project.url("chapters"), projectRoot: project.root) == project.url("chapters"))
    }

    @Test("Leere Ordner erscheinen im Baum, Ordner mit nur Hilfsdateien nicht")
    func emptyFoldersInTree() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.makeDirectory("neu")
        try project.write("build/main.aux")
        try project.write("kapitel.tex")
        let tree = FileTreeLoader.load(root: project.root)
        #expect(tree.children?.map(\.name) == ["neu", "kapitel.tex"])
        #expect(tree.children?.first?.children == [])
    }
}
