import Foundation
import Testing
@testable import LatexEditor

@Suite("Suchen: Store", .serialized)
@MainActor
struct SearchStoreTests {
    private func waitForResult(_ store: SearchStore) async {
        await store.waitUntilIdle()
    }

    @Test("Entprellt im Hintergrund; offene Texte vor der Platte; Optionen und leere Eingabe")
    func searches() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let onDisk = try project.write("platte.tex", "Haus am See\nZweites Haus\n")
        let open = URL(fileURLWithPath: "/p/offen.tex")
        let store = SearchStore()
        store.sources = { [.file(onDisk), .text(open, "nur im Editor: Haus\nhaus klein")] }

        store.query = "haus"
        #expect(store.isSearching)
        await waitForResult(store)
        #expect(store.result.hits.count == 4)
        #expect(store.result.groups.map(\.file.lastPathComponent) == ["platte.tex", "offen.tex"])

        store.options.caseSensitive = true
        await waitForResult(store)
        #expect(store.result.hits.count == 1, "nur „haus klein“")

        store.options.caseSensitive = false
        store.options.wholeWord = true
        store.query = "Haus am"
        await waitForResult(store)
        #expect(store.result.hits.count == 1)

        store.query = ""
        #expect(store.result.hits.isEmpty)
        #expect(!store.isSearching)
    }

    @Test("Ein älterer Lauf überschreibt kein neueres Ergebnis")
    func staleRunsAreDropped() async throws {
        let store = SearchStore()
        store.sources = { [.text(URL(fileURLWithPath: "/p/a.tex"), "eins zwei drei")] }
        store.query = "eins"
        store.query = "zwei"
        await waitForResult(store)
        #expect(store.result.hits.map(\.matchedText) == ["zwei"])
    }
}

extension AppModelSuite {
@Suite("Suchen und Ersetzen (App-Ebene)")
@MainActor
struct SearchActionsTests {
    private let model = AppModel.shared

    private func makeProject() throws -> TemporaryProject {
        let project = try TemporaryProject()
        try project.write("main.tex", "\\documentclass{report}\n\\begin{document}\n\\input{a}\\input{b}\n\\end{document}\n")
        try project.write("a.tex", "Das alte Haus. Noch ein altes Haus.\n")
        try project.write("b.tex", "Kein Treffer hier.\nHaus am See\n")
        try project.write("literatur.bib", "@book{haus, title={Das Haus}}\n")
        return project
    }

    @Test("Alle ersetzen: nur als ungespeicherte, rückgängig machbare Änderung in Tabs; Platte bleibt; aktiver Tab bleibt")
    func replaceAll() async throws {
        let project = try makeProject()
        defer { project.remove() }
        var asked: (Int, Int, String)?
        model.confirmReplace = { hits, files, replacement in
            asked = (hits, files, replacement)
            return true
        }
        await model.openProject(project.root)
        await model.editor.open(project.url("main.tex"), asPreview: false)
        // Ungespeicherter Text in einer offenen Datei zählt mit
        await model.editor.open(project.url("b.tex"), asPreview: false)
        let sessionB = try #require(model.editor.current)
        sessionB.replaceText(with: sessionB.textStorage.string + "Noch ein Haus im Editor\n", actionName: "Tippen")
        await model.editor.open(project.url("main.tex"), asPreview: false)
        let activeBefore = model.editor.tabs.active

        model.search.query = "Haus"
        model.search.replacement = "Heim"
        model.search.options.caseSensitive = true
        model.search.scheduleSearch(immediately: true)
        await model.search.waitUntilIdle()
        #expect(model.search.result.hits.count == 5, "a: 2, b: 1 + 1 ungespeichert, bib: nur „Das Haus“ (der Schlüssel „haus“ ist klein)")

        await model.replaceAllHits()

        #expect(asked?.0 == 5 && asked?.1 == 3 && asked?.2 == "Heim")
        let sessionA = try #require(model.editor.session(for: project.url("a.tex")))
        #expect(sessionA.textStorage.string == "Das alte Heim. Noch ein altes Heim.\n")
        #expect(sessionA.isDirty)
        #expect(try String(contentsOf: project.url("a.tex"), encoding: .utf8) == "Das alte Haus. Noch ein altes Haus.\n", "Platte unverändert")
        #expect(sessionB.textStorage.string == "Kein Treffer hier.\nHeim am See\nNoch ein Heim im Editor\n")
        #expect(model.editor.session(for: project.url("literatur.bib")) != nil, "auch die .bib als Tab")
        #expect(model.editor.tabs.active == activeBefore, "der zuvor aktive Tab bleibt vorne")
        #expect(model.search.notice?.contains("5 Ersetzungen in 3 Dateien") == true)

        await model.search.waitUntilIdle()
        #expect(model.search.result.hits.isEmpty, "nach dem Ersetzen aktualisiert sich die Liste")

        sessionA.undoManager.undo()
        #expect(sessionA.textStorage.string == "Das alte Haus. Noch ein altes Haus.\n", "⌘Z nimmt die Ersetzung zurück")
    }

    @Test("Einzelner Treffer und Datei: ohne Rückfrage bei einem Treffer; Abbrechen ändert nichts; veralteter Treffer wird übersprungen")
    func singleAndStale() async throws {
        let project = try makeProject()
        defer { project.remove() }
        var asks = 0
        model.confirmReplace = { _, _, _ in
            asks += 1
            return false
        }
        await model.openProject(project.root)
        model.search.query = "Haus"
        model.search.replacement = "Heim"
        model.search.scheduleSearch(immediately: true)
        await model.search.waitUntilIdle()

        await model.replaceAllHits()
        #expect(asks == 1)
        #expect(model.editor.session(for: project.url("a.tex")) == nil, "Abbrechen öffnet und ändert nichts")

        let single = try #require(model.search.result.hits.first { $0.file.lastPathComponent == "b.tex" })
        await model.replace([single])
        #expect(asks == 1, "ein Treffer: keine Rückfrage")
        let sessionB = try #require(model.editor.session(for: project.url("b.tex")))
        #expect(sessionB.textStorage.string == "Kein Treffer hier.\nHeim am See\n")

        // Veraltet: Text davor eingefügt, die Positionen stimmen nicht mehr
        let staleHit = try #require(model.search.result.hits.first { $0.file.lastPathComponent == "a.tex" })
        await model.editor.open(project.url("a.tex"), asPreview: false)
        let sessionA = try #require(model.editor.current)
        sessionA.replaceText(with: "VORSPANN \n" + sessionA.textStorage.string, actionName: "Tippen")
        await model.replace([staleHit])
        #expect(sessionA.textStorage.string.hasPrefix("VORSPANN"))
        #expect(!sessionA.textStorage.string.contains("Heim"))
        #expect(model.search.notice?.contains("Nichts ersetzt") == true)
    }

    @Test("⇧⌘F: markierte Zeile als Suchbegriff, Ansicht „Suchen“ wird gezeigt")
    func presentSearch() async throws {
        let project = try makeProject()
        defer { project.remove() }
        await model.openProject(project.root)
        model.sidebar.tab = .files
        model.search.query = ""
        model.presentProjectSearch()
        #expect(model.sidebar.tab == .search)
        #expect(model.search.focusRequest != nil)
        model.sidebar.tab = .files
    }

    @Test("Hinweistext der Ersetzung")
    func notice() {
        #expect(AppModel.replacementNotice(applied: 1, files: 1, requested: 1).hasPrefix("1 Ersetzung in 1 Datei."))
        #expect(AppModel.replacementNotice(applied: 3, files: 2, requested: 4).contains("1 übersprungen"))
        #expect(AppModel.replacementNotice(applied: 0, files: 0, requested: 2).hasPrefix("Nichts ersetzt"))
    }
}
}
