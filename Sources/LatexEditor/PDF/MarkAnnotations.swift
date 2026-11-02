import PDFKit

extension MarkColor {
    private static let highlightAlpha: CGFloat = 0.45

    private static let swatchSize: CGFloat = 12
    private static let swatchInset: CGFloat = 1

    var baseColor: NSColor {
        switch self {
        case .yellow: .systemYellow
        case .green: .systemGreen
        case .blue: .systemBlue
        case .pink: .systemPink
        case .orange: .systemOrange
        }
    }

    /// Textmarker-Farbe: durchscheinend, damit der Text lesbar bleibt
    var highlightColor: NSColor {
        baseColor.withAlphaComponent(Self.highlightAlpha)
    }

    /// Farbpunkt für Menüeinträge (der Name steht daneben: Die Farbe allein bedeutet nichts)
    var swatch: NSImage {
        let color = baseColor
        let image = NSImage(size: NSSize(width: Self.swatchSize, height: Self.swatchSize), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: Self.swatchInset, dy: Self.swatchInset)).fill()
            return true
        }
        image.isTemplate = false
        return image
    }
}

extension PDFPreviewStore {
    private static let iconSize: CGFloat = 16
    private static let iconPageInset: CGFloat = 6

    /// Setzt die Markierungen als Annotationen ins geladene Dokument und ersetzt dabei die vorherigen: Textmarker,
    /// bei Kommentar mit Symbol am rechten Seitenrand, Notizen als Symbol. Verwaiste und wartende werden nicht gezeigt.
    func showMarks(_ marks: [PDFMark], _ resolutions: [UUID: MarkResolution]) {
        removeMarks()
        guard let document = pdfView?.document else { return }
        for mark in marks {
            guard case .placed(let segments, _)? = resolutions[mark.id] else { continue }
            switch mark.kind {
            case .highlight: addHighlight(for: mark, segments: segments, in: document)
            case .note: addNoteIcon(for: mark, rect: segments.first, in: document)
            }
        }
        pdfView?.setNeedsDisplay(pdfView?.bounds ?? .zero)
    }

    private func addHighlight(for mark: PDFMark, segments: [MarkResolution.Segment], in document: PDFDocument) {
        let byPage = Dictionary(grouping: segments, by: \.pageIndex)
        for (pageIndex, pageSegments) in byPage {
            guard let page = document.page(at: pageIndex) else { continue }
            add(makeHighlight(for: mark, rects: pageSegments.map(\.rect)), to: page)
        }
        guard !mark.comment.isEmpty, let first = segments.first, let page = document.page(at: first.pageIndex) else { return }
        let mediaBox = page.bounds(for: .mediaBox)
        let x = mediaBox.maxX - Self.iconSize - Self.iconPageInset
        add(makeIcon(for: mark, bounds: CGRect(x: x, y: first.rect.maxY - Self.iconSize, width: Self.iconSize, height: Self.iconSize)), to: page)
    }

    private func addNoteIcon(for mark: PDFMark, rect: MarkResolution.Segment?, in document: PDFDocument) {
        guard let rect, let page = document.page(at: rect.pageIndex) else { return }
        add(makeIcon(for: mark, bounds: rect.rect), to: page)
    }

    private func add(_ annotation: PDFAnnotation, to page: PDFPage) {
        page.addAnnotation(annotation)
        markAnnotations.append(annotation)
    }

    private func removeMarks() {
        for annotation in markAnnotations { annotation.page?.removeAnnotation(annotation) }
        markAnnotations = []
    }

    private func makeHighlight(for mark: PDFMark, rects: [CGRect]) -> PDFAnnotation {
        let bounds = rects.dropFirst().reduce(rects[0]) { $0.union($1) }
        let annotation = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
        annotation.color = mark.color.highlightColor
        annotation.quadrilateralPoints = rects.flatMap { rect in
            // oben links, oben rechts, unten links, unten rechts; relativ zur Ecke der Annotation
            [CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.maxX, y: rect.maxY),
             CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY)]
                .map { NSValue(point: CGPoint(x: $0.x - bounds.minX, y: $0.y - bounds.minY)) }
        }
        annotation.userName = mark.id.uuidString
        if !mark.comment.isEmpty { annotation.contents = mark.comment }
        return annotation
    }

    /// Kommentar- bzw. Notizsymbol; ein Klick darauf öffnet das Popover der Markierung (das PDF zeigt kein eigenes)
    private func makeIcon(for mark: PDFMark, bounds: CGRect) -> PDFAnnotation {
        let annotation = PDFAnnotation(bounds: bounds, forType: .text, withProperties: nil)
        annotation.iconType = mark.kind == .note ? .note : .comment
        annotation.color = mark.color.baseColor
        annotation.userName = mark.id.uuidString
        if !mark.comment.isEmpty { annotation.contents = mark.comment }
        return annotation
    }
}
