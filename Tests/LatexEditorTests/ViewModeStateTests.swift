import AppKit
import PDFKit
import SwiftUI
import Testing
@testable import LatexEditor

/// Übergabe des PDF-Stands, falls eine PDFView doch neu entsteht (z. B. nach „Kein PDF vorhanden“). Beim Wechsel der
/// Ansicht entstehen Editor und PDF nicht mehr neu (`WorkspaceModeTests`).
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

        // Reihenfolge wie in SwiftUI (gemessen): neue View anlegen und laden, erst danach die alte abbauen
        let first = SyncTeXPDFView()
        let firstWindow = makeWindow(containing: first)
        let firstCoordinator = PDFCoordinator(store: store)
        firstCoordinator.attach(first)
        firstCoordinator.reloadIfNeeded(in: first, url: url, token: 0)
        first.autoScales = false
        first.scaleFactor = 0.8
        let target = try #require(first.document?.page(at: 5))
        first.go(to: PDFDestination(page: target, at: CGPoint(x: 0, y: 700)))

        let second = SyncTeXPDFView()
        let secondWindow = makeWindow(containing: second)
        let secondCoordinator = PDFCoordinator(store: store)
        secondCoordinator.attach(second)
        secondCoordinator.reloadIfNeeded(in: second, url: url, token: 1)
        firstCoordinator.saveStateIfCurrent(first)
        firstWindow.contentView = NSView()
        try await Task.sleep(for: .milliseconds(50))
        defer { secondWindow.contentView = NSView() }

        let document = try #require(second.document)
        #expect(second.currentPage.map { document.index(for: $0) } == 5)
        #expect(abs(second.scaleFactor - 0.8) < 0.01)
        #expect(store.savedViewState == nil, "Die abgebaute alte View überschreibt den übergebenen Stand nicht")
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
}

@MainActor
private final class SplitProbe {
    var made: [String] = []
    var dismantled: [String] = []
    var views: [String: NSView] = [:]
}

@MainActor @Observable
private final class ModeHolder {
    var mode = ViewMode.split
}

private struct ProbeView: NSViewRepresentable {
    let name: String
    let probe: SplitProbe

    func makeNSView(context: Context) -> NSView {
        probe.made.append(name)
        let view = NSView()
        probe.views[name] = view
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        nsView.isHidden = !context.environment.isWorkspacePaneShown
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: ()) {}
}

private struct ProbeSplit: View {
    let holder: ModeHolder
    let probe: SplitProbe

    var body: some View {
        WorkspaceSplit(mode: holder.mode, leadingMinWidth: 100, trailingMinWidth: 100) {
            ProbeView(name: "editor", probe: probe)
        } trailing: {
            ProbeView(name: "pdf", probe: probe)
        }
    }
}

@MainActor
@Suite("Ansichten bleiben beim Wechsel erhalten", .serialized)
struct WorkspaceModeTests {
    @Test("Nur Editor / Geteilt / Nur PDF: Editor und PDF entstehen nicht neu, die verborgene Seite ist unsichtbar")
    func viewsSurviveModeSwitches() async throws {
        let probe = SplitProbe()
        let holder = ModeHolder()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        let host = NSHostingView(rootView: ProbeSplit(holder: holder, probe: probe))
        window.contentView = host
        defer { window.contentView = NSView() }
        for mode in [ViewMode.split, .pdfOnly, .split, .editorOnly, .pdfOnly] {
            holder.mode = mode
            try await Task.sleep(for: .milliseconds(60))
            host.layoutSubtreeIfNeeded()
            let editor = try #require(probe.views["editor"])
            let pdf = try #require(probe.views["pdf"])
            let editorFrame = editor.convert(editor.bounds, to: host)
            let pdfFrame = pdf.convert(pdf.bounds, to: host)
            let width = host.bounds.width
            switch mode {
            case .split:
                #expect(!editor.isHidden && !pdf.isHidden)
                #expect(editorFrame.minX == 0 && pdfFrame.maxX == width)
            case .editorOnly:
                #expect(!editor.isHidden && pdf.isHidden)
                #expect(editorFrame.width == width)
            case .pdfOnly:
                #expect(editor.isHidden && !pdf.isHidden)
                #expect(pdfFrame.minX == 0 && pdfFrame.width == width)
            }
        }
        #expect(probe.made == ["editor", "pdf"], "Keine Ansicht entsteht neu")
    }
}
