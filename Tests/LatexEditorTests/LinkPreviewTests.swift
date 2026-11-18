import AppKit
import PDFKit
import Testing
@testable import LatexEditor

@Suite("Link-Vorschau")
struct LinkPreviewTests {
    private let page = CGRect(x: 0, y: 0, width: 612, height: 792)
    private let size = LinkPreviewRenderer.excerptSize
    private let above = LinkPreviewRenderer.excerptHeightAbovePoint

    @Test("Ausschnitt in der Seitenmitte hat feste Größe und wenig Platz über dem Punkt")
    func excerptKeepsSizeAndLittleSpaceAbove() {
        let point = CGPoint(x: 72, y: 400)
        let rect = LinkPreviewRenderer.excerptRect(for: point, pageBounds: page)
        #expect(rect.size == size)
        #expect(rect.maxY - point.y == above)
        #expect(rect.minY < point.y)
    }

    @Test("Ausschnitt wird an allen vier Rändern geklemmt")
    func excerptClampsToPage() {
        let top = LinkPreviewRenderer.excerptRect(for: CGPoint(x: 72, y: 792), pageBounds: page)
        let bottom = LinkPreviewRenderer.excerptRect(for: CGPoint(x: 72, y: 0), pageBounds: page)
        #expect(top.maxY == page.maxY && top.size == size)
        #expect(bottom.minY == page.minY && bottom.size == size)
        let narrow = CGRect(x: 0, y: 0, width: 300, height: 792)
        let rect = LinkPreviewRenderer.excerptRect(for: CGPoint(x: 10, y: 400), pageBounds: narrow)
        #expect(rect.minX == narrow.minX && rect.maxX == narrow.maxX)
        let shifted = CGRect(x: 50, y: 50, width: 612, height: 792)
        let inside = LinkPreviewRenderer.excerptRect(for: CGPoint(x: 0, y: 0), pageBounds: shifted)
        #expect(shifted.contains(inside))
    }

    @Test("Ausschnitt bleibt bei zu kleiner Seite auf die Seite begrenzt")
    func excerptOnTinyPage() {
        let tiny = CGRect(x: 0, y: 0, width: 200, height: 100)
        let rect = LinkPreviewRenderer.excerptRect(for: CGPoint(x: 50, y: 50), pageBounds: tiny)
        #expect(rect == tiny)
    }

    @Test("Vorschau des Linkziels liefert Seite 3 und die Ausschnittgröße")
    func previewOfInternalLink() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let link = try #require(PDFLinks.link(at: CGPoint(x: fixture.internalLinkRect.midX, y: fixture.internalLinkRect.midY), on: fixture.firstPage))
        let target = try #require(PDFLinks.internalTarget(of: link))
        let preview = try #require(LinkPreviewRenderer.preview(for: target, backingScale: 2))
        #expect(preview.pageNumber == LinkFixture.targetPageIndex + 1)
        #expect(preview.image.size == LinkPreviewRenderer.excerptSize)
    }

    @Test("Unspezifischer Zielpunkt führt nicht zum Absturz")
    func unspecifiedPointDoesNotCrash() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = try #require(fixture.document.page(at: 1))
        let unspecified = CGPoint(x: kPDFDestinationUnspecifiedValue, y: kPDFDestinationUnspecifiedValue)
        let preview = try #require(LinkPreviewRenderer.preview(for: PDFDestination(page: page, at: unspecified), backingScale: 1))
        #expect(preview.pageNumber == 2)
        #expect(preview.image.size == LinkPreviewRenderer.excerptSize)
    }

    // MARK: Gedrehte Seite und verschobene cropBox (Pixelprüfung)

    private static let squareSide: CGFloat = 40
    private static let quarterTurn = 90
    /// Helligkeit, unter der ein Pixel als „schwarz“ bzw. über der es als „weiß“ gilt
    private static let darkLimit: CGFloat = 0.2
    private static let lightLimit: CGFloat = 0.8

    /// Helligkeit am Bildpunkt; `fromTop` zählt wie in Bildern von oben (Vorschau mit Skalierung 1: Punkt = Pixel)
    private func brightness(of image: NSImage, x: Int, fromTop y: Int) throws -> CGFloat {
        let cgImage = try #require(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        let color = try #require(NSBitmapImageRep(cgImage: cgImage).colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
        return color.brightnessComponent
    }

    @Test("Gedrehte Seite: Der Ausschnitt zeigt das Ziel an der richtigen Stelle")
    func rotatedPageShowsTarget() throws {
        let center = CGPoint(x: LinkFixture.pageSize.width / 2, y: LinkFixture.pageSize.height / 2)
        let side = Self.squareSide
        let square = CGRect(x: center.x - side / 2, y: center.y - side / 2, width: side, height: side)
        let document = try LinkFixture.documentWithBlackSquare(square)
        let page = try #require(document.page(at: 0))
        page.rotation = Self.quarterTurn
        let preview = try #require(LinkPreviewRenderer.preview(for: PDFDestination(page: page, at: center), backingScale: 1))
        // Seitenmitte bleibt in jeder Drehrichtung Seitenmitte: waagerecht in der Bildmitte, knapp unter dem oberen Rand
        #expect(preview.image.size == size)
        let middle = Int(size.width / 2)
        #expect(try brightness(of: preview.image, x: middle, fromTop: Int(above)) < Self.darkLimit)
        #expect(try brightness(of: preview.image, x: 0, fromTop: Int(size.height) - 1) > Self.lightLimit)
    }

    @Test("cropBox mit Ursprung ungleich 0: Der Ausschnitt ist nicht verschoben")
    func shiftedCropBoxShowsTarget() throws {
        let cropBox = CGRect(x: 100, y: 100, width: 412, height: 592)
        let square = CGRect(x: 290, y: 560, width: Self.squareSide, height: Self.squareSide)
        let document = try LinkFixture.documentWithBlackSquare(square)
        let page = try #require(document.page(at: 0))
        page.setBounds(cropBox, for: .cropBox)
        let target = CGPoint(x: cropBox.minX, y: square.maxY)
        let preview = try #require(LinkPreviewRenderer.preview(for: PDFDestination(page: page, at: target), backingScale: 1))
        #expect(preview.image.size == CGSize(width: cropBox.width, height: size.height))
        // Waagerecht: Abstand des Quadrats zum linken Rand der cropBox; senkrecht: Ziel `above` unter dem oberen Rand
        let squareMiddleX = Int(square.midX - cropBox.minX)
        let squareMiddleFromTop = Int(above + Self.squareSide / 2)
        #expect(try brightness(of: preview.image, x: squareMiddleX, fromTop: squareMiddleFromTop) < Self.darkLimit)
        #expect(try brightness(of: preview.image, x: 0, fromTop: Int(size.height) - 1) > Self.lightLimit)
    }
}
