import AppKit
import SwiftUI
import Testing
@testable import LatexEditor

@Suite("Text ohne Text-View ersetzen")
@MainActor
struct ReplaceTextTests {
    @Test("Ein Rückgängig-Schritt mit Wiederholen; unveränderter Text ändert nichts")
    func undoAndRedo() {
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/a.tex"), text: "Anfang \\ref{alt} Ende")
        session.replaceText(with: "Anfang \\ref{neu} Ende", actionName: "Verweise anpassen")
        #expect(session.textStorage.string == "Anfang \\ref{neu} Ende")
        #expect(session.isDirty)
        #expect(session.undoManager.undoActionName == "Verweise anpassen")

        session.undoManager.undo()
        #expect(session.textStorage.string == "Anfang \\ref{alt} Ende")
        session.undoManager.redo()
        #expect(session.textStorage.string == "Anfang \\ref{neu} Ende")

        session.replaceText(with: "Anfang \\ref{neu} Ende", actionName: "Nichts")
        #expect(session.undoManager.undoActionName != "Nichts")
    }
}

@Suite("Git erholt sich nach einem fehlgeschlagenen Status")
@MainActor
struct GitRecoveryTests {
    @Test("Kaputtes HEAD macht Git unverfügbar, der nächste Statuslauf nach der Reparatur wieder bereit")
    func recoversAfterFailedStatus() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n"])
        let store = repository.makeStore()
        await store.open(project: repository.root)
        #expect(store.isReady)

        let head = repository.url(".git/HEAD")
        let original = try String(contentsOf: head, encoding: .utf8)
        try "kaputt\n".write(to: head, atomically: true, encoding: .utf8)
        await store.refresh()
        #expect(!store.isReady)

        try original.write(to: head, atomically: true, encoding: .utf8)
        try repository.write("main.tex", "b\n")
        store.scheduleRefresh()
        let attempts = 100
        for _ in 0..<attempts where !store.isReady { try await Task.sleep(for: .milliseconds(20)) }
        #expect(store.isReady)
        #expect(store.unstaged.map(\.path) == ["main.tex"])
    }
}

@Suite("Kleinigkeiten der Oberfläche")
@MainActor
struct InterfaceDetailTests {
    @Test("Build-Dauer mit deutschem Komma")
    func durationFormat() {
        #expect(IssueListView.formatted(.milliseconds(3_940)) == "3,9 s")
        #expect(IssueListView.formatted(.seconds(12)) == "12,0 s")
    }

    @Test("Was das Einfügen ohne .tex-Datei vorne blockiert")
    func insertBlocker() {
        let store = InsertStore(defaults: temporaryDefaults())
        store.kind = .list
        #expect(store.blocker(canInsertIntoEditor: true) == nil)
        #expect(store.blocker(canInsertIntoEditor: false) == InsertStore.needsTeXMessage)
    }
}

extension AppModelSuite {
@Suite("Stabilisierung (App-Ebene)")
@MainActor
struct StabilizationAppTests {
    private let model = AppModel.shared

    @Test("Verweise anpassen in einer geänderten, offenen Datei ist ein eigener Rückgängig-Schritt")
    func referenceUpdateIsUndoable() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\begin{document}\n\\input{kapitel}\n\\end{document}\n")
        let original = "\\chapter{Eins}\n\\includegraphics{logo.png}\n"
        try project.write("kapitel.tex", original)
        try project.write("logo.png", "PNG")
        model.confirmReferenceUpdate = { _, _ in .update }
        await model.openProject(project.root)
        await model.editor.open(project.url("kapitel.tex"), asPreview: false)
        let session = try #require(model.editor.current)
        session.replaceText(with: original + "Neuer Absatz\n", actionName: "Tippen")
        try await Task.sleep(for: .milliseconds(50))

        try await model.rename(project.url("logo.png"), to: "titel.png")
        try await Task.sleep(for: .milliseconds(50))

        #expect(session.textStorage.string == "\\chapter{Eins}\n\\includegraphics{titel.png}\nNeuer Absatz\n")
        #expect(session.undoManager.undoActionName == "Verweise anpassen")
        session.undoManager.undo()
        #expect(session.textStorage.string == original + "Neuer Absatz\n")
        try await Task.sleep(for: .milliseconds(50))
        session.undoManager.undo()
        #expect(session.textStorage.string == original, "Das frühere Tippen lässt sich danach weiter rückgängig machen")
    }

    @Test("Quelle anlegen, während die .bib vorne ist: Fenster und Menü erlauben es, Zitieren nicht")
    func sourceWithoutTeX() async throws {
        let project = try TemporaryProject()
        defer { project.remove(); model.build.compileOnSave = true }
        try project.write("main.tex", "\\documentclass{report}\n\\bibliography{literatur}\n\\begin{document}\nText\n\\end{document}\n")
        try project.write("literatur.bib", "@book{alt, author={A, B}, title={T}, date={2000}}\n")
        model.build.compileOnSave = false
        await model.openProject(project.root)
        await model.editor.open(project.url("literatur.bib"), asPreview: false)

        #expect(model.canPresentInsert(.source))
        #expect(!model.canPresentInsert(.table))
        model.presentInsert(.source)
        await model.insertion.waitForCatalog()
        model.insertion.source.mode = .bibtex
        model.insertion.source.bibtex = "@misc{neu, title={Neu}}"
        model.insertion.source.citeAfterInsert = true
        #expect(model.insertion.blocker(canInsertIntoEditor: model.editor.canInsert) == InsertStore.citeNeedsTeXMessage)
        model.insertion.source.citeAfterInsert = false
        #expect(model.insertion.blocker(canInsertIntoEditor: model.editor.canInsert) == nil)

        await model.performInsert()

        #expect(try String(contentsOf: project.url("literatur.bib"), encoding: .utf8).hasSuffix("@misc{neu,\n\ttitle={Neu}\n}\n"))
        #expect(!model.insertion.isPresented)
        model.insertion.source.citeAfterInsert = true
    }

    @Test("Aufgeklappte Ordner überstehen einen Tabwechsel der Seitenleiste, ein Projektwechsel setzt sie zurück")
    func treeStateSurvivesTabSwitch() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\begin{document}\n\\input{kapitel/eins}\n\\end{document}\n")
        try project.write("kapitel/eins.tex", "\\chapter{Eins}\n")
        await model.openProject(project.root)
        model.sidebar.tab = .files
        await model.editor.open(project.url("kapitel/eins.tex"), asPreview: false)

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 600), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: SidebarView(model: model))
        defer { window.contentView = NSView() }
        try await settle(window)
        let folder = project.url("kapitel")
        #expect(model.sidebar.expandedFolders.contains(folder), "Der Baum klappt den Ordner der offenen Datei auf")

        model.sidebar.tab = .outline
        try await settle(window)
        model.sidebar.tab = .files
        try await settle(window)
        #expect(model.sidebar.expandedFolders.contains(folder))

        model.sidebar.load(project: project.root)
        #expect(model.sidebar.expandedFolders.isEmpty)
    }

    private func settle(_ window: NSWindow) async throws {
        for _ in 0..<4 {
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            try await Task.sleep(for: .milliseconds(40))
        }
    }
}
}
