import AppKit
import Foundation
import SwiftUI
import Testing
@testable import LatexEditor

/// Kontext für Text mit `|` als Cursor (eine Zeile oder mehrere).
private func context(_ textWithCursor: String) -> CompletionContext? {
    let cursor = (textWithCursor as NSString).range(of: "|").location
    let text = textWithCursor.replacingOccurrences(of: "|", with: "") as NSString
    let lineStart = text.lineRange(for: NSRange(location: cursor, length: 0)).location
    return CompletionContextDetector.detect(in: text, cursor: cursor, lineStart: lineStart)
}

@Suite("Vervollständigung: Kontext")
struct CompletionContextTests {
    @Test("Befehle: nach \\ und Buchstaben, nicht nach \\\\ (Zeilenumbruch)")
    func commands() {
        #expect(context("Text \\sec|")?.kind == .command)
        #expect(context("Text \\sec|")?.prefix == "sec")
        #expect(context("Text \\|")?.prefix == "")
        #expect(context("a\\\\sec|") == nil)
        #expect(context("a\\\\\\sec|")?.prefix == "sec")
        #expect(context("50\\% \\emph|")?.prefix == "emph")
        #expect(context("einfach Text|") == nil)
    }

    @Test("Argumente bekannter Befehle, auch mit optionalen Argumenten und Stern")
    func arguments() {
        #expect(context("siehe \\ref{fig:|")?.kind == .argument(.label))
        #expect(context("siehe \\ref{fig:|")?.prefix == "fig:")
        #expect(context("\\cite[S.~3]{knu|")?.kind == .argument(.citation))
        #expect(context("\\includegraphics[width=.5\\textwidth]{bil|")?.kind == .argument(.graphics))
        #expect(context("\\include{|")?.kind == .argument(.input))
        #expect(context("\t\\begin{ite|")?.kind == .argument(.beginEnvironment))
        #expect(context("\\end{|")?.kind == .argument(.endEnvironment))
        #expect(context("\\section*{Titel|") == nil, "Unbekannter Befehl")
        #expect(context("\\ref{a} und |") == nil, "Klammer schon geschlossen")
    }

    @Test("Listen nur bei Zitaten und Labels; Leerzeichen nach dem Komma gehören nicht zum Präfix")
    func lists() {
        let cite = context("\\cite{knuth, lam|")
        #expect(cite?.kind == .argument(.citation))
        #expect(cite?.prefix == "lam")
        #expect(context("\\cref{a,b|")?.prefix == "b")
        #expect(context("\\include{a,b|") == nil)
    }

    @Test("Nicht in Kommentaren, aber nach maskiertem %")
    func comments() {
        #expect(context("% \\ref{|") == nil)
        #expect(context("Text % \\sec|") == nil)
        #expect(context("50\\% \\ref{|")?.kind == .argument(.label))
    }

    @Test("Bereich in UTF-16, auch hinter Emoji und Umlauten")
    func utf16Range() throws {
        let detected = try #require(context("Größe 😀 \\ref{ab|"))
        #expect(detected.range == NSRange(location: 14, length: 2))
    }
}

@Suite("Vervollständigung: Sortierung")
struct CompletionMatcherTests {
    private let items = ["section", "subsection", "Section", "textsection", "sectionmark", "fig:ablauf", "cha:einleitung"]
        .map { CompletionItem(kind: .command, text: $0) }

    @Test("Anfang vor Anfang ohne Groß-/Kleinschreibung vor Wortanfang vor enthalten; kürzer zuerst")
    func ranking() {
        #expect(CompletionMatcher.rank(items, prefix: "sec").map(\.text) == ["section", "sectionmark", "Section", "subsection", "textsection"])
        #expect(CompletionMatcher.rank(items, prefix: "einl").map(\.text) == ["cha:einleitung"])
        #expect(CompletionMatcher.rank(items, prefix: "abl").map(\.text) == ["fig:ablauf"])
        #expect(CompletionMatcher.rank(items, prefix: "xyz").isEmpty)
    }

    @Test("Ohne Präfix bleibt die Reihenfolge, die Grenze gilt")
    func emptyPrefixAndLimit() {
        #expect(CompletionMatcher.rank(items, prefix: "").map(\.text) == items.map(\.text))
        #expect(CompletionMatcher.rank(items, prefix: "s", limit: 2).count == 2)
    }
}

@Suite("Vervollständigung: Einfügen")
struct CompletionApplierTests {
    private func apply(_ item: CompletionItem, to textWithCursor: String) throws -> String {
        let detected = try #require(context(textWithCursor))
        let text = NSMutableString(string: textWithCursor.replacingOccurrences(of: "|", with: ""))
        let edit = CompletionApplier.edit(for: item, context: detected, in: text)
        text.replaceCharacters(in: edit.range, with: edit.text)
        text.insert("|", at: edit.selection.location)
        return text as String
    }

    @Test("Befehl mit Gerüst: Cursor im ersten Argument")
    func command() throws {
        #expect(try apply(.command("section", arguments: "{}"), to: "\\sec|") == "\\section{|}")
        #expect(try apply(.command("cite", arguments: "[]{}"), to: "\\ci|") == "\\cite[|]{}")
        #expect(try apply(.command("centering"), to: "\\cen|") == "\\centering|")
    }

    @Test("Argument: ersetzt das ganze Wort, schließt die Klammer nur, wenn sie fehlt; Komma bleibt")
    func argument() throws {
        let label = CompletionItem(kind: .label, text: "fig:ablauf")
        #expect(try apply(label, to: "\\ref{fig:a|") == "\\ref{fig:ablauf}|")
        #expect(try apply(label, to: "\\ref{fig:a|bc}") == "\\ref{fig:ablauf}|")
        let key = CompletionItem(kind: .citation, text: "lamport")
        #expect(try apply(key, to: "\\cite{knuth,la|,x}") == "\\cite{knuth,lamport|,x}")
    }

    @Test("\\begin: Gerüst mit \\end, eingerückt wie die Zeile; Listen mit \\item; kein doppeltes \\end")
    func environments() throws {
        let itemize = CompletionItem(kind: .environment, text: "itemize")
        #expect(try apply(itemize, to: "\t\\begin{it|") == "\t\\begin{itemize}\n\t\t\\item |\n\t\\end{itemize}")
        let figure = CompletionItem(kind: .environment, text: "figure")
        #expect(try apply(figure, to: "\\begin{fi|}") == "\\begin{figure}\n\t|\n\\end{figure}")
        #expect(try apply(itemize, to: "\\begin{it|}\n\\end{itemize}") == "\\begin{itemize}|\n\\end{itemize}")
        #expect(try apply(itemize, to: "\\begin{it|} danach") == "\\begin{itemize}| danach")
        #expect(try apply(itemize, to: "\\end{it|") == "\\end{itemize}|")
    }
}

@Suite("Vervollständigung: Projektindex")
struct CompletionIndexTests {
    @Test("Eigene Makros und Umgebungen aus .tex und .sty, keine internen mit @, keine aus Kommentaren")
    func definitions() throws {
        let commands = CompletionIndex.definedCommands(in: """
            \\newcommand{\\todo}[1]{x}
            \\newcommand\\kurz{y}
            \\def\\alt{z}
            \\DeclareMathOperator{\\argmax}{arg\\,max}
            \\newcommand{\\intern@x}{}
            % \\newcommand{\\auskommentiert}{}
            """)
        #expect(commands == ["todo", "kurz", "alt", "argmax"])
        #expect(CompletionIndex.definedEnvironments(in: "\\newenvironment{hinweis}{}{}\n\\begin{itemize}\n\\begin{align*}") == ["hinweis", "itemize", "align*"])
    }

    @Test("Bilder relativ zu \\graphicspath, Dateien relativ zur Hauptdatei ohne .tex, Makros der Vorlage")
    func build() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "\\documentclass{hgbthesis}\n\\graphicspath{{images/}}\n\\newcommand{\\eigen}{}\n")
        let chapter = try project.write("chapters/einleitung.tex", "\\chapter{Einleitung}\\label{cha:einleitung}\n")
        let image = try project.write("images/ablauf.pdf", "PDF")
        let style = try project.write("hgbthesis.cls", "\\newcommand{\\advisor}[1]{}\n\\newenvironment{aiusage}{}{}\n")

        let index = CompletionIndex.build(files: [main, chapter, image], styleFiles: [style], projectRoot: project.root, mainFile: main)

        #expect(index.graphicsReferences == ["ablauf.pdf"])
        #expect(index.inputPaths == ["chapters/einleitung"])
        #expect(index.userCommands == ["advisor", "eigen"])
        #expect(index.environments == ["aiusage"])
        #expect(index.catalog.labels.map(\.label) == ["cha:einleitung"])
        #expect(CompletionIndex.styleFiles(in: project.root).map(\.lastPathComponent) == ["hgbthesis.cls"])
    }

    @Test("Offene Umgebungen für \\end: innerste zuletzt im Stapel, geschlossene und auskommentierte zählen nicht")
    func openEnvironments() {
        let text = "\\begin{document}\n\\begin{figure}\n\\begin{tabular}\n\\end{tabular}\n% \\begin{itemize}\n\\begin{center}\n" as NSString
        #expect(OpenEnvironments.stack(in: text, upTo: text.length) == ["document", "figure", "center"])
    }
}

@Suite("Vervollständigung: Vorschläge")
@MainActor
struct CompletionProviderTests {
    @Test("Labels auch aus ungespeicherten Dateien; \\end schlägt die innerste offene Umgebung zuerst vor")
    func items() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "\\label{sec:alt}\n")
        let provider = CompletionProvider()
        await provider.reload(files: [main], projectRoot: project.root, mainFile: main)
        provider.unsavedDocuments = { [(main, "\\label{sec:neu}\n")] }
        let text = "\\begin{figure}\n\\begin{center}\n" as NSString

        let labels = provider.items(for: CompletionContext(kind: .argument(.label), prefix: "", range: NSRange()), document: text, cursor: 0)
        let ends = provider.items(for: CompletionContext(kind: .argument(.endEnvironment), prefix: "", range: NSRange()),
                                  document: text, cursor: text.length)
        let commands = provider.items(for: CompletionContext(kind: .command, prefix: "", range: NSRange()), document: text, cursor: 0)

        #expect(labels.map(\.text) == ["sec:neu"], "Die gespeicherte Fassung der geänderten Datei gilt nicht mehr")
        #expect(labels.first?.detail == "main.tex:1")
        #expect(ends.map(\.text) == ["center", "figure"])
        #expect(commands.contains { $0.text == "section" })
    }
}

/// Echter Editor (Coordinator) im Offscreen-Fenster; das Popup bleibt unsichtbar.
@MainActor
struct CompletionHarness {
    let coordinator = EditorCoordinator()
    let window: NSWindow
    let session: DocumentSession
    let provider = CompletionProvider()

    init(text: String) {
        let scrollView = coordinator.makeScrollView()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        scrollView.frame = window.contentLayoutRect
        window.contentView = scrollView
        session = DocumentSession(url: URL(fileURLWithPath: "/tmp/vervollstaendigung.tex"), text: text)
        coordinator.completion.presentsPanel = false
        coordinator.completion.isAutomatic = { true }
    }

    var textView: LatexTextView { (window.contentView as! NSScrollView).documentView as! LatexTextView }
    var completion: CompletionController { coordinator.completion }

    func start(labels: [String] = ["fig:ablauf", "tab:werte", "cha:einleitung"]) async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let file = try project.write("labels.tex", labels.map { "\\label{\($0)}" }.joined(separator: "\n"))
        await provider.reload(files: [file], projectRoot: project.root, mainFile: file)
        coordinator.update(session: session, jump: nil, insert: nil)
        coordinator.updateCompletion(provider: provider, request: nil)
        try await Task.sleep(for: .milliseconds(30))
        textView.setSelectedRange(NSRange(location: session.textStorage.length, length: 0))
    }

    func type(_ text: String) {
        for character in text { textView.insertText(String(character), replacementRange: textView.selectedRange()) }
    }

    func command(_ selector: Selector) {
        textView.doCommand(by: selector)
    }
}

@Suite("Vervollständigung im echten Editor", .serialized)
@MainActor
struct CompletionEditorTests {
    @Test("\\ref{ tippen: Liste mit Labels, Weitertippen filtert, Return übernimmt als ein Undo-Schritt")
    func labelCompletion() async throws {
        let harness = CompletionHarness(text: "Siehe ")
        try await harness.start()

        harness.type("\\ref{")
        #expect(harness.completion.visibleItems.map(\.text) == ["cha:einleitung", "fig:ablauf", "tab:werte"])
        harness.type("abl")
        #expect(harness.completion.visibleItems.map(\.text) == ["fig:ablauf"])
        // Wie bei echten Tastendrücken: Der UndoManager schließt seine Gruppe am Ende des Runloop-Durchlaufs.
        try await Task.sleep(for: .milliseconds(20))

        harness.command(#selector(NSResponder.insertNewline(_:)))
        #expect(harness.session.textStorage.string == "Siehe \\ref{fig:ablauf}")
        #expect(!harness.completion.isVisible)
        #expect(harness.textView.selectedRange() == NSRange(location: 22, length: 0))

        try await Task.sleep(for: .milliseconds(20))
        harness.session.undoManager.undo()
        #expect(harness.session.textStorage.string == "Siehe \\ref{abl")
    }

    @Test("Befehl: \\beg + Tab → \\begin{} und gleich die Umgebungen; ↓ und Return fügen das Gerüst ein")
    func commandChain() async throws {
        let harness = CompletionHarness(text: "")
        try await harness.start()

        harness.type("\\beg")
        #expect(harness.completion.visibleItems.first?.text == "begin")
        harness.command(#selector(NSResponder.insertTab(_:)))
        #expect(harness.session.textStorage.string == "\\begin{}")
        try await Task.sleep(for: .milliseconds(20))
        #expect(harness.completion.isVisible, "Nach \\begin{ folgen die Umgebungen")

        harness.type("enum")
        harness.command(#selector(NSResponder.insertNewline(_:)))
        #expect(harness.session.textStorage.string == "\\begin{enumerate}\n\t\\item \n\\end{enumerate}")
    }

    @Test("Esc schließt; Esc ohne Liste öffnet sie von Hand; ↑↓ wählen; Klick daneben schließt")
    func keyboard() async throws {
        let harness = CompletionHarness(text: "")
        try await harness.start()
        harness.type("\\ref{")
        harness.command(#selector(NSResponder.moveDown(_:)))
        #expect(harness.completion.selectedIndex == 1)
        harness.command(#selector(NSResponder.moveUp(_:)))
        harness.command(#selector(NSResponder.moveUp(_:)))
        #expect(harness.completion.selectedIndex == 0)

        harness.command(#selector(NSResponder.cancelOperation(_:)))
        #expect(!harness.completion.isVisible)
        harness.command(#selector(NSResponder.cancelOperation(_:)))
        #expect(harness.completion.isVisible)

        harness.textView.setSelectedRange(NSRange(location: 0, length: 0))
        #expect(!harness.completion.isVisible)

        harness.textView.setSelectedRange(NSRange(location: harness.session.textStorage.length, length: 0))
        harness.coordinator.updateCompletion(provider: harness.provider, request: UUID())
        try await Task.sleep(for: .milliseconds(20))
        #expect(harness.completion.isVisible, "Menü Bearbeiten → Vervollständigen (⌃Leertaste)")
    }

    @Test("Nach mehreren Filterschritten zeigt das Popup genau die aktuellen Treffer (keine Reste früherer Zeilen)")
    func popupShowsCurrentItems() async throws {
        let harness = CompletionHarness(text: "")
        try await harness.start()
        for character in "\\sec" {
            harness.type(String(character))
            try await Task.sleep(for: .milliseconds(20))
        }
        harness.command(#selector(NSResponder.moveDown(_:)))
        let live = try #require(harness.completion.popupWindow.contentView)

        let fresh = CompletionListModel()
        fresh.items = harness.completion.visibleItems
        fresh.selectedIndex = harness.completion.selectedIndex
        let reference = NSHostingView(rootView: CompletionListView(model: fresh))
        let window = NSWindow(contentRect: live.bounds, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = reference

        #expect(try await render(live) == render(reference))
    }

    private func render(_ view: NSView) async throws -> Data {
        for _ in 0..<4 {
            view.layoutSubtreeIfNeeded()
            view.display()
            try await Task.sleep(for: .milliseconds(40))
        }
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return try #require(bitmap.tiffRepresentation)
    }

    @Test("Nicht in Kommentaren, nicht bei abgeschalteter Automatik, nicht bei Einfügen größerer Texte")
    func noPopup() async throws {
        let harness = CompletionHarness(text: "% Kommentar ")
        try await harness.start()
        harness.type("\\ref{")
        #expect(!harness.completion.isVisible)

        harness.session.textStorage.replaceCharacters(in: NSRange(location: 0, length: harness.session.textStorage.length), with: "")
        harness.completion.isAutomatic = { false }
        harness.type("\\sec")
        #expect(!harness.completion.isVisible)
        harness.completion.isAutomatic = { true }
        harness.textView.insertText("\\ref{", replacementRange: harness.textView.selectedRange())
        #expect(!harness.completion.isVisible, "Eingefügter Text (mehr als ein Zeichen) öffnet nichts")
    }
}

extension AppModelSuite {
@Suite("Vervollständigung auf App-Ebene")
@MainActor
struct CompletionAppTests {
    @Test("Index beim Öffnen des Projekts gelesen und nach dem Speichern aktualisiert")
    func indexFollowsProject() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\label{sec:start}\n")
        let model = AppModel.shared
        await model.openProject(project.root)
        #expect(model.completionProvider.index.catalog.labels.map(\.label) == ["sec:start"])

        let session = try #require(model.editor.current)
        session.textStorage.replaceCharacters(in: NSRange(location: session.textStorage.length, length: 0), with: "\\label{sec:neu}\n")
        let unsaved = model.completionProvider.items(
            for: CompletionContext(kind: .argument(.label), prefix: "", range: NSRange()), document: "" as NSString, cursor: 0)
        #expect(unsaved.map(\.text) == ["sec:neu", "sec:start"], "Ungespeichertes Label ist sofort dabei")

        model.build.compileOnSave = false
        model.editor.saveCurrent()
        for _ in 0..<60 where model.completionProvider.index.catalog.labels.count < 2 { try await Task.sleep(for: .milliseconds(50)) }
        #expect(model.completionProvider.index.catalog.labels.map(\.label).sorted() == ["sec:neu", "sec:start"])
        model.build.compileOnSave = true
    }
}
}
