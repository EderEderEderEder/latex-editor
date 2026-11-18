import PDFKit
import Testing
@testable import LatexEditor

@Suite("PDF-Links")
struct PDFLinkTests {
    private func center(of rect: CGRect) -> CGPoint {
        CGPoint(x: rect.midX, y: rect.midY)
    }

    @Test("Interner Link wird gefunden und zeigt auf Seite 3")
    func internalLinkTargetsThirdPage() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let link = try #require(PDFLinks.link(at: center(of: fixture.internalLinkRect), on: fixture.firstPage))
        let target = try #require(PDFLinks.internalTarget(of: link))
        let targetPage = try #require(target.page)
        #expect(fixture.document.index(for: targetPage) == LinkFixture.targetPageIndex)
        #expect(!PDFLinks.isExternal(link))
    }

    @Test("URL-Link ist extern und hat kein internes Ziel")
    func urlLinkIsExternal() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let link = try #require(PDFLinks.link(at: center(of: fixture.urlLinkRect), on: fixture.firstPage))
        #expect(PDFLinks.isExternal(link))
        #expect(PDFLinks.internalTarget(of: link) == nil)
    }

    @Test("Punkt außerhalb aller Links liefert nil")
    func pointOutsideReturnsNil() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        #expect(PDFLinks.link(at: CGPoint(x: 400, y: 100), on: fixture.firstPage) == nil)
    }

    @Test("Link wird trotz darüberliegender Markierung gefunden")
    func linkFoundBelowHighlight() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = fixture.firstPage
        page.addAnnotation(PDFAnnotation(bounds: fixture.internalLinkRect, forType: .highlight, withProperties: nil))
        let link = try #require(PDFLinks.link(at: center(of: fixture.internalLinkRect), on: page))
        #expect(PDFLinks.internalTarget(of: link) != nil)
    }

    /// Freie Stelle auf Seite 1 für zusätzliche Links (unter den Links der Fixture)
    private static let extraLinkRect = CGRect(x: 72, y: 300, width: 200, height: 20)

    private func addLink(to page: PDFPage, action: PDFAction) -> PDFAnnotation {
        let link = PDFAnnotation(bounds: Self.extraLinkRect, forType: .link, withProperties: nil)
        link.action = action
        page.addAnnotation(link)
        return link
    }

    @Test("Ziel über eine GoTo-Aktion statt /Dest wird gefunden")
    func goToActionTarget() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let targetPage = try #require(fixture.document.page(at: LinkFixture.targetPageIndex))
        let action = PDFActionGoTo(destination: PDFDestination(page: targetPage, at: LinkFixture.targetPoint))
        _ = addLink(to: fixture.firstPage, action: action)
        let link = try #require(PDFLinks.link(at: center(of: Self.extraLinkRect), on: fixture.firstPage))
        let target = try #require(PDFLinks.internalTarget(of: link))
        #expect(target.page === targetPage)
    }

    @Test("Ziel ohne Seite zählt nicht als interner Link")
    func targetWithoutPageIsIgnored() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        // `PDFDestination.page` ist schwach: Mit der freigegebenen Seite bleibt ein Ziel ohne Seite übrig
        let destination = autoreleasepool { PDFDestination(page: PDFPage(), at: LinkFixture.targetPoint) }
        try #require(destination.page == nil, "Vorbedingung: Die Seite des Ziels ist freigegeben")
        let link = addLink(to: fixture.firstPage, action: PDFActionGoTo(destination: destination))
        #expect(PDFLinks.internalTarget(of: link) == nil)
    }
}
