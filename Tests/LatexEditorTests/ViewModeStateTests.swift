import AppKit
import PDFKit
import Testing
@testable import LatexEditor

/// Beim Wechsel zwischen „Nur Editor“, „Geteilt“ und „Nur PDF“ entstehen die Views neu; Position und Zoom müssen bleiben.
@MainActor
@Suite("Position beim Wechsel der Ansicht", .serialized)
struct ViewModeStateTests {
    private func makeWindow(containing view: NSView) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        view.frame = window.contentLayoutRect
        window.contentView = view
        return window
    }

    private func makePDF(pages: Int, in directory: URL) throws -> URL {
        let document = PDFDocument()
        for index in 0..<pages {
            let image = NSImage(size: NSSize(width: 612, height: 792), flipped: false) { rect in
                NSColor.white.setFill()
                rect.fill()
                return true
            }
            document.insert(try #require(PDFPage(image: image)), at: index)
        }
        let url = directory.appendingPathComponent("test.pdf")
        #expect(document.write(to: url))
        return url
    }

    @Test("PDF: Seite und Zoom bleiben, wenn die View neu entsteht")
    func pdfStateSurvivesNewView() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let url = try makePDF(pages: 8, in: project.root)
        let store = PDFPreviewStore()

        let first = SyncTeXPDFView()
        let firstWindow = makeWindow(containing: first)
        let firstCoordinator = PDFCoordinator(store: store)
        firstCoordinator.reloadIfNeeded(in: first, url: url, token: 0)
        first.autoScales = false
        first.scaleFactor = 0.8
        let target = try #require(first.document?.page(at: 5))
        first.go(to: PDFDestination(page: target, at: CGPoint(x: 0, y: 700)))
        firstCoordinator.saveState(of: first)
        firstWindow.contentView = NSView()

        let second = SyncTeXPDFView()
        let secondWindow = makeWindow(containing: second)
        PDFCoordinator(store: store).reloadIfNeeded(in: second, url: url, token: 1)
        try await Task.sleep(for: .milliseconds(50))
        defer { secondWindow.contentView = NSView() }

        let document = try #require(second.document)
        #expect(second.currentPage.map { document.index(for: $0) } == 5)
        #expect(abs(second.scaleFactor - 0.8) < 0.01)
        #expect(store.savedViewState == nil)
    }

    @Test("PDF: Ohne gemerkten Stand beginnt eine neue View wie bisher am Anfang")
    func freshViewStartsAtTop() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let url = try makePDF(pages: 3, in: project.root)
        let view = SyncTeXPDFView()
        let window = makeWindow(containing: view)
        defer { window.contentView = NSView() }
        PDFCoordinator(store: PDFPreviewStore()).reloadIfNeeded(in: view, url: url, token: 0)
        let document = try #require(view.document)
        #expect(view.currentPage.map { document.index(for: $0) } == 0)
    }

    @Test("Editor: Auswahl und Scrollposition bleiben, wenn die View neu entsteht")
    func editorStateSurvivesNewView() async throws {
        let text = LargeDocument.make(lineCount: 600)
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/ansicht.tex"), text: text)

        let firstCoordinator = EditorCoordinator()
        let firstScroll = firstCoordinator.makeScrollView()
        let firstWindow = makeWindow(containing: firstScroll)
        firstCoordinator.update(session: session, jump: nil, insert: nil)
        try await Task.sleep(for: .milliseconds(40))
        let textView = try #require(firstScroll.documentView as? LatexTextView)
        let target = NSRange(location: (text as NSString).length * 2 / 3, length: 0)
        textView.setSelectedRange(target)
        textView.scrollRangeToVisible(target)
        let offset = textView.visibleRect.minY
        #expect(offset > 1_000)

        EditorTextView.dismantleNSView(firstScroll, coordinator: firstCoordinator)
        firstWindow.contentView = NSView()

        let secondCoordinator = EditorCoordinator()
        let secondScroll = secondCoordinator.makeScrollView()
        let secondWindow = makeWindow(containing: secondScroll)
        defer { secondWindow.contentView = NSView() }
        secondCoordinator.update(session: session, jump: nil, insert: nil)
        try await Task.sleep(for: .milliseconds(80))
        let restored = try #require(secondScroll.documentView as? LatexTextView)

        #expect(restored.selectedRange() == target)
        #expect(abs(restored.visibleRect.minY - offset) < 1)
    }
}
