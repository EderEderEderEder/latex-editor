import Foundation
import Testing
@testable import LatexEditor

private let main = URL(fileURLWithPath: "/p/main.tex")
private let chapter = URL(fileURLWithPath: "/p/chapters/eins.tex")

private func entry(_ level: OutlineEntry.Level, _ title: String, _ file: URL = main, line: Int) -> OutlineEntry {
    OutlineEntry(level: level, title: title, fileURL: file, line: line)
}

/// Kompakte Darstellung eines Baums zum Vergleichen: "A(B(C),D)".
private func describe(_ nodes: [OutlineNode]) -> String {
    nodes.map { node in
        guard let children = node.children else { return node.entry.title }
        return "\(node.entry.title)(\(describe(children)))"
    }.joined(separator: ",")
}

@Suite("Gliederungsbaum")
struct OutlineTreeTests {
    @Test("Ebenen werden verschachtelt")
    func nestsLevels() {
        let entries = [
            entry(.chapter, "K1", line: 1), entry(.section, "S1", line: 2), entry(.subsection, "U1", line: 3),
            entry(.subsection, "U2", line: 4), entry(.section, "S2", line: 5), entry(.chapter, "K2", line: 6)
        ]
        #expect(describe(OutlineTree.build(entries)) == "K1(S1(U1,U2),S2),K2")
    }

    @Test("Fehlende Ebene hängt am nächsthöheren Eintrag")
    func skippedLevel() {
        let entries = [entry(.chapter, "K", line: 1), entry(.subsection, "U", line: 2), entry(.section, "S", line: 3)]
        #expect(describe(OutlineTree.build(entries)) == "K(U,S)")
    }

    @Test("Einträge vor dem ersten Kapitel stehen auf oberster Ebene")
    func entriesBeforeFirstChapter() {
        let entries = [entry(.subsection, "U", line: 1), entry(.section, "S", line: 2), entry(.chapter, "K", line: 3)]
        #expect(describe(OutlineTree.build(entries)) == "U,S,K")
    }

    @Test("Leere Gliederung")
    func empty() {
        #expect(OutlineTree.build([]).isEmpty)
    }

    @Test("Aktueller Abschnitt zur Cursorposition, dateiübergreifend")
    func currentEntry() {
        let entries = [
            entry(.chapter, "Vorwort", line: 3),
            entry(.chapter, "Einleitung", chapter, line: 1),
            entry(.section, "Motivation", chapter, line: 10),
            entry(.chapter, "Schluss", line: 40)
        ]
        let current = { (file: URL, line: Int) in
            OutlineTree.currentEntry(in: entries, file: file, line: line)?.title
        }
        #expect(current(chapter, 5) == "Einleitung")
        #expect(current(chapter, 10) == "Motivation")
        #expect(current(chapter, 500) == "Motivation")
        #expect(current(main, 1) == nil)
        #expect(current(main, 3) == "Vorwort")
        #expect(current(main, 41) == "Schluss")
        #expect(current(URL(fileURLWithPath: "/p/refs.bib"), 1) == nil)
    }

    @Test("Cursor vor der ersten Überschrift einer Datei gehört zum vorherigen Abschnitt")
    func cursorBeforeFirstHeadingOfFile() {
        let entries = [entry(.chapter, "Vorwort", line: 3), entry(.chapter, "Einleitung", chapter, line: 5)]
        #expect(OutlineTree.currentEntry(in: entries, file: chapter, line: 2)?.title == "Vorwort")
    }
}

@Suite("Zuletzt geöffnet und Tab-Gedächtnis")
@MainActor
struct ProjectPreferencesTests {
    private func makeDefaults() -> UserDefaults {
        temporaryDefaults()
    }

    @Test("Neueste zuerst, ohne Duplikate, begrenzt")
    func recentList() {
        var list: [String] = []
        for index in 0..<15 { list = RecentProjectList.adding("/p\(index)", to: list) }
        list = RecentProjectList.adding("/p3", to: list)

        #expect(list.count == RecentProjectList.limit)
        #expect(list.first == "/p3")
        #expect(list.filter { $0 == "/p3" }.count == 1)
    }

    @Test("Store speichert dauerhaft und lässt sich leeren")
    func recentStorePersists() {
        let defaults = makeDefaults()
        let store = RecentProjectsStore(defaults: defaults)
        store.add(URL(fileURLWithPath: "/a"))
        store.add(URL(fileURLWithPath: "/b"))

        #expect(RecentProjectsStore(defaults: defaults).paths == ["/b", "/a"])
        store.clear()
        #expect(RecentProjectsStore(defaults: defaults).paths.isEmpty)
    }

    @Test("Tab wird pro Projekt gemerkt, Standard ist Dateien")
    func tabMemory() {
        let defaults = makeDefaults()
        let thesis = URL(fileURLWithPath: "/Users/x/5 Semster/Thesis")
        let other = URL(fileURLWithPath: "/Users/x/Anderes")
        SidebarTabMemory.remember(.outline, for: thesis, defaults: defaults)

        #expect(SidebarTabMemory.tab(for: thesis, defaults: defaults) == .outline)
        #expect(SidebarTabMemory.tab(for: other, defaults: defaults) == .files)
    }
}
