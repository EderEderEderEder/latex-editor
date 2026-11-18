import AppKit
import PDFKit

/// Rendert einen Seitenausschnitt rund um das Ziel eines internen PDF-Links als Bild.
enum LinkPreviewRenderer {
    struct LinkPreview {
        let image: NSImage
        /// 1-basiert, für die Anzeige.
        let pageNumber: Int
    }

    static let excerptSize = CGSize(width: 440, height: 260)
    /// Ziele liegen knapp über der Zeile bzw. unter der Abbildung; nach oben braucht es wenig Platz.
    static let excerptHeightAbovePoint: CGFloat = 30

    /// Ausschnitt in Anzeigekoordinaten der Seite (y nach oben), auf die Seite geklemmt, Größe bleibt erhalten.
    static func excerptRect(for point: CGPoint, pageBounds: CGRect) -> CGRect {
        let width = min(excerptSize.width, pageBounds.width)
        let height = min(excerptSize.height, pageBounds.height)
        let belowPoint = excerptSize.height - excerptHeightAbovePoint
        let originX = pageBounds.midX - width / 2
        let originY = min(max(point.y - belowPoint, pageBounds.minY), pageBounds.maxY - height)
        return CGRect(x: originX, y: originY, width: width, height: height)
    }

    /// `draw(with: .cropBox)` verschiebt um den Ursprung der cropBox und dreht nach `rotation`; deshalb werden Seite und
    /// Zielpunkt mit derselben Transformation in Anzeigekoordinaten umgerechnet, bevor der Ausschnitt entsteht.
    static func preview(for destination: PDFDestination, backingScale: CGFloat) -> LinkPreview? {
        guard let page = destination.page, let document = page.document else { return nil }
        let pageBounds = page.bounds(for: .cropBox)
        let toDisplay = page.transform(for: .cropBox)
        let displayBounds = pageBounds.applying(toDisplay)
        let displayPoint = targetPoint(of: destination, pageBounds: pageBounds).applying(toDisplay)
        let rect = excerptRect(for: displayPoint, pageBounds: displayBounds)
        guard let image = render(page, excerpt: rect, scale: max(backingScale, 1)) else { return nil }
        return LinkPreview(image: image, pageNumber: document.index(for: page) + 1)
    }

    /// In Seitenkoordinaten; unspezifische oder nicht endliche Koordinaten bedeuten: linker bzw. oberer Seitenrand.
    private static func targetPoint(of destination: PDFDestination, pageBounds: CGRect) -> CGPoint {
        let point = destination.point
        return CGPoint(
            x: isSpecified(point.x) ? point.x : pageBounds.minX,
            y: isSpecified(point.y) ? point.y : pageBounds.maxY
        )
    }

    private static func isSpecified(_ coordinate: CGFloat) -> Bool {
        coordinate.isFinite && coordinate != kPDFDestinationUnspecifiedValue
    }

    private static func render(_ page: PDFPage, excerpt: CGRect, scale: CGFloat) -> NSImage? {
        let pixelWidth = Int((excerpt.width * scale).rounded(.up))
        let pixelHeight = Int((excerpt.height * scale).rounded(.up))
        guard let context = CGContext(
            data: nil, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
        context.scaleBy(x: CGFloat(pixelWidth) / excerpt.width, y: CGFloat(pixelHeight) / excerpt.height)
        context.translateBy(x: -excerpt.minX, y: -excerpt.minY)
        context.clip(to: excerpt)
        page.draw(with: .cropBox, to: context)
        guard let cgImage = context.makeImage() else { return nil }
        return NSImage(cgImage: cgImage, size: excerpt.size)
    }
}
