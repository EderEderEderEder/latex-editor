import AppKit
import PDFKit
import Testing
@testable import LatexEditor

extension AppModelSuite {
/// Verlauf der Sprünge über interne Links: Filter der `PDFViewAnnotationWillHit`-Meldung und Verlauf im Store.
/// Unter `AppModelSuite`, weil die Tests echte (Offscreen-)Fenster brauchen.
@MainActor
@Suite("PDF-Links: Verlauf in View und Store", .serialized)
struct PDFLinkInteractionTests {
    /// Schlüssel der Annotation in `userInfo` der Meldung (laut PDFKit-Dokumentation)
    private static let annotationKey = "PDFAnnotationHit"
    private static let windowSize = NSSize(width: 600, height: 800)
    private static let pollAttempts = 100
    private static let pollInterval: Duration = .milliseconds(10)

    private func makeWindow(showing document: PDFDocument) -> (window: NSWindow, view: PDFView) {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.windowSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let view = PDFView(frame: window.contentLayoutRect)
        window.contentView = view
        view.document = document
        view.layoutDocumentView()
        return (window, view)
    }

    private func postWillHit(for annotation: PDFAnnotation?, from view: PDFView) {
        let userInfo: [AnyHashable: Any]? = annotation.map { [Self.annotationKey: $0] }
        NotificationCenter.default.post(name: .PDFViewAnnotationWillHit, object: view, userInfo: userInfo)
    }

    private func link(in fixture: LinkFixture, at rect: CGRect) throws -> PDFAnnotation {
        try #require(PDFLinks.link(at: CGPoint(x: rect.midX, y: rect.midY), on: fixture.firstPage))
    }

    @Test("WillHit: Nur ein interner Link erzeugt einen Verlaufseintrag, URL-Link und Meldung ohne Link nicht")
    func willHitRecordsOnlyInternalLinks() async throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let (window, view) = makeWindow(showing: fixture.document)
        defer { window.contentView = NSView() }
        let store = PDFPreviewStore()
        let interaction = PDFLinkInteraction(store: store)
        interaction.observe(view)
        let urlLink = try link(in: fixture, at: fixture.urlLinkRect)
        let internalLink = try link(in: fixture, at: fixture.internalLinkRect)

        postWillHit(for: urlLink, from: view)
        postWillHit(for: nil, from: view)
        try await Task.sleep(for: Self.pollInterval)
        #expect(!store.canGoBack, "URL-Link und Meldung ohne Annotation zählen nicht")

        postWillHit(for: internalLink, from: view)
        for _ in 0..<Self.pollAttempts where !store.canGoBack { try await Task.sleep(for: Self.pollInterval) }
        #expect(store.jumpHistory.backStack.count == 1)
        #expect(store.backTargetPage == 1)
        // Der Beobachter meldet sich im `deinit` ab: bis hier am Leben halten
        withExtendedLifetime(interaction) {}
    }

    @Test("Store: Zurück und Vorwärts erzeugen keinen neuen Eintrag")
    func backAndForwardDoNotAddEntries() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let (window, view) = makeWindow(showing: fixture.document)
        defer { window.contentView = NSView() }
        let store = PDFPreviewStore()
        store.pdfView = view
        let origin = try #require(view.captureViewState())
        store.recordJumpOrigin(origin)
        let target = try #require(fixture.document.page(at: LinkFixture.targetPageIndex))
        view.go(to: PDFDestination(page: target, at: LinkFixture.targetPoint))

        store.goBack()
        #expect(store.jumpHistory.backStack.isEmpty)
        #expect(store.jumpHistory.forwardStack.count == 1)
        store.goForward()
        #expect(store.jumpHistory.backStack.count == 1)
        #expect(store.jumpHistory.forwardStack.isEmpty)
    }

    @Test("Store: Neue Hauptdatei leert den Verlauf")
    func setMainFileClearsHistory() {
        let store = PDFPreviewStore()
        store.recordJumpOrigin(PDFViewState(pageIndex: 1, point: .zero, scale: 1, autoScales: true))
        #expect(store.canGoBack)
        store.setMainFile(nil)
        #expect(!store.canGoBack)
        #expect(!store.canGoForward)
    }
}
}
