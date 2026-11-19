import PDFKit

/// Vorschau des Ziels interner Links (\ref, \cite, Inhaltsverzeichnis, Fußnote) als Popover am Linkrechteck.
/// Drei Auslöser: Rechtsklickmenü „Vorschau des Ziels“, ⌥ gedrückt halten über dem Link, Force Click.
/// Eine offene Vorschau bleibt offen (Maus darf hineinwandern und darin scrollen), auch wenn ⌥ losgelassen wird oder die Maus
/// den Link verlässt. Geschlossen wird bei Klick außerhalb und Esc (NSPopover), Tastendruck, Scrollen und Zoom im PDF,
/// neuem Dokument, Fensterwechsel und beim Schließen des Fensters. Eine neue ⌥-Vorschau ersetzt die offene.
/// Eine verborgene PDF-View (Modus „Nur Editor“) zeigt nie eine Vorschau.
@MainActor
final class PDFLinkPreviewTriggers: NSObject {
    private static let hoverDelay: Duration = .milliseconds(600)
    /// Stufe 2 von `NSEvent.stage`: der tiefe Druck eines Force Clicks
    private static let forceClickStage = 2
    /// Stufe 0 von `NSEvent.stage`: kein Druck mehr auf dem Trackpad
    private static let releasedStage = 0
    private static let relevantModifiers: NSEvent.ModifierFlags = [.command, .control, .option, .shift]
    private static let monitoredEvents: NSEvent.EventTypeMask = [
        .pressure, .flagsChanged, .keyDown, .leftMouseDown, .leftMouseUp, .rightMouseDown, .otherMouseDown, .scrollWheel,
    ]

    private weak var view: PDFView?
    private let presenter: LinkPreviewPresenter
    /// Der Link unter der Maus, solange ⌥ gedrückt ist (wartet auf die Vorschau oder zeigt sie)
    private var hoveredLink: PDFAnnotation?
    /// Vorschau per Force Click gezeigt: PDFKit soll dem Link beim Loslassen nicht folgen (siehe `consumeForceClickPress`)
    private var didShowPreviewForCurrentPress = false
    nonisolated(unsafe) private var hoverTask: Task<Void, Never>?
    nonisolated(unsafe) private var monitor: Any?
    nonisolated(unsafe) private var viewObservers: [NSObjectProtocol] = []
    nonisolated(unsafe) private var windowObserver: NSObjectProtocol?

    init(view: PDFView) {
        self.view = view
        presenter = LinkPreviewPresenter()
        super.init()
        observeView(view)
    }

    deinit {
        hoverTask?.cancel()
        if let monitor { NSEvent.removeMonitor(monitor) }
        viewObservers.forEach(NotificationCenter.default.removeObserver)
        if let windowObserver { NotificationCenter.default.removeObserver(windowObserver) }
    }

    /// Bei jedem Fensterwechsel der View: alte Vorschau schließen, Ereignis-Beobachter für das neue Fenster anmelden
    func attach(to window: NSWindow?) {
        detachFromWindow()
        guard let window else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: Self.monitoredEvents) { [weak self] event in
            self?.handle(event)
            return event
        }
        windowObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: window, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.dismiss() }
        }
    }

    private func detachFromWindow() {
        dismiss()
        didShowPreviewForCurrentPress = false
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if let windowObserver { NotificationCenter.default.removeObserver(windowObserver) }
        windowObserver = nil
    }

    private func observeView(_ view: PDFView) {
        let names: [Notification.Name] = [.PDFViewDocumentChanged, .PDFViewScaleChanged, .PDFViewPageChanged]
        viewObservers = names.map { name in
            NotificationCenter.default.addObserver(forName: name, object: view, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.dismiss() }
            }
        }
    }

    // MARK: Rechtsklickmenü

    /// „Vorschau des Ziels“, wenn unter dem Punkt (Koordinaten der View) ein interner Link liegt
    func menuItems(atViewPoint point: CGPoint) -> [NSMenuItem] {
        guard let link = internalLink(atViewPoint: point) else { return [] }
        let item = NSMenuItem(title: "Vorschau des Ziels", action: #selector(showMenuPreview(_:)), keyEquivalent: "")
        item.representedObject = link
        item.target = self
        return [item]
    }

    @objc private func showMenuPreview(_ sender: NSMenuItem) {
        guard let link = sender.representedObject as? PDFAnnotation else { return }
        endHover()
        showPreview(for: link)
    }

    // MARK: ⌥-Hover

    /// Aus `mouseMoved`/`mouseExited` der View: Vorschau nach kurzer Wartezeit, solange nur ⌥ gedrückt ist
    func updateHover(with event: NSEvent) {
        guard let view else { return }
        let point = view.convert(event.locationInWindow, from: nil)
        updateHover(atViewPoint: point, isOptionDown: Self.isOptionOnly(event.modifierFlags))
    }

    private func updateHover(atViewPoint point: CGPoint, isOptionDown: Bool) {
        let link = isOptionDown ? internalLink(atViewPoint: point) : nil
        guard link !== hoveredLink else { return }
        endHover()
        guard let link else { return }
        hoveredLink = link
        scheduleHoverPreview(for: link)
    }

    /// ⌥ gedrückt oder losgelassen, ohne dass sich die Maus bewegt. Starten nur, wenn das PDF den Fokus hat: Auf deutscher
    /// Tastatur entstehen [ ] { } | ~ mit ⌥, beim Tippen im Editor darf über einem Link unter der Maus nichts aufgehen.
    private func updateHoverAtMouseLocation(modifiers: NSEvent.ModifierFlags) {
        guard let view, let window = view.window else { return }
        let point = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
        let isOptionDown = Self.isOptionOnly(modifiers) && hasFocus(in: window)
        updateHover(atViewPoint: point, isOptionDown: isOptionDown)
    }

    /// Die PDF-View oder eine ihrer Unteransichten ist Ersthelfer des Fensters
    private func hasFocus(in window: NSWindow) -> Bool {
        guard let view, let responder = window.firstResponder as? NSView else { return false }
        return responder.isDescendant(of: view)
    }

    private func scheduleHoverPreview(for link: PDFAnnotation) {
        hoverTask?.cancel()
        hoverTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.hoverDelay)
            guard !Task.isCancelled, let self, self.hoveredLink === link else { return }
            self.showPreview(for: link)
        }
    }

    /// Wartezeit abbrechen; eine bereits offene Vorschau bleibt stehen
    private func endHover() {
        hoverTask?.cancel()
        hoverTask = nil
        hoveredLink = nil
    }

    private static func isOptionOnly(_ modifiers: NSEvent.ModifierFlags) -> Bool {
        modifiers.intersection(relevantModifiers) == [.option]
    }

    // MARK: Force Click

    /// Aus `mouseDown(with:)` der View: `true`, wenn dieser Druck schon die Vorschau per Force Click gezeigt hat.
    /// Dann ruft die View `super.mouseDown` nicht auf, damit PDFKit dem Link beim Loslassen nicht folgt (kein Sprung,
    /// kein Verlaufseintrag).
    /// Gemessen (macOS 26): `.pressure` mit Stufe 2 kommt im Monitor an; `quickLook(with:)` wird nie aufgerufen.
    /// Ungetestet (keine Force-Touch-Hardware): ob `mouseDown` erst nach Stufe 2 ankommt. Kommt es vorher, folgt PDFKit
    /// dem Link wie bei einem normalen Klick. Ein normaler Klick (ohne Stufe 2) setzt den Merker nie; Stufe 0 und das
    /// Loslassen der Maustaste setzen ihn zurück, damit der nächste Klick nie verloren geht.
    func consumeForceClickPress() -> Bool {
        guard didShowPreviewForCurrentPress else { return false }
        didShowPreviewForCurrentPress = false
        return true
    }

    private func handlePressure(_ event: NSEvent) {
        if event.stage == Self.releasedStage {
            didShowPreviewForCurrentPress = false
            return
        }
        guard event.stage == Self.forceClickStage, !didShowPreviewForCurrentPress, let view else { return }
        guard let link = internalLink(atViewPoint: view.convert(event.locationInWindow, from: nil)) else { return }
        endHover()
        didShowPreviewForCurrentPress = showPreview(for: link)
    }

    // MARK: Ereignisse und Anzeige

    private func handle(_ event: NSEvent) {
        guard let view, event.window === view.window else { return }
        guard !view.isHiddenOrHasHiddenAncestor else {
            // Verborgen (Modus „Nur Editor“): nichts auslösen, nur keinen Force-Click-Merker hängen lassen
            didShowPreviewForCurrentPress = false
            return
        }
        switch event.type {
        case .pressure:
            handlePressure(event)
        case .flagsChanged:
            updateHoverAtMouseLocation(modifiers: event.modifierFlags)
        case .keyDown:
            dismiss()
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            // Kommt das Mausereignis erst nach Stufe 2 an, gehört es zum Force Click: Vorschau stehen lassen
            guard !didShowPreviewForCurrentPress else { return }
            dismiss()
        case .leftMouseUp:
            // Falls PDFKit den Druck schon vor Stufe 2 bekommen hat, darf der Merker nicht am nächsten Klick hängen
            didShowPreviewForCurrentPress = false
        case .scrollWheel:
            dismiss()
        default:
            break
        }
    }

    /// Wartende und gezeigte Vorschau beenden, gleich welcher Auslöser
    private func dismiss() {
        endHover()
        closePreview()
    }

    /// Immer `close()`, auch wenn sich das transiente Popover schon selbst geschlossen hat: Der Presenter gibt so seine
    /// Referenzen frei
    private func closePreview() {
        presenter.close()
    }

    /// Link-Suche über die Annotationen der Seite (`PDFLinks`), nicht `page.annotation(at:)`: Eine Markierung verdeckt dort den Link
    private func internalLink(atViewPoint point: CGPoint) -> PDFAnnotation? {
        guard let view, !view.isHiddenOrHasHiddenAncestor, view.bounds.contains(point),
              let page = view.page(for: point, nearest: false),
              let link = PDFLinks.link(at: view.convert(point, to: page), on: page),
              PDFLinks.internalTarget(of: link) != nil else { return nil }
        return link
    }

    @discardableResult
    private func showPreview(for link: PDFAnnotation) -> Bool {
        // Auch hier prüfen: Die ⌥-Wartezeit kann ablaufen, nachdem die View verborgen wurde
        guard let view, !view.isHiddenOrHasHiddenAncestor, let page = link.page,
              let destination = PDFLinks.internalTarget(of: link) else { return false }
        return presenter.show(destination, from: view, relativeTo: view.convert(link.bounds, from: page))
    }
}
