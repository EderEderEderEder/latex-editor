import AppKit
import Foundation
import SwiftUI
import Testing
@testable import LatexEditor

@MainActor
private func waitUntil(_ condition: () -> Bool) async throws {
    let attempts = 100
    for _ in 0..<attempts where !condition() { try await Task.sleep(for: .milliseconds(50)) }
    #expect(condition())
}

extension AppModelSuite {
@Suite("Git Phase 2 auf App-Ebene")
@MainActor
struct GitPhase2Tests {
    private let model = AppModel.shared

    private func open(_ repository: TemporaryRepository) async {
        model.git.extraEnvironment = TemporaryRepository.isolatedEnvironment
        await model.openProject(repository.root)
    }

    private func type(_ text: String, into session: DocumentSession) {
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: text)
    }

    @Test("Pull: unveränderte offene Datei lädt neu, Datei mit ungespeicherten Änderungen bekommt den Hinweis")
    func pullUpdatesOpenFiles() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "main\n", "kapitel.tex": "kapitel\n"])
        let remote = try await repository.addRemote()
        defer { remote.remove() }
        await open(repository)
        await model.editor.open(repository.url("kapitel.tex"), asPreview: false)
        let kapitel = try #require(model.editor.current)
        type("ungespeichert ", into: kapitel)
        await model.editor.open(repository.url("main.tex"), asPreview: false)
        let main = try #require(model.editor.current)
        try await remote.commitElsewhere(["main.tex": "main neu\n", "kapitel.tex": "kapitel neu\n"])

        var prompted: [String] = []
        model.promptForUnsavedChanges = { _, names in prompted = names; return .discard }
        await model.fetchFromRemote()
        await model.pullFromRemote()

        #expect(prompted == ["kapitel.tex"])
        #expect(model.git.errorMessage == nil)
        #expect(main.textStorage.string == "main neu\n")
        #expect(!main.isDirty)
        #expect(kapitel.textStorage.string == "ungespeichert kapitel\n")
        #expect(kapitel.hasExternalChange)
    }

    @Test("Branch-Wechsel: Tabs von Dateien, die es dort nicht gibt, schließen; Inhalte folgen")
    func switchBranchUpdatesTabs() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "main\n"])
        await open(repository)
        await model.createBranch(named: "test")
        try repository.write("nur-hier.tex", "x\n")
        try repository.write("main.tex", "main auf test\n")
        await model.git.refresh()
        model.git.commitMessage = "Auf test"
        await model.git.commit(stagingAll: true)
        await model.editor.open(repository.url("main.tex"), asPreview: false)
        let main = try #require(model.editor.current)
        await model.editor.open(repository.url("nur-hier.tex"), asPreview: false)

        await model.switchBranch(to: "main")

        #expect(model.git.branch.head == "main")
        #expect(!model.editor.tabs.contains(repository.url("nur-hier.tex")))
        #expect(main.textStorage.string == "main\n")
        #expect(model.editor.current === main)
    }

    @Test("Externe Änderung (FSEvents) lädt eine offene, unveränderte Datei von selbst neu")
    func externalChangeReloads() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "alt\n"])
        await open(repository)
        let session = try #require(model.editor.current)

        try repository.write("main.tex", "von außen\n")
        try await waitUntil { session.textStorage.string == "von außen\n" }
        #expect(!session.isDirty)

        try session.save()
        try await Task.sleep(for: .milliseconds(800))
        #expect(!session.hasExternalChange, "Das eigene Speichern löst keinen Hinweis aus")
    }

    @Test("Änderungsmarken: erscheinen beim Tippen (ungespeichert), verschwinden nach dem Commit, im Ruler gezeichnet")
    func changeMarks() async throws {
        let repository = try await TemporaryRepository()
        defer { repository.remove() }
        try await repository.commit(["main.tex": "eins\nzwei\ndrei\n"])
        await open(repository)
        let session = try #require(model.editor.current)
        let url = repository.url("main.tex")
        try await waitUntil { model.git.isReady }

        session.textStorage.replaceCharacters(in: NSRange(location: 5, length: 4), with: "ZWEI\nneu")
        try await waitUntil { model.changeMarks.marks(for: url).lines == [2: .modified, 3: .added] }
        #expect(try await greenPixelsInChangeBar() > 0)

        model.promptForUnsavedChanges = { _, _ in .save }
        model.confirmCommitAll = { _ in true }
        model.git.commitMessage = "Marken weg"
        await model.commitChanges()
        try await waitUntil { model.changeMarks.marks(for: url).isEmpty }
    }

    /// Rendert das Fenster und zählt grüne Pixel in der Spalte des Änderungsstreifens im Ruler.
    private func greenPixelsInChangeBar() async throws -> Int {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: RootView(model: model))
        defer { window.contentView = NSView() }
        for _ in 0..<5 {
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            try await Task.sleep(for: .milliseconds(60))
        }
        let content = try #require(window.contentView)
        let ruler = try #require(rulers(in: content).first)
        let bitmap = try #require(ruler.bitmapImageRepForCachingDisplay(in: ruler.bounds))
        ruler.cacheDisplay(in: ruler.bounds, to: bitmap)
        let scale = CGFloat(bitmap.pixelsWide) / ruler.bounds.width
        let column = Int((ruler.ruleThickness - 4.5) * scale)
        return (0..<bitmap.pixelsHigh).count { y in
            guard let color = bitmap.colorAt(x: column, y: y)?.usingColorSpace(.sRGB) else { return false }
            return color.greenComponent > 0.5 && color.redComponent < 0.5 && color.blueComponent < 0.6
        }
    }

    private func rulers(in view: NSView) -> [LineNumberRulerView] {
        if let ruler = view as? LineNumberRulerView { return [ruler] }
        if let scrollView = view as? NSScrollView, let ruler = scrollView.verticalRulerView as? LineNumberRulerView { return [ruler] }
        return view.subviews.flatMap { rulers(in: $0) }
    }
}
}
