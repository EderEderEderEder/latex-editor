import AppKit
import PDFKit
import Testing
@testable import LatexEditor

@Suite("Link-Vorschau")
struct LinkPreviewTests {
    private let above = LinkPreviewRenderer.excerptHeightAbovePoint
    private let viewportMax = LinkPreviewRenderer.maximumViewportHeight

    @Test("Startversatz lässt wenig Platz über dem Ziel")
    func offsetKeepsLittleSpaceAbove() {
        let offset = LinkPreviewRenderer.initialScrollOffset(targetFromTop: 400, imageHeight: 900, viewportHeight: viewportMax)
        #expect(400 - offset == above)
    }

    @Test("Startversatz wird oben und unten geklemmt")
    func offsetIsClamped() {
        let top = LinkPreviewRenderer.initialScrollOffset(targetFromTop: 5, imageHeight: 900, viewportHeight: viewportMax)
        let bottom = LinkPreviewRenderer.initialScrollOffset(targetFromTop: 890, imageHeight: 900, viewportHeight: viewportMax)
        #expect(top == 0)
        #expect(bottom == 900 - viewportMax)
    }

    @Test("Seite kleiner als die Bildlaufansicht: kein Versatz")
    func offsetOnSmallPage() {
        let offset = LinkPreviewRenderer.initialScrollOffset(targetFromTop: 150, imageHeight: 200, viewportHeight: 200)
        #expect(offset == 0)
    }

    @Test("Vorschau des Linkziels zeigt die ganze Seite 3, auf die Breite angepasst, und scrollt zum Ziel")
    func previewOfInternalLink() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let link = try #require(PDFLinks.link(at: CGPoint(x: fixture.internalLinkRect.midX, y: fixture.internalLinkRect.midY), on: fixture.firstPage))
        let target = try #require(PDFLinks.internalTarget(of: link))
        let preview = try #require(LinkPreviewRenderer.preview(for: target, backingScale: 2))
        let fit = LinkPreviewRenderer.imageWidth / LinkFixture.pageSize.width
        #expect(preview.pageNumber == LinkFixture.targetPageIndex + 1)
        #expect(preview.image.size.width == LinkPreviewRenderer.imageWidth)
        #expect(abs(preview.image.size.height - LinkFixture.pageSize.height * fit) < 0.001)
        #expect(preview.viewportHeight == viewportMax)
        let targetFromTop = (LinkFixture.pageSize.height - LinkFixture.targetPoint.y) * fit
        #expect(abs(preview.initialScrollOffset - (targetFromTop - above)) < 0.001)
    }

    @Test("Bildgröße in Pixeln bleibt begrenzt, auch bei hoher Skalierung und sehr langer Seite")
    func pixelSizeIsLimited() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = try #require(fixture.document.page(at: 1))
        let preview = try #require(LinkPreviewRenderer.preview(for: PDFDestination(page: page, at: .zero), backingScale: 100))
        let cgImage = try #require(preview.image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        #expect(CGFloat(max(cgImage.width, cgImage.height)) <= LinkPreviewRenderer.maximumPixelLength + 1)
    }

    @Test("Unspezifischer Zielpunkt führt nicht zum Absturz")
    func unspecifiedPointDoesNotCrash() throws {
        let fixture = try LinkFixture()
        defer { fixture.remove() }
        let page = try #require(fixture.document.page(at: 1))
        let unspecified = CGPoint(x: kPDFDestinationUnspecifiedValue, y: kPDFDestinationUnspecifiedValue)
        let preview = try #require(LinkPreviewRenderer.preview(for: PDFDestination(page: page, at: unspecified), backingScale: 1))
        #expect(preview.pageNumber == 2)
        let fit = LinkPreviewRenderer.imageWidth / LinkFixture.pageSize.width
        #expect(abs(preview.image.size.height - LinkFixture.pageSize.height * fit) < 0.001)
        #expect(preview.initialScrollOffset == 0)
    }

    // MARK: Gedrehte Seite und verschobene cropBox (Pixelprüfung)

    private static let squareSide: CGFloat = 40
    private static let quarterTurn = 90
    /// Helligkeit, unter der ein Pixel als „schwarz“ bzw. über der es als „weiß“ gilt
    private static let darkLimit: CGFloat = 0.2
    private static let lightLimit: CGFloat = 0.8

    /// Helligkeit am Bildpunkt; `fromTop` zählt wie in Bildern von oben (Vorschau mit Skalierung 1 und Breite der Seite: Punkt = Pixel)
    private func brightness(of image: NSImage, x: Int, fromTop y: Int) throws -> CGFloat {
        let cgImage = try #require(image.cgImage(forProposedRect: nil, context: nil, hints: nil))
        let color = try #require(NSBitmapImageRep(cgImage: cgImage).colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
        return color.brightnessComponent
    }

    @Test("Gedrehte Seite: Die Vorschau zeigt das Ziel an der richtigen Stelle")
    func rotatedPageShowsTarget() throws {
        let center = CGPoint(x: LinkFixture.pageSize.width / 2, y: LinkFixture.pageSize.height / 2)
        let side = Self.squareSide
        let square = CGRect(x: center.x - side / 2, y: center.y - side / 2, width: side, height: side)
        let document = try LinkFixture.documentWithBlackSquare(square)
        let page = try #require(document.page(at: 0))
        page.rotation = Self.quarterTurn
        let width = LinkFixture.pageSize.height
        let preview = try #require(LinkPreviewRenderer.preview(for: PDFDestination(page: page, at: center), backingScale: 1, imageWidth: width))
        // Gedreht: Anzeige 792 × 612; Seitenmitte bleibt in jeder Drehrichtung Seitenmitte
        let height = LinkFixture.pageSize.width
        #expect(preview.image.size == CGSize(width: width, height: height))
        #expect(try brightness(of: preview.image, x: Int(width / 2), fromTop: Int(height / 2)) < Self.darkLimit)
        #expect(try brightness(of: preview.image, x: 0, fromTop: Int(height) - 1) > Self.lightLimit)
        #expect(preview.initialScrollOffset == height - viewportMax)
    }

    @Test("cropBox mit Ursprung ungleich 0: Die Vorschau ist nicht verschoben")
    func shiftedCropBoxShowsTarget() throws {
        let cropBox = CGRect(x: 100, y: 100, width: 412, height: 592)
        let square = CGRect(x: 290, y: 560, width: Self.squareSide, height: Self.squareSide)
        let document = try LinkFixture.documentWithBlackSquare(square)
        let page = try #require(document.page(at: 0))
        page.setBounds(cropBox, for: .cropBox)
        let target = CGPoint(x: cropBox.minX, y: square.maxY)
        let preview = try #require(LinkPreviewRenderer.preview(for: PDFDestination(page: page, at: target), backingScale: 1, imageWidth: cropBox.width))
        #expect(preview.image.size == cropBox.size)
        // Abstand des Quadrats zum linken und oberen Rand der cropBox
        let squareMiddleX = Int(square.midX - cropBox.minX)
        let squareMiddleFromTop = Int(cropBox.maxY - square.midY)
        #expect(try brightness(of: preview.image, x: squareMiddleX, fromTop: squareMiddleFromTop) < Self.darkLimit)
        #expect(try brightness(of: preview.image, x: 0, fromTop: Int(cropBox.height) - 1) > Self.lightLimit)
        #expect(preview.initialScrollOffset == cropBox.maxY - square.maxY - above)
    }
}
