import AppKit
import Foundation
import Testing
@testable import LatexEditor

@Suite("⌘-Klick im Editor", .serialized)
@MainActor
struct CommandClickTests {
    private func windowPoint(forCharacter index: Int, in harness: CompletionHarness) throws -> NSPoint {
        let layoutManager = try #require(harness.textView.layoutManager)
        let container = try #require(harness.textView.textContainer)
        layoutManager.ensureLayout(for: container)
        let glyph = layoutManager.glyphIndexForCharacter(at: index)
        let rect = layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container)
        let origin = harness.textView.textContainerOrigin
        return harness.textView.convert(NSPoint(x: rect.midX + origin.x, y: rect.midY + origin.y), to: nil)
    }

    private func mouseDown(_ harness: CompletionHarness, at point: NSPoint, flags: NSEvent.ModifierFlags) throws -> NSEvent {
        try #require(NSEvent.mouseEvent(
            with: .leftMouseDown, location: point, modifierFlags: flags, timestamp: 0,
            windowNumber: harness.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1
        ))
    }

    @Test("⌘-Klick auf den Schlüssel springt; ohne ⌘ oder neben dem Schlüssel wirkt der Klick normal")
    func click() async throws {
        let text = "Siehe \\ref{fig:abc} und \\cite{key} Text"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        var jumped: [JumpTarget] = []
        harness.textView.onJumpToTarget = { jumped.append($0) }
        let source = text as NSString

        let onLabel = try windowPoint(forCharacter: source.range(of: "fig:abc").location + 3, in: harness)
        harness.textView.mouseDown(with: try mouseDown(harness, at: onLabel, flags: .command))
        #expect(jumped == [.label("fig:abc")])

        let onCite = try windowPoint(forCharacter: source.range(of: "key").location + 1, in: harness)
        harness.textView.mouseDown(with: try mouseDown(harness, at: onCite, flags: .command))
        #expect(jumped.last == .citation("key"))

        // Ein normaler Klick läuft in AppKit in eine Schleife, die auf das Loslassen wartet; deshalb nur die Entscheidung prüfen
        let plain = try windowPoint(forCharacter: source.range(of: "Text").location + 1, in: harness)
        #expect(harness.textView.commandClickTarget(for: try mouseDown(harness, at: onLabel, flags: [])) == nil, "ohne ⌘ setzt der Klick den Cursor")
        #expect(harness.textView.commandClickTarget(for: try mouseDown(harness, at: onLabel, flags: [.command, .shift])) == nil)
        #expect(harness.textView.commandClickTarget(for: try mouseDown(harness, at: plain, flags: .command)) == nil,
                "⌘-Klick auf normalen Text springt nirgends hin")
        #expect(harness.textView.commandClickTarget(for: try mouseDown(harness, at: onLabel, flags: .command)) == .label("fig:abc"))
    }

    @Test("Rechtsklick auf ein Label bietet „Label umbenennen …“ an, auf Text nicht")
    func contextMenu() async throws {
        let text = "Siehe \\ref{fig:abc} Text"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        var renamed: String?
        harness.textView.onRenameLabel = { renamed = $0 }
        let source = text as NSString

        func rightClick(at index: Int) throws -> NSMenu? {
            let event = try #require(NSEvent.mouseEvent(
                with: .rightMouseDown, location: try windowPoint(forCharacter: index, in: harness), modifierFlags: [], timestamp: 0,
                windowNumber: harness.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1
            ))
            return harness.textView.menu(for: event)
        }
        let menu = try #require(try rightClick(at: source.range(of: "fig:abc").location + 2))
        let item = try #require(menu.items.first { $0.title.contains("umbenennen") })
        #expect(item.title == "Label „fig:abc“ umbenennen …")
        _ = item.target?.perform(item.action, with: item)
        #expect(renamed == "fig:abc")

        let plainMenu = try rightClick(at: source.range(of: "Text").location + 1)
        #expect(plainMenu?.items.contains { $0.title.contains("umbenennen") } != true)
    }
}

extension AppModelSuite {
@Suite("Sprung und Label umbenennen (App-Ebene)")
@MainActor
struct NavigationActionsTests {
    private let model = AppModel.shared

    private func makeProject() throws -> TemporaryProject {
        let project = try TemporaryProject()
        try project.write("main.tex", "\\documentclass{report}\n\\bibliography{lit}\n\\begin{document}\n\\input{kapitel/eins}\n\\input{zwei}\n\\end{document}\n")
        try project.write("kapitel/eins.tex", "\\chapter{Eins}\n\\label{cha:eins}\nText\n")
        try project.write("zwei.tex", "\\chapter{Zwei}\nSiehe \\ref{cha:eins} und \\cref{cha:eins,cha:zwei}.\n\\label{cha:zwei}\n")
        try project.write("lit.bib", "% Kopf\n@book{alt,\n title={A}}\n@book{neu,\n title={B}}\n")
        return project
    }

    @Test("Sprung zu Label, Literatureintrag und Datei; unbekanntes Ziel ändert nichts")
    func jumping() async throws {
        let project = try makeProject()
        defer { project.remove() }
        await model.openProject(project.root)

        model.jump(to: .label("cha:zwei"))
        for _ in 0..<100 where model.editor.current?.url != project.url("zwei.tex") { try await Task.sleep(for: .milliseconds(20)) }
        #expect(model.editor.current?.url == project.url("zwei.tex"))
        #expect(model.editor.jumpRequest?.line == 3)

        model.jump(to: .citation("neu"))
        for _ in 0..<100 where model.editor.current?.url != project.url("lit.bib") { try await Task.sleep(for: .milliseconds(20)) }
        #expect(model.editor.current?.url == project.url("lit.bib"))
        #expect(model.editor.jumpRequest?.line == 4)

        model.jump(to: .file("kapitel/eins"))
        for _ in 0..<100 where model.editor.current?.url != project.url("kapitel/eins.tex") { try await Task.sleep(for: .milliseconds(20)) }
        #expect(model.editor.current?.url == project.url("kapitel/eins.tex"))

        let before = model.editor.tabs
        model.jump(to: .label("gibt-es-nicht"))
        model.jump(to: .file("nirgends"))
        try await Task.sleep(for: .milliseconds(100))
        #expect(model.editor.tabs == before)
    }

    @Test("Label umbenennen: Definition und Verweise in allen Dateien, ungespeichert und rückgängig machbar, Platte bleibt")
    func renaming() async throws {
        let project = try makeProject()
        defer { project.remove() }
        await model.openProject(project.root)
        await model.editor.open(project.url("zwei.tex"), asPreview: false)
        let sessionZwei = try #require(model.editor.current)
        sessionZwei.replaceText(with: sessionZwei.textStorage.string + "Noch \\autoref{cha:eins} ungespeichert\n", actionName: "Tippen")
        await model.editor.open(project.url("main.tex"), asPreview: false)
        let activeBefore = model.editor.tabs.active

        let summary = await model.labelRenameSummary(for: "cha:eins")
        #expect(summary == "4 Stellen in 2 Dateien", "label, ref, cref-Liste, ungespeichertes autoref")

        await model.renameLabel("cha:eins", to: "kap:einleitung")

        let eins = try #require(model.editor.session(for: project.url("kapitel/eins.tex")))
        #expect(eins.textStorage.string.contains("\\label{kap:einleitung}"))
        #expect(sessionZwei.textStorage.string.contains("\\ref{kap:einleitung} und \\cref{kap:einleitung,cha:zwei}"))
        #expect(sessionZwei.textStorage.string.contains("\\autoref{kap:einleitung}"))
        #expect(!sessionZwei.textStorage.string.contains("cha:eins"))
        #expect(try String(contentsOf: project.url("kapitel/eins.tex"), encoding: .utf8).contains("\\label{cha:eins}"), "Platte unverändert")
        #expect(eins.isDirty && sessionZwei.isDirty)
        #expect(model.editor.tabs.active == activeBefore)
        #expect(model.fileActions.notice?.contains("4 Stellen in 2 Dateien") == true)

        eins.undoManager.undo()
        #expect(eins.textStorage.string.contains("\\label{cha:eins}"), "⌘Z nimmt die Umbenennung zurück")
        model.fileActions.notice = nil
    }

    @Test("Ungültige oder vorhandene Namen werden nicht umbenannt; Dialog öffnet sich mit dem Label unter dem Cursor")
    func guardsAndPrompt() async throws {
        let project = try makeProject()
        defer { project.remove() }
        await model.openProject(project.root)

        await model.renameLabel("cha:eins", to: "cha:zwei")
        #expect(model.editor.session(for: project.url("kapitel/eins.tex")) == nil, "vorhanden: nichts geöffnet, nichts geändert")
        await model.renameLabel("cha:eins", to: "mit leerzeichen")
        #expect(model.fileActions.notice == nil)

        model.beginLabelRename(key: "cha:eins")
        #expect(model.fileActions.labelRename?.oldKey == "cha:eins")
        model.fileActions.labelRename = nil
    }
}
}
