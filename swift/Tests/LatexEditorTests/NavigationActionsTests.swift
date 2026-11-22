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

    @Test("⌘-Klick auf normalen Text setzt den Cursor und zeigt die Zeile im PDF; ohne ⌘ nicht")
    func clickShowsInPDF() async throws {
        let text = "Erste Zeile\nZweite Zeile mit Text\nSiehe \\ref{fig:abc}"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        var shown: [(URL, Int)] = []
        var jumped: [JumpTarget] = []
        harness.coordinator.showInPDFHandler = { shown.append(($0, $1)) }
        harness.textView.onJumpToTarget = { jumped.append($0) }
        let source = text as NSString

        let plain = source.range(of: "mit").location + 1
        harness.textView.mouseDown(with: try mouseDown(harness, at: try windowPoint(forCharacter: plain, in: harness), flags: .command))
        #expect(shown.map(\.1) == [2])
        #expect(shown.first?.0 == harness.session.url)
        #expect(harness.textView.selectedRange().location == plain || harness.textView.selectedRange().location == plain + 1)

        let onLabel = try windowPoint(forCharacter: source.range(of: "fig:abc").location + 2, in: harness)
        harness.textView.mouseDown(with: try mouseDown(harness, at: onLabel, flags: .command))
        #expect(jumped == [.label("fig:abc")], "Sprungziele gehen vor")
        #expect(shown.count == 1)
        #expect(harness.textView.commandClickLocation(for: try mouseDown(harness, at: onLabel, flags: [])) == nil)
        #expect(harness.textView.commandClickLocation(for: try mouseDown(harness, at: onLabel, flags: [.command, .option])) == nil)
    }

    @Test("Rechtsklick bietet „… umbenennen …“ mit allen Möglichkeiten der Stelle an, auf Text nicht")
    func contextMenu() async throws {
        let text = "Siehe \\ref{fig:abc} Text"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        var renamed: RenameScope?
        let source = text as NSString
        let label = RenameScope.project(RenameSubject(kind: .label, name: "fig:abc"))
        let pair = RenameScope.pair(harness.session.url, EnvironmentPair(name: "x", begin: NSRange(), end: NSRange()))
        harness.textView.renameScopes = { location in location < source.range(of: "Text").location ? [label, pair] : [] }
        harness.textView.onRename = { renamed = $0 }
        var usages: [(RenameSubject, Int)] = []
        harness.textView.onShowUsages = { usages.append(($0, $1)) }

        func rightClick(at index: Int) throws -> NSMenu? {
            let event = try #require(NSEvent.mouseEvent(
                with: .rightMouseDown, location: try windowPoint(forCharacter: index, in: harness), modifierFlags: [], timestamp: 0,
                windowNumber: harness.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1
            ))
            return harness.textView.menu(for: event)
        }
        let menu = try #require(try rightClick(at: source.range(of: "fig:abc").location + 2))
        #expect(menu.items.prefix(4).map(\.title) == [
            "Label „fig:abc“ umbenennen …", "Umgebung „x“ umbenennen (dieses Paar) …", "Verwendungen von Label „fig:abc“ anzeigen …", "",
        ])
        let item = menu.items[0]
        _ = item.target?.perform(item.action, with: item)
        #expect(renamed == label)
        let usageItem = menu.items[2]
        _ = usageItem.target?.perform(usageItem.action, with: usageItem)
        #expect(usages.map(\.0) == [RenameSubject(kind: .label, name: "fig:abc")])

        harness.textView.setSelectedRange(NSRange(location: source.range(of: "fig:abc").location + 1, length: 0))
        harness.textView.showUsages(nil)
        #expect(usages.count == 2, "Menü Bearbeiten: der Name unter dem Cursor")

        let plainMenu = try rightClick(at: source.range(of: "Text").location + 1)
        #expect(plainMenu?.items.contains { $0.title.contains("umbenennen") } != true)
    }
}

extension AppModelSuite {
@Suite("Sprung und Umbenennen (App-Ebene)")
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

    private func label(_ name: String) -> RenameScope {
        .project(RenameSubject(kind: .label, name: name))
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

        let summary = await model.renameSummary(for: label("cha:eins"))
        #expect(summary == "4 Stellen in 2 Dateien", "label, ref, cref-Liste, ungespeichertes autoref")

        await model.rename(label("cha:eins"), to: "kap:einleitung")

        let eins = try #require(model.editor.session(for: project.url("kapitel/eins.tex")))
        #expect(eins.textStorage.string.contains("\\label{kap:einleitung}"))
        #expect(sessionZwei.textStorage.string.contains("\\ref{kap:einleitung} und \\cref{kap:einleitung,cha:zwei}"))
        #expect(sessionZwei.textStorage.string.contains("\\autoref{kap:einleitung}"))
        #expect(!sessionZwei.textStorage.string.contains("cha:eins"))
        #expect(try String(contentsOf: project.url("kapitel/eins.tex"), encoding: .utf8).contains("\\label{cha:eins}"), "Platte unverändert")
        #expect(eins.isDirty && sessionZwei.isDirty)
        #expect(model.editor.tabs.active == activeBefore)
        #expect(model.fileActions.notice?.hasPrefix("Label „cha:eins“ → „kap:einleitung“: 4 Stellen in 2 Dateien") == true)

        eins.undoManager.undo()
        #expect(eins.textStorage.string.contains("\\label{cha:eins}"), "⌘Z nimmt die Umbenennung zurück")
        model.fileActions.notice = nil
    }

    @Test("Verwendungen: Definition und alle Stellen der Dateien, ungespeicherter Text zählt")
    func usages() async throws {
        let project = try makeProject()
        defer { project.remove() }
        await model.openProject(project.root)
        await model.editor.open(project.url("zwei.tex"), asPreview: false)
        let session = try #require(model.editor.current)
        session.replaceText(with: session.textStorage.string + "Noch \\autoref{cha:eins}\n", actionName: "Tippen")

        let found = await model.usages(of: RenameSubject(kind: .label, name: "cha:eins"))
        #expect(found.map { $0.file.lastPathComponent } == ["eins.tex", "zwei.tex", "zwei.tex", "zwei.tex"])
        #expect(found.map(\.isDefinition) == [true, false, false, false])
        #expect(found.last?.line == 4)

        let listModel = UsageListModel(subject: RenameSubject(kind: .label, name: "cha:eins"))
        await listModel.load { _ in found }
        #expect(listModel.definitions.count == 1 && listModel.uses == 3)
        #expect(listModel.usesByFile.map(\.file.lastPathComponent) == ["zwei.tex"])
        #expect(listModel.summary == "3 Verwendungen in 2 Dateien")
    }

    @Test("Ungültige oder vorhandene Namen werden nicht umbenannt; Dialog öffnet sich mit dem Label unter dem Cursor")
    func guardsAndPrompt() async throws {
        let project = try makeProject()
        defer { project.remove() }
        await model.openProject(project.root)

        await model.rename(label("cha:eins"), to: "cha:zwei")
        #expect(model.editor.session(for: project.url("kapitel/eins.tex")) == nil, "vorhanden: nichts geöffnet, nichts geändert")
        await model.rename(label("cha:eins"), to: "mit leerzeichen")
        #expect(model.fileActions.notice == nil)

        model.beginRename(label("cha:eins"))
        #expect(model.fileActions.rename?.scope == label("cha:eins"))
        model.fileActions.rename = nil
    }

    @Test("Quelle umbenennen: Schlüssel in der .bib und alle Zitate im Text")
    func renamingCitation() async throws {
        let project = try makeProject()
        defer { project.remove() }
        try project.write("kapitel/eins.tex", "\\chapter{Eins}\nWie \\cite{alt} und \\parencite[S.~2]{neu,alt}.\n")
        await model.openProject(project.root)
        await model.reloadCompletionIndex(immediately: true)
        let scope = RenameScope.project(RenameSubject(kind: .citation, name: "alt"))

        #expect(model.renameProblem("neu", for: scope) == "Eine Quelle mit diesem Namen gibt es schon.")
        #expect(await model.renameSummary(for: scope) == "3 Stellen in 2 Dateien")
        await model.rename(scope, to: "alt2020")

        let bib = try #require(model.editor.session(for: project.url("lit.bib")))
        let eins = try #require(model.editor.session(for: project.url("kapitel/eins.tex")))
        #expect(bib.textStorage.string.contains("@book{alt2020,"))
        #expect(eins.textStorage.string.contains("\\cite{alt2020} und \\parencite[S.~2]{neu,alt2020}"))
        #expect(bib.isDirty && eins.isDirty)
        model.fileActions.notice = nil
    }

    @Test("Eigene Befehle, Umgebungen und Abkürzungen; \\section und Vorlagen-Befehle werden nicht angeboten")
    func renamingCommandsEnvironmentsAcronyms() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("vorlage.sty", "\\newcommand{\\vorlage}{V}\n")
        try project.write("main.tex", """
            \\documentclass{report}
            \\newcommand{\\tool}{X}
            \\newenvironment{hinweis}{}{}
            \\newacronym{api}{API}{Programmierschnittstelle}
            \\begin{document}
            \\section{A} \\tool und \\vorlage, \\ac{api}.
            \\begin{hinweis}Text\\end{hinweis}
            \\begin{itemize}\\item a\\end{itemize}
            \\end{document}
            """)
        await model.openProject(project.root)
        await model.reloadCompletionIndex(immediately: true)
        await model.editor.open(project.url("main.tex"), asPreview: false)
        let session = try #require(model.editor.current)
        let text = session.textStorage.mutableString
        func scopes(at marker: String) -> [RenameScope] {
            model.renameScopes(at: text.range(of: marker).location + 2, in: session)
        }

        #expect(scopes(at: "\\section").isEmpty, "Kein eigener Befehl")
        #expect(scopes(at: "\\vorlage,").isEmpty, "Befehl der Vorlage (.sty)")
        #expect(scopes(at: "\\tool und") == [.project(RenameSubject(kind: .command, name: "tool"))])
        #expect(scopes(at: "api}.") == [.project(RenameSubject(kind: .acronym, name: "api"))])
        let itemize = scopes(at: "itemize}\\item")
        #expect(itemize.count == 1, "itemize: nur das Paar, weil nicht im Projekt definiert")
        #expect(scopes(at: "hinweis}Text").count == 2, "eigene Umgebung: Paar oder überall")

        await model.rename(.project(RenameSubject(kind: .command, name: "tool")), to: "\\werkzeug")
        await model.rename(.project(RenameSubject(kind: .environment, name: "hinweis")), to: "kasten")
        await model.rename(.project(RenameSubject(kind: .acronym, name: "api")), to: "schnittstelle")
        let stale = try #require(itemize.first)
        let beforeStale = session.textStorage.string
        await model.rename(stale, to: "enumerate")
        #expect(session.textStorage.string == beforeStale, "Veraltete Positionen: nichts ändern")
        #expect(model.fileActions.notice?.contains("steht nicht mehr an dieser Stelle") == true)
        let pair = try #require(scopes(at: "itemize}\\item").first)
        await model.rename(pair, to: "enumerate")

        let result = session.textStorage.string
        #expect(result.contains("\\newcommand{\\werkzeug}") && result.contains("\\werkzeug und"))
        #expect(result.contains("\\newenvironment{kasten}") && result.contains("\\begin{kasten}Text\\end{kasten}"))
        #expect(result.contains("\\newacronym{schnittstelle}") && result.contains("\\ac{schnittstelle}"))
        #expect(result.contains("\\begin{enumerate}\\item a\\end{enumerate}"))
        #expect(result.contains("\\section{A}") && result.contains("\\vorlage,"))

        session.undoManager.undo()
        #expect(session.textStorage.string.contains("\\begin{itemize}\\item a\\end{itemize}"), "⌘Z: nur das Paar zurück")
        model.fileActions.notice = nil
    }
}
}
