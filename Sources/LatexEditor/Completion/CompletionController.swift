import AppKit

/// Steuert die Vervollständigung im Editor: erkennt beim Tippen den Kontext, zeigt das Popup unter dem
/// Cursor, filtert beim Weitertippen und übernimmt einen Vorschlag als einen Undo-Schritt.
/// Pro Tastendruck läuft nur die Kontexterkennung auf der aktuellen Zeile.
@MainActor
final class CompletionController {
    static let visibleRows = 8
    static let width: CGFloat = 400
    /// Abstand zwischen Textzeile und Popup
    private static let gap: CGFloat = 2
    /// Das Popup beginnt etwas links vom Wort, damit der Text über dem Symbol der Zeile steht
    private static let horizontalInset: CGFloat = 26

    var provider: CompletionProvider?
    var isAutomatic: () -> Bool = { CompletionSettings.isAutomatic }
    /// In Tests aus: Das Popup ist ein eigenes Fenster und erschiene sonst auf dem Bildschirm.
    var presentsPanel = true

    private weak var textView: NSTextView?
    private let currentSession: () -> DocumentSession?
    private let model = CompletionListModel()
    private lazy var panel = CompletionPanel(model: model)
    private var context: CompletionContext?
    private var candidates: [CompletionItem] = []
    private var candidatesKind: CompletionContext.Kind?
    private var isApplying = false
    private var isShowing = false

    init(textView: NSTextView, session: @escaping () -> DocumentSession?) {
        self.textView = textView
        currentSession = session
        model.onChoose = { [weak self] index in self?.accept(at: index) }
        observe(textView)
    }

    var isVisible: Bool { isShowing }
    /// Für Tests und das Popup-Bild
    var visibleItems: [CompletionItem] { isVisible ? model.items : [] }
    var selectedIndex: Int { model.selectedIndex }
    var popupWindow: NSWindow { panel }

    // MARK: Ereignisse aus dem Editor

    /// Nach einer Bearbeitung durch den Nutzer. `insertedText`: was getippt wurde (`nil`/leer bei Löschen).
    func textDidChange(insertedText: String?) {
        guard !isApplying else { return }
        guard let detected = currentContext() else {
            close()
            return
        }
        if isVisible {
            show(detected)
            return
        }
        // Ein Zeichen; ein automatisch geschlossenes Paar wie `{}` zählt als getippte öffnende Klammer.
        guard isAutomatic(), let insertedText, (insertedText as NSString).length == 1 || TextEditing.isAutoPair(insertedText) else { return }
        switch detected.kind {
        case .command where !detected.prefix.isEmpty: show(detected)
        case .argument, .option: show(detected)
        default: break
        }
    }

    /// Cursor bewegt (Klick, Pfeiltasten): außerhalb des getippten Worts schließt das Popup.
    func selectionDidChange() {
        guard isVisible, !isApplying else { return }
        guard let detected = currentContext(), detected.range.location == context?.range.location else {
            close()
            return
        }
    }

    /// Tastenbefehle, solange das Popup offen ist. Esc und `complete:` öffnen es von Hand.
    func handle(_ selector: Selector) -> Bool {
        if selector == #selector(NSResponder.complete(_:)) {
            trigger()
            return true
        }
        guard isVisible else {
            guard selector == #selector(NSResponder.cancelOperation(_:)) else { return false }
            trigger()
            return true
        }
        switch selector {
        case #selector(NSResponder.moveDown(_:)): moveSelection(by: 1)
        case #selector(NSResponder.moveUp(_:)): moveSelection(by: -1)
        case #selector(NSResponder.pageDown(_:)), #selector(NSResponder.scrollPageDown(_:)): moveSelection(by: Self.visibleRows)
        case #selector(NSResponder.pageUp(_:)), #selector(NSResponder.scrollPageUp(_:)): moveSelection(by: -Self.visibleRows)
        case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertTab(_:)): accept(at: model.selectedIndex)
        case #selector(NSResponder.cancelOperation(_:)): close()
        default: return false
        }
        return true
    }

    /// Von Hand (⌃Leertaste, Esc): auch ohne getippten Buchstaben.
    func trigger() {
        guard let detected = currentContext() else { return }
        show(detected, recomputing: true)
    }

    func close() {
        isShowing = false
        context = nil
        candidates = []
        candidatesKind = nil
        guard panel.isVisible else { return }
        panel.parent?.removeChildWindow(panel)
        panel.orderOut(nil)
    }

    // MARK: Anzeigen

    private func show(_ detected: CompletionContext, recomputing: Bool = false) {
        guard let provider, let textView, let storage = textView.textStorage else { return }
        if recomputing || detected.kind != candidatesKind {
            candidates = provider.items(for: detected, document: storage.mutableString, cursor: NSMaxRange(detected.range))
            candidatesKind = detected.kind
        }
        let ranked = CompletionMatcher.rank(candidates, prefix: detected.prefix)
        guard !ranked.isEmpty else {
            close()
            return
        }
        let keepsSelection = context?.range.location == detected.range.location && model.items.first?.id == ranked.first?.id
        context = detected
        if model.items != ranked { model.items = ranked }
        if !keepsSelection || model.selectedIndex >= ranked.count { model.selectedIndex = 0 }
        position(for: detected, in: textView)
    }

    private func position(for detected: CompletionContext, in textView: NSTextView) {
        guard let window = textView.window else { return }
        let caret = textView.firstRect(forCharacterRange: NSRange(location: detected.range.location, length: 0), actualRange: nil)
        let rows = CGFloat(min(model.items.count, Self.visibleRows))
        let height = rows * CompletionListView.rowHeight + 2 * CompletionListView.padding
        var origin = NSPoint(x: caret.minX - Self.horizontalInset, y: caret.minY - height - Self.gap)
        if let screen = window.screen ?? NSScreen.main, origin.y < screen.visibleFrame.minY {
            origin.y = caret.maxY + Self.gap
        }
        panel.setFrame(NSRect(origin: origin, size: NSSize(width: Self.width, height: height)), display: true)
        isShowing = true
        guard presentsPanel else { return }
        if panel.parent == nil { window.addChildWindow(panel, ordered: .above) }
        panel.orderFront(nil)
    }

    private func moveSelection(by offset: Int) {
        guard !model.items.isEmpty else { return }
        model.selectedIndex = min(max(model.selectedIndex + offset, 0), model.items.count - 1)
    }

    // MARK: Übernehmen

    private func accept(at index: Int) {
        guard let context, model.items.indices.contains(index), let textView, let storage = textView.textStorage else { return }
        let item = model.items[index]
        let edit = CompletionApplier.edit(for: item, context: context, in: storage.mutableString)
        close()
        isApplying = true
        defer { isApplying = false }
        guard textView.shouldChangeText(in: edit.range, replacementString: edit.text) else { return }
        storage.replaceCharacters(in: edit.range, with: edit.text)
        textView.didChangeText()
        textView.undoManager?.setActionName("Vervollständigen")
        textView.setSelectedRange(edit.selection)
        textView.scrollRangeToVisible(edit.selection)
        // `\ref{}`, `\begin{}`, `width=` …: gleich die passenden Vorschläge zeigen
        if edit.opensFollowUp {
            DispatchQueue.main.async { [weak self] in self?.trigger() }
        }
    }

    // MARK: Kontext

    private func currentContext() -> CompletionContext? {
        guard let textView, let session = currentSession(), let storage = textView.textStorage,
              storage === session.textStorage else { return nil }
        let selection = textView.selectedRange()
        guard selection.length == 0, selection.location <= storage.length else { return nil }
        let cursor = selection.location
        let lineStart = session.lineIndex.start(ofLine: session.lineIndex.clampedLine(containing: cursor))
        guard let detected = CompletionContextDetector.detect(in: storage.mutableString, cursor: cursor, lineStart: lineStart),
              !isInVerbatim(session, cursor: cursor) else { return nil }
        return detected
    }

    private func isInVerbatim(_ session: DocumentSession, cursor: Int) -> Bool {
        guard cursor > 0 else { return false }
        return session.syntaxTokens(in: NSRange(location: cursor - 1, length: 1)).contains { token in
            token.kind == .verbatim && token.location < cursor && token.location + token.length >= cursor
        }
    }

    // MARK: Schließen bei Fokus- oder Fensterwechsel

    private func observe(_ textView: NSTextView) {
        let center = NotificationCenter.default
        center.addObserver(forName: NSWindow.didResignKeyNotification, object: nil, queue: .main) { [weak self] notification in
            let resigned = (notification.object as AnyObject?).map(ObjectIdentifier.init)
            MainActor.assumeIsolated {
                guard let self, let window = self.textView?.window, resigned == ObjectIdentifier(window) else { return }
                self.close()
            }
        }
    }
}
