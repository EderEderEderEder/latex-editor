import AppKit
import SwiftUI
import Foundation
import Testing
@testable import LatexEditor

extension AppModelSuite {
@Suite("Automatische Sicherung und Wiederherstellung")
@MainActor
struct RecoveryTests {
    private let model = AppModel.shared

    private func setUp() async throws -> (TemporaryProject, TemporaryProject) {
        let project = try TemporaryProject()
        let backups = try TemporaryProject()
        try project.write("main.tex", "gespeichert\n")
        model.recovery.directory = backups.root
        model.recovery.saveDelay = .milliseconds(30)
        model.build.compileOnSave = false
        await model.openProject(project.root)
        return (project, backups)
    }

    private func tearDown() {
        model.recovery.saveDelay = RecoveryStore.defaultSaveDelay
        model.build.compileOnSave = true
    }

    private func backupExists(for url: URL) -> Bool {
        FileManager.default.fileExists(atPath: model.recovery.fileURL(for: url).path)
    }

    @Test("Ungespeicherter Text wird kurz nach der Eingabe gesichert; Speichern löscht die Sicherung")
    func backupAndSave() async throws {
        let (project, backups) = try await setUp()
        defer { project.remove(); backups.remove(); tearDown() }
        let session = try #require(model.editor.current)
        let url = project.url("main.tex")

        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "neu ")
        for _ in 0..<40 where !backupExists(for: url) { try await Task.sleep(for: .milliseconds(20)) }
        #expect(backupExists(for: url))
        #expect(model.recovery.backups(under: project.root).map(\.text) == ["neu gespeichert\n"])

        model.editor.saveCurrent()
        #expect(!backupExists(for: url))
    }

    @Test("Nach einem Absturz: beim Öffnen wiederherstellen (ungespeichert) oder verwerfen")
    func recoverAfterCrash() async throws {
        let (project, backups) = try await setUp()
        defer { project.remove(); backups.remove(); tearDown() }
        let url = project.url("main.tex")
        await model.recovery.write(RecoveryBackup(path: url.path, savedAt: Date(), text: "aus der Sicherung\n"))
        var offered: [String] = []
        model.confirmRecovery = { backups in offered = backups.map(\.url.lastPathComponent); return true }

        await model.openProject(project.root)

        #expect(offered == ["main.tex"])
        let session = try #require(model.editor.session(for: url))
        #expect(session.textStorage.string == "aus der Sicherung\n")
        #expect(session.isDirty)
        #expect(try String(contentsOf: url, encoding: .utf8) == "gespeichert\n", "Erst ⌘S schreibt auf die Platte")

        model.editor.saveAll()
        await model.recovery.write(RecoveryBackup(path: url.path, savedAt: Date(), text: "verwerfen\n"))
        model.confirmRecovery = { _ in false }
        await model.openProject(project.root)
        #expect(model.editor.session(for: url)?.textStorage.string == "aus der Sicherung\n")
        #expect(!backupExists(for: url))
    }

    @Test("Bewusstes „Nicht speichern“ löscht die Sicherung, veraltete Sicherungen verschwinden")
    func discardRemovesBackup() async throws {
        let (project, backups) = try await setUp()
        defer { project.remove(); backups.remove(); tearDown() }
        let url = project.url("main.tex")
        let session = try #require(model.editor.current)
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "x")
        await model.recovery.write(RecoveryBackup(path: url.path, savedAt: Date(), text: "x gespeichert\n"))
        model.promptForUnsavedChanges = { _, _ in .discard }

        model.closeTab(url)
        #expect(!backupExists(for: url))

        await model.recovery.write(RecoveryBackup(path: url.path, savedAt: Date(), text: "gespeichert\n"))
        #expect(model.recovery.backups(under: project.root).isEmpty, "Gleich wie auf der Platte: veraltet")
        #expect(!backupExists(for: url))
    }
}
}

@Suite("Zoom", .serialized)
@MainActor
struct FontSizeTests {
    @Test("⌘+ / ⌘−: Editor, offene Datei und Zeilennummern folgen dem Zoom; an den Enden bleibt es")
    func fontSize() async throws {
        defer { UserDefaults.standard.removeObject(forKey: InterfaceZoom.key) }
        let harness = CompletionHarness(text: "Zeile eins\nZeile zwei\n")
        try await harness.start()
        let before = harness.textView.enclosingScrollView?.verticalRulerView?.ruleThickness ?? 0

        InterfaceZoom.set(1.5)
        try await Task.sleep(for: .milliseconds(40))

        #expect(EditorAppearance.fontSize == 20, "13 pt × 150 %, gerundet")
        #expect(harness.textView.font?.pointSize == 20)
        let storageFont = harness.session.textStorage.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
        #expect(storageFont?.pointSize == 20)
        #expect(!harness.session.isDirty, "Nur das Aussehen, keine Bearbeitung")
        #expect((harness.textView.enclosingScrollView?.verticalRulerView?.ruleThickness ?? 0) > before)

        for _ in 0..<InterfaceZoom.steps.count { InterfaceZoom.zoomIn() }
        #expect(InterfaceZoom.current == 2)
        #expect(EditorAppearance.fontSize == 26)
        InterfaceZoom.reset()
        #expect(EditorAppearance.fontSize == EditorAppearance.defaultFontSize)
    }

    /// Hier statt in `InterfaceZoomTests`: beide Tests ändern den gemerkten Zoom und laufen deshalb nacheinander.
    @Test("Die Wurzel liest den gemerkten Zoom")
    func rootReadsStoredZoom() {
        defer { UserDefaults.standard.removeObject(forKey: InterfaceZoom.key) }
        let view = Text("A").scaledFont(.body).interfaceZoomRoot()
        let normal = NSHostingView(rootView: view).fittingSize.height
        UserDefaults.standard.set(2.0, forKey: InterfaceZoom.key)
        let zoomed = NSHostingView(rootView: view).fittingSize.height
        #expect(zoomed > normal * 1.6)
    }
}
