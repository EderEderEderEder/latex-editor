import AppKit
import Foundation
import Testing
@testable import LatexEditor

extension AppModelSuite {
@Suite("Rückgängig für Dateioperationen (App-Ebene)")
@MainActor
struct FileUndoTests {
    /// Rückgängig und Wiederholen laufen asynchron (Dateien lesen, Baum neu laden): warten, bis die Bedingung gilt
    private func wait(_ condition: () -> Bool) async throws {
        for _ in 0..<200 where !condition() { try await Task.sleep(for: .milliseconds(20)) }
    }

    private func exists(_ sandbox: Sandbox, _ path: String) -> Bool {
        FileManager.default.fileExists(atPath: sandbox.project.url(path).path)
    }

    @Test("Neue Datei: Rückgängig legt sie in den Papierkorb, Wiederholen holt sie zurück")
    func createFile() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        try await model.createFile(named: "ausblick", in: sandbox.project.url("chapters"), chapterScaffold: true)
        #expect(exists(sandbox, "chapters/ausblick.tex"))
        #expect(model.fileUndoManager.undoActionName == "Neue Datei")

        model.undoFileOperation()
        try await wait { !exists(sandbox, "chapters/ausblick.tex") }
        #expect(!exists(sandbox, "chapters/ausblick.tex"))
        #expect(FileManager.default.fileExists(atPath: sandbox.trashFolder.root.appendingPathComponent("ausblick.tex").path), "liegt im Papierkorb")
        #expect(!model.editor.tabs.fileURLs.contains(sandbox.project.url("chapters/ausblick.tex")), "Tab ist zu")

        model.redoFileOperation()
        try await wait { exists(sandbox, "chapters/ausblick.tex") }
        #expect(try sandbox.text("chapters/ausblick.tex") == "\\chapter{ausblick}\n\n", "Inhalt kommt unverändert zurück")
        #expect(model.fileActions.revealURL == sandbox.project.url("chapters/ausblick.tex"))
        model.fileActions.revealURL = nil
    }

    @Test("Umbenennen: Datei, Tabs und Verweise gehen zurück und wieder vor")
    func rename() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        await model.editor.open(sandbox.project.url("chapters/schluss.tex"), asPreview: false)

        try await model.rename(sandbox.project.url("chapters/schluss.tex"), to: "ausblick")
        #expect(try sandbox.text("main.tex").contains("\\include{chapters/ausblick}"))
        #expect(model.fileUndoManager.undoActionName == "Umbenennen")

        model.undoFileOperation()
        try await wait { exists(sandbox, "chapters/schluss.tex") && (try? sandbox.text("main.tex").contains("chapters/schluss")) == true }
        #expect(exists(sandbox, "chapters/schluss.tex") && !exists(sandbox, "chapters/ausblick.tex"))
        #expect(try sandbox.text("main.tex").contains("\\include{chapters/schluss}"), "Verweise gehen mit zurück")
        #expect(try sandbox.text("chapters/einleitung.tex").contains("\\input{chapters/schluss}"))
        #expect(model.editor.tabs.fileURLs.contains(sandbox.project.url("chapters/schluss.tex")), "Tab folgt")

        model.redoFileOperation()
        try await wait { exists(sandbox, "chapters/ausblick.tex") && (try? sandbox.text("main.tex").contains("chapters/ausblick")) == true }
        #expect(exists(sandbox, "chapters/ausblick.tex"))
        #expect(try sandbox.text("main.tex").contains("\\include{chapters/ausblick}"))
        model.fileActions.revealURL = nil
    }

    @Test("Verschieben per Ziehen geht zurück; „Nur umbenennen“ ändert beim Zurücknehmen keine Verweise")
    func moveAndSkip() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        try FileManager.default.createDirectory(at: sandbox.project.url("anhang"), withIntermediateDirectories: true)
        sandbox.install(updateChoice: .skip)
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        await model.move(sandbox.project.url("chapters/schluss.tex"), into: sandbox.project.url("anhang"))
        #expect(exists(sandbox, "anhang/schluss.tex"))
        #expect(model.fileUndoManager.undoActionName == "Verschieben")
        #expect(try sandbox.text("main.tex").contains("\\include{chapters/schluss}"), "übersprungen")

        model.undoFileOperation()
        try await wait { exists(sandbox, "chapters/schluss.tex") }
        #expect(exists(sandbox, "chapters/schluss.tex") && !exists(sandbox, "anhang/schluss.tex"))
        #expect(try sandbox.text("main.tex").contains("\\include{chapters/schluss}"))
        model.fileActions.revealURL = nil
    }

    @Test("Papierkorb: Rückgängig holt die Datei zurück, auch wenn dort inzwischen etwas Neues liegt (dann Fehlermeldung)")
    func trash() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        await model.trash(sandbox.project.url("chapters/schluss.tex"))
        #expect(!exists(sandbox, "chapters/schluss.tex"))
        #expect(model.fileUndoManager.undoActionName == "In den Papierkorb legen")

        model.undoFileOperation()
        try await wait { exists(sandbox, "chapters/schluss.tex") }
        #expect(try sandbox.text("chapters/schluss.tex") == "\\chapter{Schluss}\n")

        model.redoFileOperation()
        try await wait { !exists(sandbox, "chapters/schluss.tex") }
        try sandbox.project.write("chapters/schluss.tex", "neu")
        model.fileActions.errorMessage = nil
        model.undoFileOperation()
        try await wait { model.fileActions.errorMessage != nil }
        #expect(model.fileActions.errorMessage?.contains("konnte nicht wiederhergestellt werden") == true)
        #expect(try sandbox.text("chapters/schluss.tex") == "neu", "nichts wird überschrieben")
        model.fileActions.errorMessage = nil
        model.fileActions.revealURL = nil
    }

    @Test("Duplizieren und Ordner: Rückgängig entfernt Kopie und Ordner; Menü kennt die Namen")
    func duplicateAndFolder() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        await model.duplicate(sandbox.project.url("chapters/schluss.tex"))
        try model.createFolder(named: "neu", in: sandbox.project.root)
        try await wait { model.fileActions.undoTitle == "Neuer Ordner" }
        #expect(model.fileActions.undoTitle == "Neuer Ordner")

        model.undoFileOperation()
        try await wait { !exists(sandbox, "neu") }
        #expect(!exists(sandbox, "neu"))
        try await wait { model.fileActions.undoTitle == "Duplizieren" }
        #expect(model.fileActions.undoTitle == "Duplizieren")
        #expect(model.fileActions.redoTitle == "Neuer Ordner")

        model.undoFileOperation()
        try await wait { !exists(sandbox, "chapters/schluss Kopie.tex") }
        #expect(!exists(sandbox, "chapters/schluss Kopie.tex"))
        try await wait { model.fileActions.undoTitle == nil }
        #expect(model.fileActions.undoTitle == nil)
        model.fileActions.revealURL = nil
    }

    @Test("Ziehen aus dem Finder: von außerhalb wird kopiert (Namenskonflikt nummeriert), im Projekt verschoben; alles rückgängig")
    func dropFromFinder() async throws {
        let sandbox = try Sandbox()
        let outside = try TemporaryProject()
        defer {
            sandbox.cleanUp()
            outside.remove()
        }
        try makeThesis(sandbox)
        try outside.write("daten.csv", "a;b")
        try outside.write("logo.png", "NEU")
        try outside.write("ordner/notiz.txt", "x")
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        let images = sandbox.project.url("images")

        await model.dropIntoProject([outside.url("daten.csv"), outside.url("logo.png"), outside.url("ordner")], folder: images)

        #expect(try sandbox.text("images/daten.csv") == "a;b")
        #expect(try sandbox.text("images/logo.png") == "PNG", "vorhandene Datei bleibt unangetastet")
        #expect(try sandbox.text("images/logo 2.png") == "NEU")
        #expect(try sandbox.text("images/ordner/notiz.txt") == "x")
        #expect(FileManager.default.fileExists(atPath: outside.url("daten.csv").path), "Original bleibt")
        #expect(model.fileUndoManager.undoActionName == "Hinzufügen")
        #expect(model.fileActions.revealURL?.standardizedFileURL.path == sandbox.project.url("images/ordner").standardizedFileURL.path)
        model.fileActions.revealURL = nil

        await model.dropIntoProject([sandbox.project.url("images/daten.csv")], folder: sandbox.project.url("chapters"))
        #expect(exists(sandbox, "chapters/daten.csv") && !exists(sandbox, "images/daten.csv"), "innerhalb des Projekts: verschieben")
        #expect(model.fileUndoManager.undoActionName == "Verschieben")

        model.undoFileOperation()
        try await wait { exists(sandbox, "images/daten.csv") }
        #expect(exists(sandbox, "images/daten.csv"))
        model.fileActions.revealURL = nil
    }
}
}
