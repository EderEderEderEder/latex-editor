import Foundation
import Observation
import PDFKit

@MainActor
@Observable
final class PDFPreviewStore {
    /// Pfad der vorhandenen PDF-Datei, sonst nil.
    private(set) var pdfURL: URL?
    /// Wird bei jeder Dateiänderung erhöht; die PDFKit-View lädt dann neu.
    private(set) var reloadToken = 0
    private(set) var expectedURL: URL?
    private(set) var currentPage = 0
    private(set) var pageCount = 0
    private(set) var zoomPercent = 100

    @ObservationIgnored weak var pdfView: PDFView?
    /// ⌘-Klick ins PDF: Seite (1-basiert) und Punkt in SyncTeX-Koordinaten (oben links).
    @ObservationIgnored var onCommandClick: ((Int, CGPoint) -> Void)?
    @ObservationIgnored private var highlight: (annotation: PDFAnnotation, page: PDFPage)?
    @ObservationIgnored private var candidateURLs: [URL] = []

    private static let zoomStep: CGFloat = 1.25
    /// Reines Gelb #FFFF00. Als Highlight-Annotation wird es multipliziert, der Text bleibt lesbar.
    static let highlightColor = NSColor(srgbRed: 1, green: 1, blue: 0, alpha: 1)
    /// Markierung zuerst voll zeigen, dann weich ausblenden.
    private static let highlightHold = Duration.milliseconds(700)
    private static let highlightFade = Duration.milliseconds(600)
    private static let highlightFadeSteps = 30
    private static let highlightPadding: CGFloat = 2
    private static let horizontalMargin: CGFloat = 20
    private static let outputDirectoryNames = ["", "build", "out"]

    func setMainFile(_ mainFile: URL?) {
        guard let mainFile else {
            expectedURL = nil
            pdfURL = nil
            return
        }
        let directory = mainFile.deletingLastPathComponent()
        let pdfName = mainFile.deletingPathExtension().lastPathComponent + ".pdf"
        let candidates = Self.outputDirectoryNames.map {
            directory.appendingPathComponent($0).appendingPathComponent(pdfName).standardizedFileURL
        }
        expectedURL = candidates[0]
        candidateURLs = candidates
        refresh()
    }

    /// Prüft, ob eine PDF-Datei vorhanden ist, und stößt ein Neuladen an.
    func refresh() {
        let existing = candidateURLs.first { FileManager.default.fileExists(atPath: $0.path) }
        if existing != pdfURL { pdfURL = existing }
        reloadToken &+= 1
    }

    func isPDFCandidate(path: String) -> Bool {
        candidateURLs.contains { $0.path == path }
    }

    func zoomIn() { applyZoom(factor: Self.zoomStep) }
    func zoomOut() { applyZoom(factor: 1 / Self.zoomStep) }

    func zoomToFitWidth() {
        pdfView?.autoScales = true
        syncStatus()
    }

    func syncStatus() {
        guard let pdfView, let document = pdfView.document else {
            update(page: 0, count: 0, zoom: 100)
            return
        }
        let page = pdfView.currentPage.map { document.index(for: $0) + 1 } ?? 0
        update(page: page, count: document.pageCount, zoom: Int((pdfView.scaleFactor * 100).rounded()))
    }

    private func update(page: Int, count: Int, zoom: Int) {
        if currentPage != page { currentPage = page }
        if pageCount != count { pageCount = count }
        if zoomPercent != zoom { zoomPercent = zoom }
    }

    private func applyZoom(factor: CGFloat) {
        guard let pdfView else { return }
        pdfView.autoScales = false
        pdfView.scaleFactor = min(max(pdfView.scaleFactor * factor, pdfView.minScaleFactor), pdfView.maxScaleFactor)
        syncStatus()
    }

    // MARK: SyncTeX

    enum RevealMode {
        /// Tastenkürzel: immer hinscrollen und markieren
        case explicit
        /// „PDF folgt Cursor“: nur scrollen (und markieren), wenn die Stelle nicht sichtbar ist
        case follow
    }

    func reveal(_ box: SyncTeXBox, mode: RevealMode) {
        guard let pdfView, let document = pdfView.document, document.pageCount > 0,
              let page = document.page(at: min(max(box.page - 1, 0), document.pageCount - 1)) else { return }
        let rect = SyncTeXCoordinates.pdfRect(from: box.rect, mediaBox: page.bounds(for: .mediaBox))
        if mode == .follow, pdfView.bounds.contains(pdfView.convert(rect, from: page)) { return }
        scroll(pdfView, toCenter: rect, on: page)
        showHighlight(rect, on: page)
    }

    /// Vom PDF-View bei ⌘-Klick aufgerufen (Punkt in PDFKit-Seitenkoordinaten).
    func handleCommandClick(on page: PDFPage, at point: CGPoint) {
        guard let document = page.document else { return }
        let syncTeXPoint = SyncTeXCoordinates.syncTeXPoint(fromPDF: point, mediaBox: page.bounds(for: .mediaBox))
        onCommandClick?(document.index(for: page) + 1, syncTeXPoint)
    }

    private func scroll(_ pdfView: PDFView, toCenter rect: CGRect, on page: PDFPage) {
        let visibleHeight = pdfView.bounds.height / max(pdfView.scaleFactor, .leastNonzeroMagnitude)
        let top = rect.midY + visibleHeight / 2
        pdfView.go(to: PDFDestination(page: page, at: CGPoint(x: rect.minX - Self.horizontalMargin, y: top)))
        syncStatus()
    }

    private func showHighlight(_ rect: CGRect, on page: PDFPage) {
        if let previous = highlight { previous.page.removeAnnotation(previous.annotation) }
        let padded = rect.insetBy(dx: -Self.highlightPadding, dy: -Self.highlightPadding)
        let annotation = PDFAnnotation(bounds: padded, forType: .highlight, withProperties: nil)
        annotation.color = Self.highlightColor
        page.addAnnotation(annotation)
        highlight = (annotation, page)
        Task { [weak self] in await self?.fadeOut(annotation, on: page) }
    }

    /// Hält die Markierung kurz und blendet sie dann in kleinen Schritten aus. Eine neue Markierung
    /// (erneutes ⌘J) bricht das Ausblenden der alten ab.
    private func fadeOut(_ annotation: PDFAnnotation, on page: PDFPage) async {
        try? await Task.sleep(for: Self.highlightHold)
        let stepDuration = Self.highlightFade / Self.highlightFadeSteps
        for step in 1...Self.highlightFadeSteps {
            guard highlight?.annotation === annotation else { return }
            let progress = Double(step) / Double(Self.highlightFadeSteps)
            annotation.color = Self.highlightColor.withAlphaComponent(Self.fadeAlpha(progress: progress))
            pdfView?.annotationsChanged(on: page)
            try? await Task.sleep(for: stepDuration)
        }
        guard highlight?.annotation === annotation else { return }
        page.removeAnnotation(annotation)
        highlight = nil
    }

    /// Deckkraft beim Ausblenden: weich (Smoothstep), 1 bei Beginn, 0 am Ende.
    static func fadeAlpha(progress: Double) -> CGFloat {
        let clamped = min(max(progress, 0), 1)
        return CGFloat(1 - clamped * clamped * (3 - 2 * clamped))
    }
}
