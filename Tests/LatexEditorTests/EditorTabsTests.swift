import Foundation
import Testing
@testable import LatexEditor

/// Datei-Tab für `/p/<name>.tex`
private func url(_ name: String) -> EditorTab {
    .file(URL(fileURLWithPath: "/p/\(name).tex"))
}

private func tabs(_ names: String..., active: String? = nil, preview: String? = nil) -> EditorTabs {
    var result = EditorTabs()
    for name in names { result.open(url(name), asPreview: false) }
    if let preview { result.open(url(preview), asPreview: true) }
    if let active { result.activate(url(active)) }
    return result
}

private func names(_ tabs: EditorTabs) -> [String] {
    tabs.items.map { $0.url.deletingPathExtension().lastPathComponent }
}

@Suite("Tabs: Öffnen und Vorschau-Tab")
struct EditorTabsOpenTests {
    @Test("Ein neuer Tab steht rechts vom aktiven und wird aktiv")
    func opensToTheRightOfActive() {
        var state = tabs("a", "b", "c", active: "a")
        state.open(url("d"), asPreview: false)
        #expect(names(state) == ["a", "d", "b", "c"])
        #expect(state.active == url("d"))
    }

    @Test("Vorschau-Tab wird beim Öffnen einer anderen Datei ersetzt, an derselben Stelle")
    func previewIsReplaced() {
        var state = tabs("a", "b", preview: "p")
        let result = state.open(url("q"), asPreview: true)
        #expect(result.replaced == url("p"))
        #expect(names(state) == ["a", "b", "q"])
        #expect(state.preview == url("q"))
        #expect(state.active == url("q"))
    }

    @Test("Festgehaltener Tab wird nicht ersetzt, ein neuer Vorschau-Tab entsteht")
    func promotedTabStays() {
        var state = tabs("a", preview: "p")
        state.promote(url("p"))
        let result = state.open(url("q"), asPreview: true)
        #expect(result.replaced == nil)
        #expect(names(state) == ["a", "p", "q"])
        #expect(state.preview == url("q"))
    }

    @Test("Vorhandenen Tab öffnen aktiviert nur; dauerhaftes Öffnen hält die Vorschau fest")
    func reopenExisting() {
        var state = tabs("a", "b", active: "a", preview: "p")
        #expect(state.open(url("b"), asPreview: true).replaced == nil)
        #expect(state.active == url("b"))
        #expect(state.preview == url("p"))
        state.open(url("p"), asPreview: false)
        #expect(state.preview == nil)
        #expect(names(state) == ["a", "b", "p"])
    }

    @Test("Es gibt höchstens einen Vorschau-Tab")
    func singlePreview() {
        var state = EditorTabs()
        for name in ["a", "b", "c", "d"] { state.open(url(name), asPreview: true) }
        #expect(names(state) == ["d"])
    }

    @Test("Unbekannten Tab aktivieren oder festhalten ändert nichts")
    func unknownIsIgnored() {
        var state = tabs("a", "b", active: "a")
        state.activate(url("x"))
        state.promote(url("x"))
        #expect(state.active == url("a"))
        #expect(names(state) == ["a", "b"])
    }
}

@Suite("Tabs: Schließen, Wechseln, Reihenfolge")
struct EditorTabsCloseTests {
    @Test("Aktiven Tab schließen aktiviert den rechten Nachbarn, am Ende den linken")
    func closeActive() {
        var state = tabs("a", "b", "c", active: "b")
        #expect(state.close(url("b")) == url("c"))
        #expect(state.close(url("c")) == url("a"))
        #expect(state.close(url("a")) == nil)
        #expect(state.isEmpty && state.active == nil)
    }

    @Test("Inaktiven Tab schließen lässt den aktiven")
    func closeInactive() {
        var state = tabs("a", "b", "c", active: "c")
        #expect(state.close(url("a")) == url("c"))
        #expect(names(state) == ["b", "c"])
    }

    @Test("Schließen entfernt auch den Vorschau-Status; unbekannte Datei ändert nichts")
    func closePreview() {
        var state = tabs("a", preview: "p")
        state.close(url("p"))
        #expect(state.preview == nil)
        let before = state
        state.close(url("zzz"))
        #expect(state == before)
    }

    @Test("Andere schließen und alle schließen")
    func closeOthers() {
        var state = tabs("a", "b", "c", active: "a", preview: "p")
        state.close(allExcept: url("b"))
        #expect(names(state) == ["b"] && state.active == url("b") && state.preview == nil)
        state.closeAll()
        #expect(state.isEmpty && state.active == nil)
    }

    @Test("Wechsel zum nächsten und vorherigen Tab springt am Rand herum")
    func stepping() {
        var state = tabs("a", "b", "c", active: "c")
        state.activateNext()
        #expect(state.active == url("a"))
        state.activatePrevious()
        #expect(state.active == url("c"))
        var single = tabs("a")
        single.activateNext()
        #expect(single.active == url("a"))
    }

    @Test("Verschieben ändert die Reihenfolge, nicht den aktiven Tab")
    func moving() {
        var state = tabs("a", "b", "c", "d", active: "b")
        state.move(url("d"), onto: url("a"))
        #expect(names(state) == ["d", "a", "b", "c"])
        state.move(url("a"), onto: url("c"))
        #expect(names(state) == ["d", "b", "c", "a"])
        #expect(state.active == url("b"))
        state.move(url("x"), onto: url("a"))
        #expect(names(state) == ["d", "b", "c", "a"])
    }
}

@Suite("Tabs: Gedächtnis pro Projekt")
struct TabMemoryTests {
    @Test("Tabs und aktiver Tab werden pro Projekt gespeichert")
    func roundTrip() {
        let defaults = UserDefaults(suiteName: "LatexEditorTests-\(UUID().uuidString)")!
        let project = URL(fileURLWithPath: "/Users/x/5 Semster/Thesis")
        #expect(TabMemory.load(for: project, defaults: defaults) == nil)
        TabMemory.save(tabs("a", "b", active: "a"), for: project, defaults: defaults)
        #expect(TabMemory.load(for: project, defaults: defaults) == TabMemory.Snapshot(paths: ["/p/a.tex", "/p/b.tex"], active: "/p/a.tex"))
        #expect(TabMemory.load(for: URL(fileURLWithPath: "/anderes"), defaults: defaults) == nil)
        TabMemory.save(EditorTabs(), for: project, defaults: defaults)
        #expect(TabMemory.load(for: project, defaults: defaults) == TabMemory.Snapshot(paths: [], active: nil))
    }
}
