import AppKit
import SwiftUI
import Foundation
import Testing
@testable import LatexEditor

/// Wartet, bis FSEvents (0,3 s) und der entprellte Statuslauf (0,3 s) durch sind.
@MainActor
private func waitUntil(_ condition: () -> Bool) async throws {
    let attempts = 100
    for _ in 0..<attempts where !condition() { try await Task.sleep(for: .milliseconds(50)) }
    #expect(condition())
}

extension AppModelSuite {
@Suite("Git auf App-Ebene")
@MainActor
struct GitActionsTests {
    private let model = AppModel.shared

    private func open(_ repository: TemporaryRepository) async {
        model.git.extraEnvironment = TemporaryRepository.isolatedEnvironment
        await model.openProject(repository.root)
    }

    @Test("Commit fragt bei ungespeicherten Dateien nach, speichert und committet alles nach Rückfrage")
    func commitSavesAndStagesAll() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "\\documentclass{article}\n", "kapitel.tex": "alt\n"])
        await open(repository)
        await model.editor.open(repository.url("kapitel.tex"), asPreview: false)
        let session = try #require(model.editor.current)
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 3), with: "neu")
        #expect(session.isDirty)

        var prompted: [String] = []
        var confirmedCount: Int?
        model.promptForUnsavedChanges = { _, names in prompted = names; return .save }
        model.confirmCommitAll = { count in confirmedCount = count; return true }
        model.git.commitMessage = "Kapitel überarbeitet"
        await model.commitChanges()

        #expect(prompted == ["kapitel.tex"])
        #expect(confirmedCount == 1)
        #expect(!session.isDirty)
        #expect(try await repository.run("show", "HEAD:kapitel.tex") == "neu\n")
        #expect(!model.git.hasChanges)
    }

    @Test("Abbrechen bei der Rückfrage committet nichts")
    func cancelledCommit() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n"])
        try repository.write("main.tex", "b\n")
        await open(repository)
        model.confirmCommitAll = { _ in false }
        model.git.commitMessage = "Nicht jetzt"

        await model.commitChanges()

        #expect(try await repository.run("rev-list", "--count", "HEAD").trimmingCharacters(in: .whitespacesAndNewlines) == "1")
        #expect(model.git.commitMessage == "Nicht jetzt")
        #expect(model.git.unstaged.map(\.path) == ["main.tex"])
    }

    @Test("Diff als Tab: Vorschau teilt sich den Platz mit Dateien, fester Diff-Tab bleibt, Wechsel ohne Sitzung")
    func diffTabs() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n", "b.tex": "b\n"])
        try repository.write("b.tex", "B\n")
        await open(repository)
        let change = try #require(model.git.unstaged.first)
        let diffTab = EditorTab.diff(repository.url("b.tex"))

        model.showChange(change)
        try await waitUntil { model.git.diffs[diffTab.url]?.state != .loading }
        #expect(model.editor.tabs.active == diffTab)
        #expect(model.editor.tabs.preview == diffTab)
        #expect(model.editor.current == nil)
        #expect(!model.editor.canInsert)

        await model.editor.open(repository.url("b.tex"))
        #expect(!model.editor.tabs.contains(diffTab), "Ein Vorschau-Tab für eine Datei ersetzt den Vorschau-Diff")
        #expect(model.git.diffs.isEmpty)

        model.showChange(change, keep: true)
        await model.editor.open(repository.url("b.tex"), asPreview: false)
        #expect(model.editor.tabs.contains(diffTab))
        #expect(model.editor.current?.url == repository.url("b.tex"))
        model.editor.activateTab(diffTab)
        #expect(model.editor.current == nil)
        model.editor.activateTab(repository.url("b.tex"))
        #expect(model.editor.current?.url == repository.url("b.tex"))
    }

    @Test("Diff-Tab folgt beim Bereitstellen und schließt nach dem Commit von selbst")
    func diffTabFollowsAndCloses() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n"])
        try repository.write("main.tex", "b\n")
        await open(repository)
        let url = repository.url("main.tex")
        model.showChange(try #require(model.git.unstaged.first), keep: true)
        try await waitUntil { model.git.diffs[url]?.state != .loading }

        await model.git.stageAll()
        #expect(model.git.diffs[url]?.showsStaged == true)
        #expect(model.editor.tabs.contains(.diff(url)))

        model.git.commitMessage = "fertig"
        await model.commitChanges()
        #expect(!model.editor.tabs.contains(.diff(url)))
        #expect(model.git.diffs.isEmpty)
    }

    @Test("Diff-Tabs werden nicht gemerkt, Datei-Tabs schon")
    func diffTabsAreNotRemembered() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n"])
        try repository.write("main.tex", "b\n")
        await open(repository)
        model.showChange(try #require(model.git.unstaged.first), keep: true)

        let snapshot = try #require(TabMemory.load(for: repository.root))
        #expect(snapshot.paths == [repository.url("main.tex").path])
        #expect(snapshot.active == nil)
    }

    @Test("Externe Änderungen (Datei, Commit im Terminal) erscheinen ohne Zutun")
    func externalChangesRefresh() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n"])
        await open(repository)
        #expect(!model.git.hasChanges)

        try repository.write("kapitel/neu.tex", "neu\n")
        try await waitUntil { model.git.unstaged.map(\.path) == ["kapitel/neu.tex"] }
        #expect(model.git.containsChanges(repository.url("kapitel")))

        try await repository.run("add", "--all")
        try await repository.run("commit", "--quiet", "--message", "Von außen")
        try await waitUntil { !model.git.hasChanges }
    }

    @Test("Diff ohne gespeicherten Inhalt (neue Datei, nur im Editor getippt): der Editor scheint nicht durch")
    func emptyDiffCoversEditor() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n"])
        await open(repository)
        try await model.createFile(named: "neu", in: repository.root, chapterScaffold: false)
        let session = try #require(model.editor.current)
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: String(repeating: "Ungespeicherter Text im Editor\n", count: 5))
        defer { session.textStorage.replaceCharacters(in: NSRange(location: 0, length: session.textStorage.length), with: "") }
        await model.git.refresh()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: RootView(model: model))
        defer { window.contentView = NSView() }
        try await settle(window)
        let content = try #require(window.contentView)
        let textView = try #require(firstTextView(in: content))
        let textArea = textView.enclosingScrollView.map { content.convert($0.bounds, from: $0) } ?? .zero
        #expect(inkFraction(in: content, region: textArea) > 0, "Ohne Diff muss der Editortext sichtbar sein (Messung prüfen)")

        model.showChange(try #require(model.git.unstaged.first { $0.path == "neu.tex" }))
        try await waitUntil { model.git.diffs[repository.url("neu.tex")]?.state != .loading }
        try await settle(window)

        #expect(model.git.diffs[repository.url("neu.tex")]?.state == .loaded(FileDiff(content: .text([]))))
        #expect(inkFraction(in: content, region: textArea) == 0, "Der Editortext scheint durch den Diff")
    }

    private func settle(_ window: NSWindow) async throws {
        for _ in 0..<5 {
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            try await Task.sleep(for: .milliseconds(60))
        }
    }

    private func firstTextView(in view: NSView) -> LatexTextView? {
        if let match = view as? LatexTextView { return match }
        return view.subviews.lazy.compactMap { firstTextView(in: $0) }.first
    }

    /// Anteil gezeichneter Pixel im oberen Streifen (dort stünden die Textzeilen, der Hinweis ist mittig).
    private func inkFraction(in view: NSView, region: NSRect) -> Double {
        let stripHeight: CGFloat = 80, rulerAllowance: CGFloat = 60
        let strip = NSRect(x: region.minX + rulerAllowance, y: view.isFlipped ? region.minY : region.maxY - stripHeight,
                           width: region.width - rulerAllowance, height: stripHeight)
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: strip) else { return 0 }
        view.cacheDisplay(in: strip, to: bitmap)
        guard let background = bitmap.colorAt(x: bitmap.pixelsWide - 1, y: bitmap.pixelsHigh - 1) else { return 0 }
        var inked = 0
        for x in stride(from: 0, to: bitmap.pixelsWide, by: 2) {
            for y in stride(from: 0, to: bitmap.pixelsHigh, by: 2) where bitmap.colorAt(x: x, y: y) != background { inked += 1 }
        }
        return Double(inked) / Double(max((bitmap.pixelsWide / 2) * (bitmap.pixelsHigh / 2), 1))
    }

    @Test("Ohne Repository: kein Änderungen-Tab mehr, Seitenleiste fällt auf Dateien zurück")
    func nonRepositoryFallsBackToFiles() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "a\n"])
        await open(repository)
        model.sidebar.tab = .changes

        let folder = try TemporaryProject()
        defer { folder.remove() }
        try folder.write("main.tex", "x\n")
        await model.openProject(folder.root)

        #expect(model.git.availability == .notRepository)
        #expect(model.sidebar.tab == .files)
    }
}
}

@Suite("Git mit dem Demo-Projekt (nur lesen)", .enabled(if: DemoProject.exists))
@MainActor
struct GitDemoProjectTests {
    /// Demo-Projekt als Repository mit einem Commit und danach bereitgestellten, nicht bereitgestellten und neuen Dateien
    private func makeRepository() async throws -> TemporaryRepository {
        let repository = try await TemporaryRepository()
        try DemoProject.copy(to: repository.root)
        try await repository.run("add", "--all")
        try await repository.run("commit", "--quiet", "--message", "Demo")
        try repository.write("chapters/grundlagen.tex", "\\chapter{Geändert}\n")
        try await repository.run("add", "chapters/grundlagen.tex")
        try repository.write("chapters/einleitung.tex", "\\chapter{Auch geändert}\n")
        try repository.write("notizen.tex", "neu\n")
        return repository
    }

    /// Änderungszeit und Größe aller Dateien in `.git`. Das Arbeitsverzeichnis selbst nicht: Die Lesepfade
    /// schreiben dort ohnehin nie.
    private func snapshot(of root: URL) throws -> [String: [Double]] {
        var result: [String: [Double]] = [:]
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
        let enumerator = try #require(FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys))
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: Set(keys))
            guard values.isRegularFile == true else { continue }
            result[url.path] = [values.contentModificationDate?.timeIntervalSince1970 ?? 0, Double(values.fileSize ?? 0)]
        }
        return result
    }

    @Test("Status und Diff lesen verändert im Repository nichts, auch nicht den Index")
    func readingChangesNothing() async throws {
        let repository = try await makeRepository()
        defer { repository.remove() }
        let gitDirectory = repository.url(".git")
        let before = try snapshot(of: gitDirectory)
        let indexBefore = try Data(contentsOf: repository.url(".git/index"))
        let store = repository.makeStore()

        await store.open(project: repository.root)
        await store.refresh()
        let urls = Set((store.staged + store.unstaged).compactMap { store.url(for: $0) })
        #expect(urls.count == 3)
        store.updateDiffTabs(open: urls, active: nil)
        try await waitUntil { store.diffs.values.allSatisfy { $0.state != .loading } }

        #expect(store.availability == .ready)
        #expect(try Data(contentsOf: repository.url(".git/index")) == indexBefore)
        #expect(try snapshot(of: gitDirectory) == before)
    }

    @Test("Statuslauf für das Demo-Projekt bleibt schnell (inklusive Prozessstart)")
    func statusDuration() async throws {
        // gemessen 23 ms (zwei Prozesse: status, bei offenem Diff auch cat-file); Prozessstarts schwanken stark
        let budget = Duration.milliseconds(300)
        let repository = try await makeRepository()
        defer { repository.remove() }
        let store = repository.makeStore()
        await store.open(project: repository.root)
        let clock = ContinuousClock()
        var durations: [Duration] = []
        for _ in 0..<5 { durations.append(await clock.measure { await store.refresh() }) }
        // Der schnellste Lauf, nicht der mittlere: Im Gesamtlauf teilen sich über 400 Tests die Maschine, die Wandzeit
        // schwankt dort zwischen 160 und 400 ms, ohne dass sich im Git-Code etwas ändert. Ein echter Rückschritt
        // (zusätzlicher Prozess, langsamer Status) macht jeden der fünf Läufe langsam.
        let fastest = durations.min() ?? .zero
        print("⏱ Git-Status Demo: schnellster \(fastest), mittlerer \(durations.sorted()[durations.count / 2])")
        #expect(fastest <= budget)
    }
}
