import PDFKit

/// Größe, Zoom und Startstelle der Link-Vorschau (eingebettete `PDFView` im Popover, siehe `LinkPreviewPresenter`).
enum LinkPreviewLayout {
    /// Ziele liegen knapp über der Zeile bzw. unter der Abbildung; nach oben braucht es wenig Platz.
    static let excerptHeightAbovePoint: CGFloat = 30
    /// Die Vorschau ist so viel schmaler als die PDF-Ansicht, in der sie erscheint (Rand und Pfeil des Popovers)
    static let widthMargin: CGFloat = 40
    static let widthRange: ClosedRange<CGFloat> = 420...900
    static let heightRange: ClosedRange<CGFloat> = 300...600
    /// Anteil der Höhe der PDF-Ansicht
    static let heightFraction: CGFloat = 0.5
    /// Zoom der Hauptansicht, damit der Text so groß wie im PDF wirkt, aber lesbar und nicht riesig bleibt
    static let scaleRange: ClosedRange<CGFloat> = 0.8...2
    /// `PDFPage.rotation` in Grad: Bei Vielfachen davon bleibt die Seitenhöhe die Höhe der Anzeige
    private static let halfTurn = 180

    /// Größe der eingebetteten PDF-Ansicht (ohne Rand und Unterzeile) zur Größe der Haupt-PDF-Ansicht
    static func viewportSize(forMainViewSize size: CGSize) -> CGSize {
        CGSize(
            width: clamp(size.width - widthMargin, to: widthRange),
            height: clamp(size.height * heightFraction, to: heightRange)
        )
    }

    static func scale(forMainScale scale: CGFloat) -> CGFloat {
        clamp(scale, to: scaleRange)
    }

    /// Ziel der Startposition: Seitenanfang links (ganze Seitenbreite sichtbar), etwas Luft über dem Zielpunkt. In
    /// Anzeigekoordinaten gerechnet (`transform(for:)` dreht nach `rotation`), damit „oben“ auch auf gedrehten Seiten stimmt.
    static func startDestination(for destination: PDFDestination) -> PDFDestination? {
        guard let page = destination.page else { return nil }
        let pageBounds = page.bounds(for: .cropBox)
        let toDisplay = page.transform(for: .cropBox)
        let displayBounds = pageBounds.applying(toDisplay)
        let targetY = displayTargetY(of: destination, on: page, pageBounds: pageBounds)
        let start = CGPoint(x: displayBounds.minX, y: min(targetY + excerptHeightAbovePoint, displayBounds.maxY))
        return PDFDestination(page: page, at: start.applying(toDisplay.inverted()))
    }

    /// Höhe des Ziels in Anzeigekoordinaten; ist die Seitenkoordinate unspezifisch, die nach der Drehung die Höhe
    /// bestimmt (bei 90°/270° ist das x), gilt der obere Rand der Anzeige.
    private static func displayTargetY(of destination: PDFDestination, on page: PDFPage, pageBounds: CGRect) -> CGFloat {
        let toDisplay = page.transform(for: .cropBox)
        let displayBounds = pageBounds.applying(toDisplay)
        let isUpright = page.rotation % halfTurn == 0
        let heightCoordinate = isUpright ? destination.point.y : destination.point.x
        guard isSpecified(heightCoordinate) else { return displayBounds.maxY }
        return targetPoint(of: destination, pageBounds: pageBounds).applying(toDisplay).y
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

    private static func clamp(_ value: CGFloat, to range: ClosedRange<CGFloat>) -> CGFloat {
        min(max(value, range.lowerBound), range.upperBound)
    }
}
