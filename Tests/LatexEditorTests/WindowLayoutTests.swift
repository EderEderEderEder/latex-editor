import AppKit
import PDFKit
import SwiftUI
import Testing
@testable import LatexEditor

/// Rendert das echte Hauptfenster offscreen und prüft das Layout von Editor und Ruler.
/// Schützt vor: zu niedrigem Split-View, Text unter dem Ruler, Ruler übermalt den Text.
/// Alle Tests, die `AppModel.shared` verwenden, laufen nacheinander: Sie teilen sich Projekt, Tabs und Stores.
@Suite("App-Ebene (teilt AppModel.shared)", .serialized)
enum AppModelSuite {}

extension AppModelSuite {
@Suite("Fensterlayout")
@MainActor
struct WindowLayoutTests {
    private static let windowSize = NSSize(width: 1400, height: 860)
    private static let layoutPasses = 5
    /// Anteil der Fensterhöhe, den der Editor mindestens einnehmen muss.
    private static let minimumHeightFraction: CGFloat = 0.9
    /// Mindestanteil gezeichneter (nicht hintergrundfarbener) Pixel im oberen Textbereich.
    private static let minimumInkFraction = 0.01

    /// Fenster früherer Tests hängen am selben `AppModel.shared`; ihre Editor-Ansichten würden beim
    /// Sitzungswechsel die gemerkte Auswahl überschreiben. In der App gibt es nur ein Fenster.
    private static var openedWindows: [NSWindow] = []

    private func discardWindowsOfEarlierTests() {
        for window in Self.openedWindows { window.contentView = NSView() }
        Self.openedWindows.removeAll()
    }

    private func makeWindow() async throws -> (window: NSWindow, project: TemporaryProject) {
        discardWindowsOfEarlierTests()
        let project = try TemporaryProject()
        try project.write("main.tex", LargeDocument.make(lineCount: 200))
        let model = AppModel.shared
        await model.project.open(root: project.root)
        model.pdf.setMainFile(model.project.mainFileURL)
        await model.editor.open(project.url("main.tex"))

        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.windowSize),
            styleMask: [.titled, .resizable],
            backing: .buffered,
            defer: false
        )
        window.contentView = NSHostingView(rootView: RootView(model: model))
        Self.openedWindows.append(window)
        for _ in 0..<Self.layoutPasses {
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            try await Task.sleep(for: .milliseconds(100))
        }
        return (window, project)
    }

    @Test("Editor füllt die Höhe, Text beginnt rechts vom Ruler und wird gezeichnet")
    func editorLayout() async throws {
        let (window, project) = try await makeWindow()
        defer { project.remove() }
        let content = try #require(window.contentView)
        let scrollView = try #require(firstSubview(of: NSScrollView.self, in: content) { $0.documentView is LatexTextView })
        let ruler = try #require(scrollView.verticalRulerView as? LineNumberRulerView)
        let clipView = scrollView.contentView

        #expect(scrollView.frame.height >= Self.windowSize.height * Self.minimumHeightFraction)
        #expect(clipView.bounds.minX == -ruler.ruleThickness)
        #expect(ruler.clipsToBounds)
        #expect(inkFraction(of: scrollView, excludingLeft: ruler.ruleThickness) >= Self.minimumInkFraction)
    }

    private func firstSubview<T: NSView>(of type: T.Type, in view: NSView, where predicate: (T) -> Bool) -> T? {
        if let match = view as? T, predicate(match) { return match }
        for subview in view.subviews {
            if let match = firstSubview(of: type, in: subview, where: predicate) { return match }
        }
        return nil
    }

    /// Anteil der Pixel im oberen Textbereich, die sich vom Hintergrund unterscheiden.
    private func inkFraction(of view: NSView, excludingLeft rulerWidth: CGFloat) -> Double {
        let sampleHeight: CGFloat = 200
        let region = NSRect(x: rulerWidth, y: 0, width: view.bounds.width - rulerWidth, height: sampleHeight)
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: region) else { return 0 }
        view.cacheDisplay(in: region, to: bitmap)
        guard let background = bitmap.colorAt(x: bitmap.pixelsWide - 1, y: bitmap.pixelsHigh - 1) else { return 0 }
        var inked = 0
        for x in stride(from: 0, to: bitmap.pixelsWide, by: 2) {
            for y in stride(from: 0, to: bitmap.pixelsHigh, by: 2) where bitmap.colorAt(x: x, y: y) != background {
                inked += 1
            }
        }
        let sampled = (bitmap.pixelsWide / 2) * (bitmap.pixelsHigh / 2)
        return Double(inked) / Double(max(sampled, 1))
    }

    @Test("Sprünge durch das echte Fenster: wiederholt, dateiübergreifend, mit Tabwechseln und Projektwechsel")
    func repeatedJumpsThroughWindow() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\begin{document}\n\\include{eins}\n\\include{zwei}\n\\end{document}\n")
        try project.write("eins.tex", LargeDocument.make(lineCount: 400))
        try project.write("zwei.tex", "kurz\n" + LargeDocument.make(lineCount: 30))
        let model = AppModel.shared
        await model.openProject(project.root)
        let window = try await showWindow(for: model)
        let content = try #require(window.contentView)
        let textView = try #require(firstSubview(of: LatexTextView.self, in: content) { _ in true })

        let jumps: [(String, Int)] = [("eins.tex", 380), ("zwei.tex", 2), ("eins.tex", 380), ("eins.tex", 380), ("zwei.tex", 31), ("main.tex", 4)]
        for (index, (file, line)) in jumps.enumerated() {
            model.sidebar.tab = SidebarTab.allCases[index % SidebarTab.allCases.count]
            await model.editor.open(project.url(file), line: line)
            try await settle(window)
            let session = try #require(model.editor.current)
            #expect(textView.textStorage === session.textStorage, "Sprung \(index): falscher Text")
            #expect(session.lineIndex.line(containing: textView.selectedRange().location) + 1 == line, "Sprung \(index) nach \(file):\(line)")
        }

        let other = try TemporaryProject()
        defer { other.remove() }
        try other.write("main.tex", "\\documentclass{article}\n\\begin{document}\nNeu\n\\end{document}\n")
        await model.openProject(other.root)
        try await settle(window)
        #expect(model.editor.current?.url == other.url("main.tex"))
        #expect(textView.textStorage?.length == model.editor.current?.textStorage.length)
        #expect(model.sidebar.tab == .files)
    }

    @Test("SyncTeX durch das echte Fenster: ⌘J, PDF folgt Cursor, ⌘-Klick ins PDF", .enabled(if: LatexToolchain.latexmk() != nil))
    func syncTeXThroughWindow() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\begin{document}\n\\include{eins}\n\\include{zwei}\n\\end{document}\n")
        try project.write("eins.tex", "\\chapter{Eins}\nText im ersten Kapitel.\n")
        let paragraphs = (1...60).map { "Absatz \($0) im zweiten Kapitel mit etwas Text.\n" }.joined(separator: "\n")
        try project.write("zwei.tex", "\\chapter{Zwei}\n" + paragraphs)
        let model = AppModel.shared
        model.synctex.followCursor = false
        await model.openProject(project.root)
        model.compile()
        for _ in 0..<150 where model.build.isRunning { try await Task.sleep(for: .milliseconds(100)) }
        await model.synctex.waitUntilLoaded()
        #expect(model.build.status == .succeeded)
        let window = try await showWindow(for: model)
        let pdfView = try #require(model.pdf.pdfView)

        // ⌘J auf eine Zeile weit hinten in Kapitel 2
        let chapterTwo = project.url("zwei.tex")
        let target = try #require(model.synctex.forward(file: chapterTwo, line: 101))
        #expect(target.page >= 3)
        await model.editor.open(chapterTwo, line: 101)
        try await settle(window)
        model.showCursorInPDF()
        try await settle(window)
        #expect(model.pdf.currentPage == target.page)
        let page = try #require(pdfView.document?.page(at: target.page - 1))
        let highlight = try #require(page.annotations.first { $0.type == "Highlight" })
        #expect(highlight.color.usingColorSpace(.sRGB) == PDFPreviewStore.highlightColor.usingColorSpace(.sRGB))
        let alphas = try await sampleHighlightAlpha(highlight, on: page)
        #expect(!page.annotations.contains { $0.type == "Highlight" }, "Markierung muss am Ende verschwinden")
        #expect(zip(alphas, alphas.dropFirst()).allSatisfy { $0 >= $1 }, "Deckkraft darf nur abnehmen: \(alphas)")
        #expect(Set(alphas.filter { $0 > 0.05 && $0 < 0.95 }).count >= 3, "weiches Ausblenden statt Sprung: \(alphas)")

        // PDF folgt Cursor: Wechsel nach Kapitel 1 scrollt das PDF auf Seite 1
        model.synctex.followCursor = true
        defer { model.synctex.followCursor = false }
        await model.editor.open(project.url("eins.tex"), line: 2)
        try await settle(window)
        #expect(model.pdf.currentPage == 1)

        // ⌘-Klick auf die Stelle von Zeile 62 (Absätze stehen auf geraden Zeilen) öffnet genau diese Zeile
        let clickTarget = try #require(model.synctex.forward(file: chapterTwo, line: 62))
        let clickPage = try #require(pdfView.document?.page(at: clickTarget.page - 1))
        let pdfRect = SyncTeXCoordinates.pdfRect(from: clickTarget.rect, mediaBox: clickPage.bounds(for: .mediaBox))
        model.pdf.handleCommandClick(on: clickPage, at: CGPoint(x: pdfRect.midX, y: pdfRect.midY))
        try await settle(window)
        let session = try #require(model.editor.current)
        #expect(session.url == chapterTwo)
        let windowContent = try #require(window.contentView)
        let textView = try #require(firstSubview(of: LatexTextView.self, in: windowContent) { _ in true })
        #expect(session.lineIndex.line(containing: textView.selectedRange().location) + 1 == 62)
    }

    /// Liest die Deckkraft der Markierung in kurzen Abständen, bis sie entfernt ist (höchstens 3 s).
    private func sampleHighlightAlpha(_ annotation: PDFAnnotation, on page: PDFPage) async throws -> [CGFloat] {
        var alphas: [CGFloat] = []
        for _ in 0..<150 where page.annotations.contains(where: { $0 === annotation }) {
            alphas.append(annotation.color.alphaComponent)
            try await Task.sleep(for: .milliseconds(20))
        }
        return alphas
    }

    @Test("Einfügen-Fenster durch AppModel: Tabelle, Bild-Kopie, Gleichung mit Markierung, Verweis, Zitat")
    func insertionThroughModel() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let outside = try TemporaryProject()
        defer { outside.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\graphicspath{{images/}}\n\\begin{document}\n\\include{kapitel}\n\\end{document}\n")
        try project.write("kapitel.tex", "\\chapter{Eins}\n\\label{chap:eins}\nSiehe: \n\nx^2 + y^2\n")
        try project.write("refs.bib", "@book{knuth1984, title={The TeXbook}}\n")
        let picture = try outside.write("Foto vom Urlaub.PNG", "PNGDATA")
        let model = AppModel.shared
        await model.openProject(project.root)
        await model.editor.open(project.url("kapitel.tex"))
        let window = try await showWindow(for: model)
        let content = try #require(window.contentView)
        let textView = try #require(firstSubview(of: LatexTextView.self, in: content) { _ in true })
        let session = try #require(model.editor.current)
        #expect(model.editor.canInsert)

        // Tabelle am Ende von Zeile 2
        textView.setSelectedRange(NSRange(location: session.lineIndex.contentRange(ofLine: 1).upperBound, length: 0))
        model.presentInsert(.table)
        model.insertion.table.caption = "Messwerte"
        model.insertion.table.cells[0] = ["A", "B", "C"]
        await model.performInsert()
        try await settle(window)
        #expect(!model.insertion.isPresented)
        #expect(session.textStorage.string.contains("\\label{tab:messwerte}"))
        #expect(session.isDirty)

        // Bild von außerhalb: wird kopiert, Pfad nutzt \graphicspath
        model.presentInsert(.image)
        model.insertion.image.file = picture
        model.insertion.image.caption = "Urlaub"
        await model.performInsert()
        try await settle(window)
        #expect(FileManager.default.fileExists(atPath: project.url("images/Foto-vom-Urlaub.png").path))
        #expect(session.textStorage.string.contains("{Foto-vom-Urlaub.png}"))

        // Gleichung ersetzt die Markierung
        let formula = (session.textStorage.string as NSString).range(of: "x^2 + y^2")
        textView.setSelectedRange(formula)
        model.presentInsert(.equation)
        #expect(model.insertion.equation.content == "x^2 + y^2")
        await model.performInsert()
        try await settle(window)
        #expect(session.textStorage.string.contains("\\begin{equation}\n\tx^2 + y^2\n\\end{equation}"))

        // Verweis auf das Label der Tabelle, danach Zitat
        let afterColon = (session.textStorage.string as NSString).range(of: "Siehe: ")
        textView.setSelectedRange(NSRange(location: NSMaxRange(afterColon), length: 0))
        model.presentInsert(.reference)
        await model.insertion.waitForCatalog()
        #expect(model.insertion.catalog.labels.map(\.label).contains("chap:eins"))
        model.insertion.reference.label = "chap:eins"
        await model.performInsert()
        try await settle(window)
        #expect(session.textStorage.string.contains("Siehe: Kapitel~\\ref{chap:eins}"))

        model.presentInsert(.citation)
        await model.insertion.waitForCatalog()
        #expect(model.insertion.catalog.bibEntries.map(\.key) == ["knuth1984"])
        model.insertion.citation.keys = ["knuth1984"]
        await model.performInsert()
        try await settle(window)
        #expect(session.textStorage.string.contains("\\cite{knuth1984}"))
    }

    @Test("Tabs durch das echte Fenster: Wechsel, Schließen mit Nachfrage, Vorschau-Tab, Wiederherstellung")
    func tabsThroughWindow() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\begin{document}\n\\include{eins}\n\\include{zwei}\n\\end{document}\n")
        try project.write("eins.tex", "\\chapter{Eins}\n" + LargeDocument.make(lineCount: 120))
        try project.write("zwei.tex", "\\chapter{Zwei}\nkurz\n")
        try project.write("drei.tex", "\\chapter{Drei}\n")
        let model = AppModel.shared
        let originalPrompt = model.promptForUnsavedChanges
        defer { model.promptForUnsavedChanges = originalPrompt }
        await model.openProject(project.root)
        let window = try await showWindow(for: model)
        let content = try #require(window.contentView)
        let textView = try #require(firstSubview(of: LatexTextView.self, in: content) { _ in true })
        #expect(model.editor.tabs.fileURLs == [project.url("main.tex")], "Hauptdatei ist der erste Tab")

        // Einfachklicks: Vorschau-Tab wird ersetzt; Doppelklick (Tab festhalten) behält ihn
        await model.editor.open(project.url("eins.tex"))
        await model.editor.open(project.url("zwei.tex"))
        #expect(model.editor.tabs.fileURLs == [project.url("main.tex"), project.url("zwei.tex")])
        model.editor.keepTab(project.url("zwei.tex"))
        await model.editor.open(project.url("eins.tex"))
        #expect(model.editor.tabs.fileURLs.count == 3)
        try await settle(window)
        #expect(textView.textStorage === model.editor.current?.textStorage)

        // Wechsel über die Tab-Leiste, Auswahl bleibt pro Tab erhalten
        textView.setSelectedRange(NSRange(location: 300, length: 4))
        model.editor.activateTab(project.url("zwei.tex"))
        try await settle(window)
        #expect(textView.textStorage?.string.hasPrefix("\\chapter{Zwei}") == true)
        model.editor.activateTab(project.url("eins.tex"))
        try await settle(window)
        #expect(textView.selectedRange() == NSRange(location: 300, length: 4))

        // Änderung hält den Vorschau-Tab fest; Schließen fragt nach, Abbrechen behält ihn
        await model.editor.open(project.url("drei.tex"))
        let drei = try #require(model.editor.current)
        drei.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "% ")
        #expect(model.editor.tabs.previewFileURL == nil)
        var asked: [String] = []
        model.promptForUnsavedChanges = { _, names in asked = names; return .cancel }
        model.closeTab(project.url("drei.tex"))
        #expect(asked == ["drei.tex"])
        #expect(model.editor.tabs.contains(project.url("drei.tex")))

        // Speichern und schließen: Datei auf der Platte enthält die Änderung, Nachbar wird angezeigt
        model.promptForUnsavedChanges = { _, _ in .save }
        model.closeTab(project.url("drei.tex"))
        try await settle(window)
        #expect(!model.editor.tabs.contains(project.url("drei.tex")))
        #expect(try String(contentsOf: project.url("drei.tex"), encoding: .utf8).hasPrefix("% "))
        #expect(textView.textStorage === model.editor.current?.textStorage)

        // Neu öffnen des Projekts stellt die Tabs wieder her
        let remembered = model.editor.tabs.fileURLs
        let active = model.editor.tabs.activeFileURL
        await model.openProject(project.root)
        #expect(model.editor.tabs.fileURLs == remembered)
        #expect(model.editor.tabs.activeFileURL == active)

        // ⌘W bis zum letzten Tab: leere Anzeige ohne Absturz, danach wieder öffnen
        while !model.editor.tabs.isEmpty { model.closeActiveTab() }
        try await settle(window)
        #expect(model.editor.current == nil)
        #expect(textView.textStorage?.length == 0)
        await model.editor.open(project.url("zwei.tex"))
        try await settle(window)
        #expect(model.editor.current?.url == project.url("zwei.tex"))
    }

    private func showWindow(for model: AppModel) async throws -> NSWindow {
        discardWindowsOfEarlierTests()
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.windowSize),
            styleMask: [.titled, .resizable],
            backing: .buffered,
            defer: false
        )
        window.contentView = NSHostingView(rootView: RootView(model: model))
        Self.openedWindows.append(window)
        try await settle(window)
        return window
    }

    private func settle(_ window: NSWindow) async throws {
        for _ in 0..<Self.layoutPasses {
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            try await Task.sleep(for: .milliseconds(60))
        }
    }
}
}
