import PDFKit

/// Liest Link-Annotationen einer PDF-Seite (interne Sprungziele und URLs).
enum PDFLinks {
    /// Die Link-Annotation unter dem Punkt (Seitenkoordinaten). Bewusst nicht `page.annotation(at:)`:
    /// Eine darübergelegte Markierung (Highlight) würde dort den Link verdecken.
    static func link(at point: CGPoint, on page: PDFPage) -> PDFAnnotation? {
        page.annotations.first { isLink($0) && $0.bounds.contains(point) }
    }

    /// Ziel eines internen Links (direkt oder über eine GoTo-Aktion); `nil` bei URL-Links oder ohne Ziel. Ein Ziel ohne
    /// Seite zählt nicht: Dorthin springt PDFKit nicht (kein Verlaufseintrag, keine Vorschau).
    static func internalTarget(of annotation: PDFAnnotation) -> PDFDestination? {
        if isExternal(annotation) { return nil }
        let candidates = [annotation.destination, (annotation.action as? PDFActionGoTo)?.destination]
        return candidates.lazy.compactMap { $0 }.first { $0.page != nil }
    }

    static func isExternal(_ annotation: PDFAnnotation) -> Bool {
        annotation.url != nil || annotation.action is PDFActionURL
    }

    private static func isLink(_ annotation: PDFAnnotation) -> Bool {
        let linkType = PDFAnnotationSubtype.link.rawValue
        let type = annotation.type ?? ""
        return type == linkType || "/" + type == linkType
    }
}
