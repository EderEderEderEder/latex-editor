import PDFKit

/// Merkt sich beim Klick auf einen internen Link (\ref, \cite, Inhaltsverzeichnis, Fußnote) die Stelle davor, damit
/// „Zurück zu Seite X“ dorthin führt. PDFKit meldet `PDFViewAnnotationWillHit` kurz nach dem Loslassen der Maus, aber
/// **vor** dem Sprung (gemessen, macOS 26): Die Ansicht zeigt dann noch die Ausgangsstelle. Build, „PDF folgt Cursor“,
/// ⌘J, Seitenliste und SyncTeX lösen diese Meldung nicht aus und landen so nicht im Verlauf.
@MainActor
final class PDFLinkInteraction {
    /// Schlüssel der Annotation in `userInfo` (laut PDFKit-Dokumentation)
    nonisolated private static let annotationKey = "PDFAnnotationHit"

    private weak var store: PDFPreviewStore?
    private weak var view: PDFView?
    nonisolated(unsafe) private var observer: NSObjectProtocol?

    init(store: PDFPreviewStore) {
        self.store = store
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Beobachtet nur diese View; eine vorher beobachtete wird abgemeldet
    func observe(_ view: PDFView) {
        stopObserving()
        self.view = view
        observer = NotificationCenter.default.addObserver(forName: .PDFViewAnnotationWillHit, object: view, queue: .main) {
            [weak self] notification in
            // URL-Links lösen die Meldung auch aus; nur interne Sprungziele zählen
            let annotation = notification.userInfo?[Self.annotationKey] as? PDFAnnotation
            let isInternalLink = annotation.map { PDFLinks.internalTarget(of: $0) != nil } ?? false
            guard isInternalLink else { return }
            MainActor.assumeIsolated { self?.recordJumpOrigin() }
        }
    }

    private func stopObserving() {
        guard let observer else { return }
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
    }

    private func recordJumpOrigin() {
        guard let origin = view?.captureViewState() else { return }
        store?.recordJumpOrigin(origin)
    }
}
