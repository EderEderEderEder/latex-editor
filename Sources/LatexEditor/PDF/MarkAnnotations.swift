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

    /// Etwas dunkler als der Marker, damit das kleine Symbol auf weißem Papier lesbar bleibt
    var iconColor: NSColor {
        let darker = baseColor.blended(withFraction: 0.25, of: .black) ?? baseColor
        return darker.usingColorSpace(.sRGB) ?? darker
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

/// Kleines Symbol (Kommentar oder Notiz) im Farbton der Markierung (`color`). Eigene Zeichnung statt einer `.text`-Annotation:
/// Deren Klick öffnet in PDFKit ein gelbes Notizfenster neben dem Popover der App.
///
/// **Zeichnen nur mit CoreGraphics, ohne AppKit-Aufrufe und ohne Closures**: PDFKit ruft `draw(with:in:)` auf einem
/// Hintergrund-Thread auf. Eine erste Fassung mit `NSImage`-Zeichenblock und `NSRect.fill(using:)` brach dort in Xcode mit
/// `EXC_BAD_INSTRUCTION` ab (Thread 14). Warum, ist nicht geklärt; im Test auf einem Hintergrund-Thread ließ es sich nicht
/// nachstellen. Die Farbe ist beim Anlegen schon sRGB, damit auf dem Zeichen-Thread nichts mehr aufgelöst werden muss.
///
/// **Ohne eigene gespeicherte Eigenschaften**: PDFKit kopiert Annotationen und baut die Kopie womöglich ohne Swift-`init`;
/// deshalb Unterklassen mit festem Symbol (`glyph`), die Farbe liegt in `color`.
class MarkIconAnnotation: PDFAnnotation {
    enum Glyph {
        case bubble
        case note
    }

    class var glyph: Glyph { .bubble }

    override func draw(with box: PDFDisplayBox, in context: CGContext) {
        let rect = bounds
        guard rect.isDrawable else { return }
        context.saveGState()
        context.setFillColor(color.cgColor)
        let isNote = Self.glyph == .note
        let body = CGRect(x: rect.minX, y: rect.minY + rect.height * Self.tailShare, width: rect.width, height: rect.height * (1 - Self.tailShare))
        let corner = rect.width * Self.cornerShare
        context.addPath(CGPath(roundedRect: isNote ? rect : body, cornerWidth: corner, cornerHeight: corner, transform: nil))
        if !isNote {
            // Spitze unten links
            context.move(to: CGPoint(x: rect.minX + rect.width * 0.18, y: body.minY + 0.5))
            context.addLine(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY))
            context.addLine(to: CGPoint(x: rect.minX + rect.width * 0.42, y: body.minY + 0.5))
            context.closePath()
        }
        context.fillPath()
        drawTextLines(in: isNote ? rect : body, context: context)
        context.restoreGState()
    }

    /// Zwei helle Striche als Andeutung von Text
    private func drawTextLines(in area: CGRect, context: CGContext) {
        context.setStrokeColor(CGColor(gray: 1, alpha: 0.9))
        context.setLineWidth(max(area.height * Self.lineWidthShare, 0.5))
        context.setLineCap(.round)
        for fraction in [Self.upperLineShare, Self.lowerLineShare] {
            let y = area.minY + area.height * fraction
            context.move(to: CGPoint(x: area.minX + area.width * 0.25, y: y))
            context.addLine(to: CGPoint(x: area.maxX - area.width * 0.25, y: y))
        }
        context.strokePath()
    }

    private static let tailShare: CGFloat = 0.22
    private static let cornerShare: CGFloat = 0.28
    private static let lineWidthShare: CGFloat = 0.1
    private static let upperLineShare: CGFloat = 0.62
    private static let lowerLineShare: CGFloat = 0.36
}

final class MarkCommentIconAnnotation: MarkIconAnnotation {
    override class var glyph: Glyph { .bubble }
}

final class MarkNoteIconAnnotation: MarkIconAnnotation {
    override class var glyph: Glyph { .note }
}

extension PDFPreviewStore {
    /// Das Kommentarsymbol sitzt am Ende der Markierung, wie ein Hochgestelltes: ein wenig über die Zeile hinaus
    private static let commentIconSize: CGFloat = 10
    private static let commentIconGap: CGFloat = 0.5
    private static let commentIconRaise: CGFloat = 7

    /// Setzt die Markierungen als Annotationen ins geladene Dokument und ersetzt dabei die vorherigen: Textmarker,
    /// bei Kommentar mit Symbol am rechten Seitenrand, Notizen als Symbol. Verwaiste und wartende werden nicht gezeigt.
    func showMarks(_ marks: [PDFMark], _ resolutions: [UUID: MarkResolution]) {
        removeMarks()
        guard let document = pdfView?.document else { return }
        for mark in marks {
            guard case .placed(let all, _)? = resolutions[mark.id] else { continue }
            let segments = all.filter { $0.rect.isDrawable }
            guard !segments.isEmpty else { continue }
            switch mark.kind {
            case .highlight: addHighlight(for: mark, segments: segments, in: document)
            case .note: addNoteIcon(for: mark, rect: segments.first, in: document)
            }
        }
        for page in Set(markAnnotations.compactMap(\.page)) { pdfView?.annotationsChanged(on: page) }
        pdfView?.setNeedsDisplay(pdfView?.bounds ?? .zero)
    }

    private func addHighlight(for mark: PDFMark, segments: [MarkResolution.Segment], in document: PDFDocument) {
        let byPage = Dictionary(grouping: segments, by: \.pageIndex)
        for (pageIndex, pageSegments) in byPage {
            guard let page = document.page(at: pageIndex) else { continue }
            add(makeHighlight(for: mark, rects: pageSegments.map(\.rect)), to: page)
        }
        guard !mark.comment.isEmpty, let last = segments.last, let page = document.page(at: last.pageIndex) else { return }
        let size = Self.commentIconSize
        let bounds = CGRect(x: last.rect.maxX + Self.commentIconGap, y: last.rect.maxY - size + Self.commentIconRaise, width: size, height: size)
        add(makeIcon(for: mark, bounds: bounds), to: page)
    }

    private func addNoteIcon(for mark: PDFMark, rect: MarkResolution.Segment?, in document: PDFDocument) {
        guard let rect, let page = document.page(at: rect.pageIndex) else { return }
        add(makeIcon(for: mark, bounds: rect.rect), to: page)
    }

    private func add(_ annotation: PDFAnnotation, to page: PDFPage) {
        page.addAnnotation(annotation)
        markAnnotations.append(annotation)
    }

    private static let retirementDelay: Duration = .seconds(5)

    private func removeMarks() {
        let removed = markAnnotations
        markAnnotations = []
        var pages: [PDFPage] = []
        for annotation in removed {
            guard let page = annotation.page else { continue }
            page.removeAnnotation(annotation)
            pages.append(page)
        }
        pages.forEach { pdfView?.annotationsChanged(on: $0) }
        retiredMarkAnnotations.append(contentsOf: removed)
        Task { [weak self] in
            try? await Task.sleep(for: Self.retirementDelay)
            self?.retiredMarkAnnotations.removeAll { annotation in removed.contains { $0 === annotation } }
        }
    }

    /// Ändert die Farbe vorhandener Annotationen an Ort und Stelle (kein Entfernen und Neuanlegen, solange PDFKit zeichnet)
    func recolorMarkAnnotations(_ id: UUID, to color: MarkColor) -> Bool {
        let own = markAnnotations.filter { $0.userName == id.uuidString }
        guard !own.isEmpty else { return false }
        for annotation in own {
            annotation.color = annotation is MarkIconAnnotation ? color.iconColor : color.highlightColor
            if let page = annotation.page { pdfView?.annotationsChanged(on: page) }
        }
        return true
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
        let annotation: MarkIconAnnotation = mark.kind == .note
            ? MarkNoteIconAnnotation(bounds: bounds, forType: .square, withProperties: nil)
            : MarkCommentIconAnnotation(bounds: bounds, forType: .square, withProperties: nil)
        annotation.color = mark.color.iconColor
        annotation.userName = mark.id.uuidString
        if !mark.comment.isEmpty { annotation.contents = mark.comment }
        return annotation
    }
}

extension CGRect {
    /// Endlich und nicht leer: Ein Rechteck mit NaN, unendlichen Werten oder ohne Fläche gehört nicht in eine Annotation
    var isDrawable: Bool {
        !isNull && !isInfinite && !isEmpty && origin.x.isFinite && origin.y.isFinite && width.isFinite && height.isFinite
    }
}
