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
        view.store = store
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        context.coordinator.attach(view)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        let isHidden = !context.environment.isWorkspacePaneShown
        if view.isHidden != isHidden { view.isHidden = isHidden }
        context.coordinator.reloadIfNeeded(in: view, url: url, token: reloadToken)
    }

    /// Beim Wechsel zu „Nur Editor“ verschwindet die View ohne Nachfolger; Seite, Position und Zoom bleiben im Store.
    static func dismantleNSView(_ view: PDFView, coordinator: PDFCoordinator) {
        coordinator.saveStateIfCurrent(view)
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
        observers.append(NotificationCenter.default.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.store.syncSelection() }
        })
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
        store.markAnnotations = []
        store.syncStatus()
        store.onDocumentLoaded?()
    }

    /// Neue View in den Store. SwiftUI legt beim Wechsel der Ansicht (Geteilt ↔ Nur PDF) die neue View an, **bevor** es
    /// die alte abbaut (gemessen); deshalb übernimmt sie den Stand direkt von der alten, solange es die noch gibt.
    func attach(_ view: PDFView) {
        if let previous = store.pdfView, previous !== view { saveState(of: previous) }
        store.pdfView = view
        observe(view)
    }

    func saveState(of view: PDFView) {
        guard let state = captureState(of: view) else { return }
        store.savedViewState = state
    }

    /// Nur, wenn keine neuere View übernommen hat (sonst überschriebe der alte Stand den schon übergebenen)
    func saveStateIfCurrent(_ view: PDFView) {
        guard store.pdfView == nil || store.pdfView === view else { return }
        saveState(of: view)
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

/// PDFView mit ⌘-Klick für die Rückwärtssuche (PDF → Quelltext), Einträgen für Markierungen im Rechtsklickmenü und
/// Klick auf eine Markierung. Normale Klicks bleiben unverändert.
final class SyncTeXPDFView: PDFView {
    private static let clickTolerance: CGFloat = 4

    var onCommandClick: ((PDFPage, CGPoint) -> Void)?
    weak var store: PDFPreviewStore?
    /// Die Markierung und die Stelle unter dem Rechtsklick, solange das Menü offen ist
    private var menuMarkID: UUID?
    private var menuClick: (page: PDFPage, point: CGPoint)?
    nonisolated(unsafe) private var mouseMonitor: Any?
    private var mouseDownPoint: NSPoint?

    deinit {
        if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
    }

    override func mouseDown(with event: NSEvent) {
        guard event.modifierFlags.contains(.command), let onCommandClick else {
            super.mouseDown(with: event)
            return
        }
        let viewPoint = convert(event.locationInWindow, from: nil)
        guard let page = page(for: viewPoint, nearest: true) else { return }
        onCommandClick(page, convert(viewPoint, to: page))
    }

    // MARK: Klick auf eine Markierung

    /// Ein Klick (ohne Ziehen, ohne Taste) auf eine Markierung zeigt ihr Popover. Ein Beobachter statt `mouseUp`, weil
    /// PDFView die Mausverfolgung selbst übernimmt und das Ende des Klicks nicht an die Unterklasse weitergibt.
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
        mouseMonitor = nil
        guard window != nil else { return }
        mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { [weak self] event in
            self?.track(event)
            return event
        }
    }

    func track(_ event: NSEvent) {
        guard event.window === window else { return }
        let point = convert(event.locationInWindow, from: nil)
        switch event.type {
        case .leftMouseDown:
            let plain = event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty
            mouseDownPoint = bounds.contains(point) && event.clickCount == 1 && plain ? point : nil
        case .leftMouseUp:
            defer { mouseDownPoint = nil }
            guard let down = mouseDownPoint, hypot(point.x - down.x, point.y - down.y) < Self.clickTolerance,
                  currentSelection?.string?.isEmpty != false, let id = markID(atViewPoint: point) else { return }
            store?.onClickMark?(id)
        default:
            break
        }
    }

    func markID(atViewPoint viewPoint: CGPoint) -> UUID? {
        guard let page = page(for: viewPoint, nearest: false) else { return nil }
        let annotation = page.annotation(at: convert(viewPoint, to: page))
        return annotation?.userName.flatMap(UUID.init(uuidString:))
    }

    // MARK: Rechtsklickmenü

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        let viewPoint = convert(event.locationInWindow, from: nil)
        menuMarkID = markID(atViewPoint: viewPoint)
        menuClick = page(for: viewPoint, nearest: false).map { ($0, convert(viewPoint, to: $0)) }
        let hasSelection = currentSelection?.string?.isEmpty == false
        let items = markMenuItems(hasSelection: hasSelection, markID: menuMarkID, canAddNote: menuClick != nil)
        guard !items.isEmpty else { return menu }
        for (offset, item) in (items + [.separator()]).enumerated() { menu.insertItem(item, at: offset) }
        return menu
    }

    /// Auswahl: „Markieren“ (zuletzt benutzte Farbe), „Markieren mit“, „Kommentieren …“. Auf einer Markierung: „Kommentar
    /// bearbeiten …“, „Farbe ändern“, „Markierung entfernen“. Sonst auf dem Papier: „Notiz hier hinzufügen …“.
    func markMenuItems(hasSelection: Bool, markID: UUID?, canAddNote: Bool = false) -> [NSMenuItem] {
        var items: [NSMenuItem] = []
        if hasSelection {
            items.append(NSMenuItem(title: "Markieren", action: #selector(markSelection(_:)), keyEquivalent: ""))
            items.append(colorSubmenuItem(title: "Markieren mit", action: #selector(markSelectionWithColor(_:))))
            items.append(NSMenuItem(title: "Kommentieren …", action: #selector(commentSelection(_:)), keyEquivalent: ""))
        }
        if markID != nil {
            items.append(NSMenuItem(title: "Kommentar bearbeiten …", action: #selector(editComment(_:)), keyEquivalent: ""))
            items.append(colorSubmenuItem(title: "Farbe ändern", action: #selector(recolorMark(_:))))
            items.append(NSMenuItem(title: "Markierung entfernen", action: #selector(removeMark(_:)), keyEquivalent: ""))
        }
        if !hasSelection, markID == nil, canAddNote {
            items.append(NSMenuItem(title: "Notiz hier hinzufügen …", action: #selector(addNote(_:)), keyEquivalent: ""))
        }
        items.forEach { $0.target = self }
        return items
    }

    private func colorSubmenuItem(title: String, action: Selector) -> NSMenuItem {
        let submenu = NSMenu(title: title)
        for color in MarkColor.allCases {
            let item = NSMenuItem(title: color.title, action: action, keyEquivalent: "")
            item.representedObject = color.rawValue
            item.image = color.swatch
            item.target = self
            submenu.addItem(item)
        }
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        return item
    }

    @objc private func markSelection(_ sender: NSMenuItem) { store?.onMarkSelection?(nil) }

    @objc private func commentSelection(_ sender: NSMenuItem) { store?.onCommentSelection?() }

    @objc private func markSelectionWithColor(_ sender: NSMenuItem) {
        guard let color = (sender.representedObject as? String).flatMap(MarkColor.init(rawValue:)) else { return }
        store?.onMarkSelection?(color)
    }

    @objc private func editComment(_ sender: NSMenuItem) {
        guard let id = menuMarkID else { return }
        store?.onClickMark?(id)
    }

    @objc private func recolorMark(_ sender: NSMenuItem) {
        guard let id = menuMarkID, let color = (sender.representedObject as? String).flatMap(MarkColor.init(rawValue:)) else { return }
        store?.onRecolorMark?(id, color)
    }

    @objc private func removeMark(_ sender: NSMenuItem) {
        guard let id = menuMarkID else { return }
        store?.onRemoveMark?(id)
    }

    @objc private func addNote(_ sender: NSMenuItem) {
        guard let click = menuClick else { return }
        store?.onAddNote?(click.page, click.point)
    }
}
