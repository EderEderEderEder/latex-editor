import PDFKit
import SwiftUI

struct PDFKitView: NSViewRepresentable {
    let store: PDFPreviewStore
    let url: URL
    let reloadToken: Int

    func makeCoordinator() -> PDFCoordinator {
        PDFCoordinator(store: store)
    }

    func makeNSView(context: Context) -> PDFView {
        let view = SyncTeXPDFView()
        view.onCommandClick = { [weak store] page, point in store?.handleCommandClick(on: page, at: point) }
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        store.pdfView = view
        context.coordinator.observe(view)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        context.coordinator.reloadIfNeeded(in: view, url: url, token: reloadToken)
    }

    /// Beim Wechsel der Ansicht (Nur Editor / Geteilt / Nur PDF) verschwindet die View; Seite, Position und Zoom
    /// bleiben im Store, die nächste View stellt sie wieder her.
    static func dismantleNSView(_ view: PDFView, coordinator: PDFCoordinator) {
        coordinator.saveState(of: view)
    }
}

/// Wo man im PDF war: Seite, Punkt auf der Seite, Zoom
struct PDFViewState {
    let pageIndex: Int
    let point: CGPoint
    let scale: CGFloat
    let autoScales: Bool
}

@MainActor
final class PDFCoordinator {
    private let store: PDFPreviewStore
    private var loadedURL: URL?
    private var loadedToken: Int?
    nonisolated(unsafe) private var observers: [NSObjectProtocol] = []

    init(store: PDFPreviewStore) {
        self.store = store
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    func observe(_ view: PDFView) {
        let names: [Notification.Name] = [.PDFViewPageChanged, .PDFViewScaleChanged, .PDFViewDocumentChanged]
        observers = names.map { name in
            NotificationCenter.default.addObserver(forName: name, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.store.syncStatus() }
            }
        }
    }

    func reloadIfNeeded(in view: PDFView, url: URL, token: Int) {
        guard url != loadedURL || token != loadedToken else { return }
        loadedURL = url
        loadedToken = token
        let measurement = Signposts.begin("PDFReload")
        defer { measurement.end() }

        // Unvollständig geschriebene PDFs ergeben nil; dann bleibt die alte Ansicht stehen.
        guard let document = PDFDocument(url: url) else { return }
        // Eine neue View (nach einem Wechsel der Ansicht) hat noch nichts: dann gilt der gemerkte Stand
        let previous = captureState(of: view) ?? store.savedViewState
        store.savedViewState = nil
        view.document = document
        if let previous { restore(previous, in: view, document: document) }
        store.syncStatus()
    }

    func saveState(of view: PDFView) {
        store.savedViewState = captureState(of: view)
    }

    private func captureState(of view: PDFView) -> PDFViewState? {
        guard let document = view.document,
              let destination = view.currentDestination,
              let page = destination.page else { return nil }
        return PDFViewState(
            pageIndex: document.index(for: page),
            point: destination.point,
            scale: view.scaleFactor,
            autoScales: view.autoScales
        )
    }

    private func restore(_ state: PDFViewState, in view: PDFView, document: PDFDocument) {
        guard document.pageCount > 0 else { return }
        view.autoScales = state.autoScales
        if !state.autoScales { view.scaleFactor = state.scale }
        let index = min(state.pageIndex, document.pageCount - 1)
        guard let page = document.page(at: index) else { return }
        let destination = PDFDestination(page: page, at: state.point)
        view.layoutDocumentView()
        view.go(to: destination)
        // Eine frisch angelegte View hat beim ersten Update noch keine Größe; nach dem Layout nochmal
        guard view.bounds.isEmpty else { return }
        DispatchQueue.main.async { [weak view] in
            view?.layoutDocumentView()
            view?.go(to: destination)
        }
    }
}

/// PDFView mit ⌘-Klick für die Rückwärtssuche (PDF → Quelltext). Normale Klicks bleiben unverändert.
final class SyncTeXPDFView: PDFView {
    var onCommandClick: ((PDFPage, CGPoint) -> Void)?

    override func mouseDown(with event: NSEvent) {
        guard event.modifierFlags.contains(.command), let onCommandClick else {
            super.mouseDown(with: event)
            return
        }
        let viewPoint = convert(event.locationInWindow, from: nil)
        guard let page = page(for: viewPoint, nearest: true) else { return }
        onCommandClick(page, convert(viewPoint, to: page))
    }
}
