import CoreGraphics
import Foundation
import PDFKit

/// Mehrseitiges PDF mit einem internen Link (Seite 1 → Seite 3) und einem URL-Link auf Seite 1.
struct LinkFixture {
    static let pageCount = 3
    static let targetPageIndex = 2
    static let pageSize = CGSize(width: 612, height: 792)
    static let destinationName = "ziel.seite3"
    static let externalURL = URL(string: "https://example.com/")!
    static let internalLinkRect = CGRect(x: 72, y: 600, width: 200, height: 20)
    static let urlLinkRect = CGRect(x: 72, y: 500, width: 200, height: 20)
    static let targetPoint = CGPoint(x: 72, y: 700)

    let project: TemporaryProject
    let document: PDFDocument

    var internalLinkRect: CGRect { Self.internalLinkRect }
    var urlLinkRect: CGRect { Self.urlLinkRect }
    var firstPage: PDFPage { document.page(at: 0)! }

    init() throws {
        project = try TemporaryProject()
        let fileURL = project.url("links.pdf")
        try Self.writePDF(to: fileURL)
        guard let document = PDFDocument(url: fileURL) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.document = document
    }

    func remove() {
        project.remove()
    }

    private static func writePDF(to url: URL) throws {
        var box = CGRect(origin: .zero, size: pageSize)
        guard let context = CGContext(url as CFURL, mediaBox: &box, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        for pageIndex in 0..<pageCount {
            context.beginPDFPage(nil)
            if pageIndex == 0 { addLinks(to: context) }
            if pageIndex == targetPageIndex {
                context.addDestination(destinationName as CFString, at: targetPoint)
            }
            context.endPDFPage()
        }
        context.closePDF()
    }

    private static func addLinks(to context: CGContext) {
        context.setDestination(destinationName as CFString, for: internalLinkRect)
        context.setURL(externalURL as CFURL, for: urlLinkRect)
    }

    /// Einseitiges PDF (nur im Speicher) mit weißer Seite und schwarzem Quadrat, zum Prüfen der Pixel einer Vorschau
    static func documentWithBlackSquare(_ square: CGRect) throws -> PDFDocument {
        let data = NSMutableData()
        var box = CGRect(origin: .zero, size: pageSize)
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &box, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        context.beginPDFPage(nil)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(box)
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.fill(square)
        context.endPDFPage()
        context.closePDF()
        guard let document = PDFDocument(data: data as Data) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return document
    }
}
