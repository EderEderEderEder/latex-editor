import AppKit
import PDFKit
import Testing
@testable import LatexEditor

@Suite("Link-Vorschau: Größe, Zoom und Startstelle")
struct LinkPreviewTests {
    private let above = LinkPreviewLayout.excerptHeightAbovePoint
    private static let quarterTurn = 90
    private static let tolerance: CGFloat = 0.001

    @Test("Größe: PDF-Breite minus Rand und halbe Höhe der PDF-Ansicht")
    func viewportFollowsMainView() {
        let size = LinkPreviewLayout.viewportSize(forMainViewSize: CGSize(width: 700, height: 900))
        #expect(size == CGSize(width: 700 - LinkPreviewLayout.widthMargin, height: 450))
    }

    @Test("Größe wird bei kleiner und großer PDF-Ansicht geklemmt")
    func viewportIsClamped() {
        let small = LinkPreviewLayout.viewportSize(forMainViewSize: CGSize(width: 200, height: 300))
        let large = LinkPreviewLayout.viewportSize(forMainViewSize: CGSize(width: 3000, height: 2000))
        #expect(small == CGSize(width: LinkPreviewLayout.widthRange.lowerBound, height: LinkPreviewLayout.heightRange.lowerBound))
        #expect(large == CGSize(width: LinkPreviewLayout.widthRange.upperBound, height: LinkPreviewLayout.heightRange.upperBound))
        #expect(LinkPreviewLayout.viewportSize(forMainViewSize: .zero) == small)
    }

    @Test("Zoom der Hauptansicht, geklemmt")
    func scaleIsClamped() {
        #expect(LinkPreviewLayout.scale(forMainScale: 1.25) == 1.25)
        #expect(LinkPreviewLayout.scale(forMainScale: 0.3) == LinkPreviewLayout.scaleRange.lowerBound)
        #expect(LinkPreviewLayout.scale(forMainScale: 5) == LinkPreviewLayout.scaleRange.upperBound)
    }

    @Test("Startstelle: linker Seitenrand, wenig Luft über dem Ziel")
    func startLeavesLittleSpaceAbove() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = try #require(fixture.document.page(at: LinkFixture.targetPageIndex))
        let start = try #require(LinkPreviewLayout.startDestination(for: PDFDestination(page: page, at: LinkFixture.targetPoint)))
        #expect(start.page === page)
        #expect(start.point == CGPoint(x: 0, y: LinkFixture.targetPoint.y + above))
    }

    @Test("Startstelle: Ziel am oberen Rand und unspezifische Koordinaten ergeben den Seitenanfang")
    func startAtTopForUnspecifiedPoint() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = try #require(fixture.document.page(at: 1))
        let top = CGPoint(x: 0, y: LinkFixture.pageSize.height)
        let unspecified = CGPoint(x: kPDFDestinationUnspecifiedValue, y: kPDFDestinationUnspecifiedValue)
        let nearTop = CGPoint(x: 300, y: LinkFixture.pageSize.height - 5)
        for point in [unspecified, nearTop, CGPoint(x: CGFloat.nan, y: CGFloat.infinity)] {
            let start = try #require(LinkPreviewLayout.startDestination(for: PDFDestination(page: page, at: point)))
            #expect(start.point == top, "Zielpunkt \(point)")
        }
    }

    @Test("Gedrehte Seite: Startstelle liegt in der Anzeige links und wenig über dem Ziel")
    func startOnRotatedPage() throws {
        let document = try LinkFixture.documentWithBlackSquare(.zero)
        let page = try #require(document.page(at: 0))
        page.rotation = Self.quarterTurn
        let center = CGPoint(x: LinkFixture.pageSize.width / 2, y: LinkFixture.pageSize.height / 2)
        let start = try #require(LinkPreviewLayout.startDestination(for: PDFDestination(page: page, at: center)))
        let toDisplay = page.transform(for: .cropBox)
        let displayStart = start.point.applying(toDisplay)
        let displayBounds = page.bounds(for: .cropBox).applying(toDisplay)
        // Gedreht: Anzeige 792 × 612; die Seitenmitte bleibt Mitte der Anzeige
        #expect(abs(displayBounds.height - LinkFixture.pageSize.width) < Self.tolerance)
        #expect(abs(displayStart.x - displayBounds.minX) < Self.tolerance)
        #expect(abs(displayStart.y - (displayBounds.midY + above)) < Self.tolerance)
    }
}

extension AppModelSuite {
/// Eingebettete PDF-Ansicht der Vorschau im Offscreen-Fenster (unter `AppModelSuite`: echte Fenster laufen seriell)
@MainActor
@Suite("Link-Vorschau: eingebettete PDF-Ansicht", .serialized)
struct LinkPreviewViewTests {
    private static let viewportSize = CGSize(width: 600, height: 400)
    private static let quarterTurn = 90
    /// Abweichung der gezeigten Stelle vom Startpunkt (Rundung beim Scrollen)
    private static let pointTolerance: CGFloat = 2
    private static let scaleTolerance: CGFloat = 0.0001
    private static let mainViewSize = CGSize(width: 700, height: 900)

    /// Wie im Popover: Ansicht fertig einrichten, dann ins Fenster setzen und erneut ans Ziel
    private func showPreview(of destination: PDFDestination, scale: CGFloat = 1) throws -> (window: NSWindow, view: PDFView, start: PDFDestination) {
        let start = try #require(LinkPreviewLayout.startDestination(for: destination))
        let view = try #require(LinkPreviewPDFView.make(showing: start, size: Self.viewportSize, scale: scale))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.viewportSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        LinkPreviewPDFView.moveToStart(view, start)
        return (window, view, start)
    }

    private func close(_ window: NSWindow, _ view: PDFView) {
        view.document = nil
        window.contentView = NSView()
    }

    @Test("Vorschau zeigt die Zielseite des Links, Startstelle oben, ganzes Dokument im Zugriff")
    func showsTargetPage() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let link = try #require(PDFLinks.link(at: CGPoint(x: fixture.internalLinkRect.midX, y: fixture.internalLinkRect.midY), on: fixture.firstPage))
        let target = try #require(PDFLinks.internalTarget(of: link))
        let (window, view, start) = try showPreview(of: target)
        defer { close(window, view) }
        #expect(view.document === fixture.document)
        #expect(view.displayMode == .singlePageContinuous)
        #expect(!view.autoScales)
        let shown = try #require(view.currentDestination)
        #expect(shown.page === fixture.document.page(at: LinkFixture.targetPageIndex))
        #expect(abs(shown.point.y - start.point.y) < Self.pointTolerance)
    }

    @Test("Zoom kommt aus der Hauptansicht")
    func usesGivenScale() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = try #require(fixture.document.page(at: 1))
        let scale: CGFloat = 1.5
        let (window, view, _) = try showPreview(of: PDFDestination(page: page, at: LinkFixture.targetPoint), scale: scale)
        defer { close(window, view) }
        #expect(abs(view.scaleFactor - scale) < Self.scaleTolerance)
        #expect(view.currentPage === page)
    }

    @Test("Scrollbalken ist immer sichtbar (Legacy-Stil)")
    func showsLegacyScroller() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = try #require(fixture.document.page(at: 0))
        let (window, view, _) = try showPreview(of: PDFDestination(page: page, at: .zero))
        defer { close(window, view) }
        let scrollView = try #require(LinkPreviewPDFView.enclosedScrollView(in: view))
        #expect(scrollView.scrollerStyle == .legacy)
        #expect(scrollView.hasVerticalScroller)
        #expect(!scrollView.autohidesScrollers)
    }

    @Test("Dokument mit nur einer, gedrehten Seite: Vorschau zeigt sie ohne Absturz")
    func singleRotatedPage() throws {
        let document = try LinkFixture.documentWithBlackSquare(.zero)
        let page = try #require(document.page(at: 0))
        page.rotation = Self.quarterTurn
        let unspecified = CGPoint(x: kPDFDestinationUnspecifiedValue, y: kPDFDestinationUnspecifiedValue)
        let (window, view, _) = try showPreview(of: PDFDestination(page: page, at: unspecified))
        defer { close(window, view) }
        #expect(view.currentPage === page)
    }

    @Test("Schließen gibt das geteilte Dokument frei; Hauptansicht und Verlauf bleiben unverändert")
    func presenterLeavesMainViewAlone() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let mainView = PDFView(frame: NSRect(origin: .zero, size: Self.mainViewSize))
        let window = NSWindow(contentRect: mainView.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = mainView
        defer { window.contentView = NSView() }
        mainView.document = fixture.document
        mainView.layoutDocumentView()
        let store = PDFPreviewStore()
        store.pdfView = mainView
        let before = mainView.captureViewState()
        let target = try #require(fixture.document.page(at: LinkFixture.targetPageIndex))
        let presenter = LinkPreviewPresenter()
        presenter.show(PDFDestination(page: target, at: LinkFixture.targetPoint), from: mainView, relativeTo: fixture.internalLinkRect)
        presenter.close()
        #expect(!presenter.isShown)
        #expect(mainView.captureViewState() == before)
        #expect(mainView.document === fixture.document)
        #expect(!store.canGoBack)
    }
}
}
