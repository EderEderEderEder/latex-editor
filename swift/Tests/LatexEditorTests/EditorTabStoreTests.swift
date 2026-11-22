import AppKit
import Foundation
import Testing
@testable import LatexEditor

@MainActor
private func makeStore(_ names: [String]) async throws -> (EditorStore, TemporaryProject, [URL]) {
    let project = try TemporaryProject()
    var urls: [URL] = []
    for name in names { urls.append(try project.write("\(name).tex", "Inhalt \(name)\n")) }
    return (EditorStore(), project, urls)
}

@Suite("Tabs im EditorStore")
@MainActor
struct EditorTabStoreTests {
    @Test("Einfachklicks ersetzen den Vorschau-Tab und geben dessen Sitzung frei")
    func previewReplacement() async throws {
        let (store, project, urls) = try await makeStore(["a", "b", "c"])
        defer { project.remove() }

        await store.open(urls[0])
        await store.open(urls[1])
        #expect(store.tabs.fileURLs == [urls[1]])
        #expect(store.session(for: urls[0]) == nil, "Sitzung des ersetzten Vorschau-Tabs muss freigegeben sein")

        await store.open(urls[2], asPreview: false)
        await store.open(urls[0])
        // c ist dauerhaft (rechts von b); a ersetzt den Vorschau-Tab b an dessen Stelle
        #expect(store.tabs.fileURLs == [urls[0], urls[2]])
        #expect(store.session(for: urls[1]) == nil)
        #expect(store.current?.url == urls[0])
    }

    @Test("Erste Änderung hält den Vorschau-Tab fest, er wird nicht mehr ersetzt")
    func editPromotesPreview() async throws {
        let (store, project, urls) = try await makeStore(["a", "b"])
        defer { project.remove() }
        await store.open(urls[0])
        #expect(store.tabs.previewFileURL == urls[0])

        let session = try #require(store.current)
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "x")
        #expect(store.tabs.previewFileURL == nil)

        await store.open(urls[1])
        #expect(store.tabs.fileURLs == [urls[0], urls[1]])
        #expect(store.session(for: urls[0])?.isDirty == true, "Änderungen dürfen nicht verloren gehen")
    }

    @Test("Wechsel zwischen Tabs behält jede Sitzung samt Änderungen")
    func switchingKeepsSessions() async throws {
        let (store, project, urls) = try await makeStore(["a", "b"])
        defer { project.remove() }
        await store.open(urls[0], asPreview: false)
        let first = try #require(store.current)
        first.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "NEU ")
        await store.open(urls[1], asPreview: false)
        #expect(store.current?.url == urls[1])

        store.activateTab(urls[0])
        #expect(store.current === first)
        #expect(first.textStorage.string.hasPrefix("NEU "))
        store.activateNextTab()
        #expect(store.current?.url == urls[1])
        store.activatePreviousTab()
        #expect(store.current === first)
    }

    @Test("Aktiven Tab schließen zeigt den Nachbarn, letzten Tab schließen leert die Anzeige")
    func closing() async throws {
        let (store, project, urls) = try await makeStore(["a", "b", "c"])
        defer { project.remove() }
        for url in urls { await store.open(url, asPreview: false) }
        store.activateTab(urls[1])

        store.closeTab(urls[1])
        #expect(store.current?.url == urls[2])
        #expect(store.session(for: urls[1]) == nil)
        store.closeTab(urls[2])
        #expect(store.current?.url == urls[0])
        store.closeTab(urls[0])
        #expect(store.current == nil && store.tabs.isEmpty)
        store.closeTab(urls[0])
    }

    @Test("Andere schließen gibt deren Sitzungen frei")
    func closingOthers() async throws {
        let (store, project, urls) = try await makeStore(["a", "b", "c"])
        defer { project.remove() }
        for url in urls { await store.open(url, asPreview: false) }

        store.closeOtherTabs(keeping: .file(urls[1]))
        #expect(store.tabs.fileURLs == [urls[1]])
        #expect(store.current?.url == urls[1])
        #expect(store.session(for: urls[0]) == nil && store.session(for: urls[2]) == nil)
    }

    @Test("Dieselbe Datei in zwei Schreibweisen ergibt einen Tab")
    func normalizedPaths() async throws {
        let (store, project, urls) = try await makeStore(["a"])
        defer { project.remove() }
        await store.open(urls[0], asPreview: false)
        let variant = URL(fileURLWithPath: urls[0].path.replacingOccurrences(of: "/a.tex", with: "/./a.tex"))
        await store.open(variant, asPreview: false)
        #expect(store.tabs.fileURLs.count == 1)
    }

    @Test("Schnelles Öffnen mehrerer Dateien hinterlässt keine verwaisten Sitzungen")
    func rapidOpening() async throws {
        let (store, project, urls) = try await makeStore(["a", "b", "c", "d"])
        defer { project.remove() }
        let tasks = urls.map { url in Task { @MainActor in await store.open(url) } }
        for task in tasks { await task.value }
        #expect(store.tabs.fileURLs.count == 1)
        let shown = try #require(store.current)
        #expect(store.tabs.activeFileURL == shown.url)
        for url in urls where url != shown.url {
            #expect(store.session(for: url) == nil, "verwaiste Sitzung für \(url.lastPathComponent)")
        }
    }

    @Test("Extern gelöschte Datei: Tab verschwindet, Nachbar wird angezeigt; mit Änderungen bleibt der Tab")
    func deletedFiles() async throws {
        let (store, project, urls) = try await makeStore(["a", "b", "c"])
        defer { project.remove() }
        for url in urls { await store.open(url, asPreview: false) }
        store.activateTab(urls[1])
        try FileManager.default.removeItem(at: urls[1])

        #expect(store.handleDeletedFile(urls[1]))
        #expect(store.tabs.fileURLs == [urls[0], urls[2]])
        #expect(store.current?.url == urls[2])

        store.session(for: urls[0])?.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "x")
        try FileManager.default.removeItem(at: urls[0])
        #expect(!store.handleDeletedFile(urls[0]))
        #expect(store.tabs.contains(urls[0]))
        #expect(store.session(for: urls[0])?.isMissingOnDisk == true)
    }

    @Test("Tabs wiederherstellen: vorhandene Dateien in Reihenfolge, aktiver Tab zuletzt")
    func restoring() async throws {
        let (store, project, urls) = try await makeStore(["a", "b", "c"])
        defer { project.remove() }
        let missing = project.url("gibtsnicht.tex")

        await store.restoreTabs([urls[2], missing, urls[0], urls[1]], active: urls[0])
        #expect(store.tabs.fileURLs == [urls[2], urls[0], urls[1]])
        #expect(store.current?.url == urls[0])
        #expect(store.tabs.previewFileURL == nil)
    }

    @Test("Änderungen der Tabs werden gemeldet, damit sie pro Projekt gemerkt werden können")
    func reportsChanges() async throws {
        let (store, project, urls) = try await makeStore(["a", "b"])
        defer { project.remove() }
        var reported: [[URL]] = []
        store.onTabsChanged = { reported.append($0.fileURLs) }
        await store.open(urls[0], asPreview: false)
        await store.open(urls[1], asPreview: false)
        store.closeTab(urls[0])
        #expect(reported == [[urls[0]], [urls[0], urls[1]], [urls[1]]])
    }
}
