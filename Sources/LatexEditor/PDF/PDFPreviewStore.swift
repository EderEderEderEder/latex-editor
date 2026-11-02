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

    /// Die Zeilenrechtecke der markierten Textstelle (leer ohne Auswahl): Menüeinträge für Markierungen richten sich danach
    private(set) var selectionSegments: [MarkResolution.Segment] = []
    /// Die Liste der Markierungen (Popover der unteren Leiste) ist offen
    var isMarkListShown = false

    @ObservationIgnored weak var pdfView: PDFView?
    /// Stand der PDF-View, die zuletzt verschwunden ist (Wechsel der Ansicht); die nächste View übernimmt ihn
    @ObservationIgnored var savedViewState: PDFViewState?
    /// ⌘-Klick ins PDF: Seite (1-basiert) und Punkt in SyncTeX-Koordinaten (oben links).
    @ObservationIgnored var onCommandClick: ((Int, CGPoint) -> Void)?
    /// Rechtsklick im PDF: Textstelle markieren, Farbe einer Markierung ändern, Markierung entfernen
    @ObservationIgnored var onMarkSelection: ((MarkColor?) -> Void)?
    @ObservationIgnored var onCommentSelection: (() -> Void)?
    @ObservationIgnored var onAddNote: ((PDFPage, CGPoint) -> Void)?
    /// Klick auf eine Markierung oder ihr Symbol: Popover mit Kommentar
    @ObservationIgnored var onClickMark: ((UUID) -> Void)?
    @ObservationIgnored var onRecolorMark: ((UUID, MarkColor) -> Void)?
    @ObservationIgnored var onRemoveMark: ((UUID) -> Void)?
    /// Das PDF ist (neu) in der Ansicht: Markierungen darauflegen
    @ObservationIgnored var onDocumentLoaded: (() -> Void)?
    /// Die Markierungen, die gerade im Dokument stehen (nur in der Ansicht, nie in der PDF-Datei)
    @ObservationIgnored var markAnnotations: [PDFAnnotation] = []
    @ObservationIgnored private var candidateURLs: [URL] = []

    private static let zoomStep: CGFloat = 1.25
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

    func syncSelection() {
        let segments: [MarkResolution.Segment]
        if let pdfView, let document = pdfView.document, let selection = pdfView.currentSelection, selection.string?.isEmpty == false {
            segments = MarkResolution.segments(of: selection, in: document)
        } else {
            segments = []
        }
        if segments != selectionSegments { selectionSegments = segments }
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
        /// Tastenkürzel, ⌘-Klick im Editor: immer hinscrollen
        case explicit
        /// „PDF folgt Cursor“: nur scrollen, wenn die Stelle nicht sichtbar ist
        case follow
    }

    func reveal(_ box: SyncTeXBox, mode: RevealMode) {
        guard let pdfView, let document = pdfView.document, document.pageCount > 0,
              let page = document.page(at: min(max(box.page - 1, 0), document.pageCount - 1)) else { return }
        let rect = SyncTeXCoordinates.pdfRect(from: box.rect, mediaBox: page.bounds(for: .mediaBox))
        if mode == .follow, pdfView.bounds.contains(pdfView.convert(rect, from: page)) { return }
        // Ohne gelbe Markierung: Sie war beim Arbeiten störend (Nutzerwunsch)
        scroll(pdfView, toCenter: rect, on: page)
    }

    /// Vom PDF-View bei ⌘-Klick aufgerufen (Punkt in PDFKit-Seitenkoordinaten).
    func handleCommandClick(on page: PDFPage, at point: CGPoint) {
        guard let document = page.document else { return }
        let syncTeXPoint = SyncTeXCoordinates.syncTeXPoint(fromPDF: point, mediaBox: page.bounds(for: .mediaBox))
        onCommandClick?(document.index(for: page) + 1, syncTeXPoint)
    }

    /// Scrollt zu einem Rechteck (PDFKit-Seitenkoordinaten), z. B. aus der Liste der Markierungen
    func reveal(_ segment: MarkResolution.Segment) {
        guard let pdfView, let page = pdfView.document?.page(at: segment.pageIndex) else { return }
        scroll(pdfView, toCenter: segment.rect, on: page)
    }

    /// Das Rechteck im Koordinatensystem der Ansicht (für ein Popover an der Stelle)
    func viewRect(of segment: MarkResolution.Segment) -> (view: PDFView, rect: CGRect)? {
        guard let pdfView, let page = pdfView.document?.page(at: segment.pageIndex) else { return nil }
        return (pdfView, pdfView.convert(segment.rect, from: page))
    }

    private func scroll(_ pdfView: PDFView, toCenter rect: CGRect, on page: PDFPage) {
        let visibleHeight = pdfView.bounds.height / max(pdfView.scaleFactor, .leastNonzeroMagnitude)
        let top = rect.midY + visibleHeight / 2
        pdfView.go(to: PDFDestination(page: page, at: CGPoint(x: rect.minX - Self.horizontalMargin, y: top)))
        syncStatus()
    }
}
