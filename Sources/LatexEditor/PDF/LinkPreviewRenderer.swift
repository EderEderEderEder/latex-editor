import AppKit
import PDFKit

/// Rendert die ganze Zielseite eines internen PDF-Links als Bild und bestimmt, wohin die Bildlaufansicht beim Öffnen scrollt.
enum LinkPreviewRenderer {
    struct LinkPreview {
        /// Ganze Seite, Breite = `imageWidth` (Punkte), Höhe nach Seitenverhältnis
        let image: NSImage
        /// 1-basiert, für die Anzeige.
        let pageNumber: Int
        /// Abstand der sichtbaren Oberkante zur Bildoberkante in Punkten, so dass das Linkziel zu sehen ist
        let initialScrollOffset: CGFloat

        /// Höhe der Bildlaufansicht: nicht höher als nötig
        var viewportHeight: CGFloat { min(image.size.height, LinkPreviewRenderer.maximumViewportHeight) }
    }

    /// Breite der Seite in der Vorschau; das Popover ist mit Rand und Bildlaufleiste ca. 560 pt breit
    static let imageWidth: CGFloat = 525
    /// Breite der sichtbaren Bildlaufleiste (Legacy-Stil), die neben dem Bild steht
    static let scrollerWidth: CGFloat = 15
    /// Höhe der Bildlaufansicht; mit Rand und Unterzeile ist das Popover ca. 440 pt hoch
    static let maximumViewportHeight: CGFloat = 400
    /// Ziele liegen knapp über der Zeile bzw. unter der Abbildung; nach oben braucht es wenig Platz.
    static let excerptHeightAbovePoint: CGFloat = 30
    /// Obergrenze für Breite und Höhe des gerenderten Bildes in Pixeln (begrenzt den Speicher bei langen Seiten)
    static let maximumPixelLength: CGFloat = 4096

    /// Startversatz der Bildlaufansicht von oben, auf den scrollbaren Bereich geklemmt
    static func initialScrollOffset(targetFromTop: CGFloat, imageHeight: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        let maximumOffset = max(imageHeight - viewportHeight, 0)
        return min(max(targetFromTop - excerptHeightAbovePoint, 0), maximumOffset)
    }

    /// `draw(with: .cropBox)` verschiebt um den Ursprung der cropBox und dreht nach `rotation`; deshalb werden Seite und
    /// Zielpunkt mit derselben Transformation in Anzeigekoordinaten umgerechnet.
    static func preview(
        for destination: PDFDestination, backingScale: CGFloat, imageWidth: CGFloat = LinkPreviewRenderer.imageWidth
    ) -> LinkPreview? {
        guard let page = destination.page, let document = page.document else { return nil }
        let pageBounds = page.bounds(for: .cropBox)
        let toDisplay = page.transform(for: .cropBox)
        let displayBounds = pageBounds.applying(toDisplay)
        guard displayBounds.width > 0, displayBounds.height > 0 else { return nil }
        let displayPoint = targetPoint(of: destination, pageBounds: pageBounds).applying(toDisplay)
        let fit = imageWidth / displayBounds.width
        let imageSize = CGSize(width: imageWidth, height: displayBounds.height * fit)
        let pixelScale = min(max(backingScale, 1), maximumPixelLength / max(imageSize.width, imageSize.height))
        guard let image = render(page, bounds: displayBounds, imageSize: imageSize, pixelScale: pixelScale) else { return nil }
        let offset = initialScrollOffset(
            targetFromTop: (displayBounds.maxY - displayPoint.y) * fit,
            imageHeight: imageSize.height,
            viewportHeight: min(imageSize.height, maximumViewportHeight)
        )
        return LinkPreview(image: image, pageNumber: document.index(for: page) + 1, initialScrollOffset: offset)
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

    private static func render(_ page: PDFPage, bounds: CGRect, imageSize: CGSize, pixelScale: CGFloat) -> NSImage? {
        let pixelWidth = Int((imageSize.width * pixelScale).rounded(.up))
        let pixelHeight = Int((imageSize.height * pixelScale).rounded(.up))
        guard let context = CGContext(
            data: nil, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
        context.scaleBy(x: CGFloat(pixelWidth) / bounds.width, y: CGFloat(pixelHeight) / bounds.height)
        context.translateBy(x: -bounds.minX, y: -bounds.minY)
        context.clip(to: bounds)
        page.draw(with: .cropBox, to: context)
        guard let cgImage = context.makeImage() else { return nil }
        return NSImage(cgImage: cgImage, size: imageSize)
    }
}
