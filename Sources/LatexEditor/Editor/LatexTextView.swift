import AppKit

/// NSTextView mit dezentem Streifen für die aktuelle Zeile und ohne Rechtschreibmarkierungen
/// in LaTeX-Syntax (Befehle, Mathe, Kommentare, Schlüssel-Argumente, Verbatim).
final class LatexTextView: NSTextView {
    /// Statt der eingebauten Wortvervollständigung (Esc, ⌥Esc, F5) die eigene LaTeX-Vervollständigung
    var onCompletionRequested: (() -> Void)?

    override func complete(_ sender: Any?) {
        onCompletionRequested?()
    }

    /// Liefert die Syntax-Tokens der Zeilen, die einen Bereich berühren.
    var syntaxTokensProvider: ((NSRange) -> [SyntaxToken])?

    /// Rechteck der aktuellen logischen Zeile (inklusive umbrochener Folgezeilen), sonst `.zero`.
    private(set) var currentLineRect = NSRect.zero
    private var isCurrentLineUpdateScheduled = false

    // MARK: Aktuelle Zeile

    override func drawBackground(in rect: NSRect) {
        super.drawBackground(in: rect)
        let band = currentLineRect.intersection(rect)
        guard !band.isEmpty else { return }
        EditorAppearance.currentLineColor.setFill()
        band.fill(using: .sourceOver)
    }

    override func setSelectedRanges(
        _ ranges: [NSValue],
        affinity: NSSelectionAffinity,
        stillSelecting stillSelectingFlag: Bool
    ) {
        super.setSelectedRanges(ranges, affinity: affinity, stillSelecting: stillSelectingFlag)
        scheduleCurrentLineHighlightUpdate()
    }

    override func didChangeText() {
        super.didChangeText()
        scheduleCurrentLineHighlightUpdate()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        scheduleCurrentLineHighlightUpdate()
    }

    /// Berechnet den Streifen erst im nächsten Runloop-Durchlauf. Die Berechnung braucht Text-Layout
    /// und darf deshalb nie mitten in einem View-Layout (setFrameSize, updateNSView) laufen.
    func scheduleCurrentLineHighlightUpdate() {
        guard !isCurrentLineUpdateScheduled else { return }
        isCurrentLineUpdateScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.isCurrentLineUpdateScheduled = false
            self.updateCurrentLineHighlight()
        }
    }

    func updateCurrentLineHighlight() {
        let newRect = computeCurrentLineRect()
        guard newRect != currentLineRect else { return }
        setNeedsDisplay(currentLineRect)
        currentLineRect = newRect
        setNeedsDisplay(newRect)
    }

    private func computeCurrentLineRect() -> NSRect {
        guard let layoutManager, let textContainer, let storage = textStorage else { return .zero }
        let selection = selectedRange().clamped(toLength: storage.length)
        guard selection.length == 0 else { return .zero }
        let lineRange = storage.mutableString.lineRange(for: selection)
        var rect: NSRect
        if lineRange.length == 0 {
            rect = layoutManager.extraLineFragmentRect
        } else {
            let glyphs = layoutManager.glyphRange(forCharacterRange: lineRange, actualCharacterRange: nil)
            guard glyphs.length > 0 else { return .zero }
            let first = layoutManager.lineFragmentRect(forGlyphAt: glyphs.location, effectiveRange: nil)
            let last = layoutManager.lineFragmentRect(forGlyphAt: NSMaxRange(glyphs) - 1, effectiveRange: nil)
            rect = first.union(last)
        }
        guard !rect.isEmpty, textContainer.size.width > 0 else { return .zero }
        return NSRect(x: 0, y: rect.minY + textContainerOrigin.y, width: bounds.width, height: rect.height)
    }

    // MARK: Tippen

    /// Einstellung „Klammern automatisch schließen“ (Menü Bearbeiten)
    static let autoPairKey = "autoPairBrackets"
    private var isAutoPairing: Bool { UserDefaults.standard.object(forKey: Self.autoPairKey) as? Bool ?? true }

    override func insertText(_ string: Any, replacementRange: NSRange) {
        // Nur echtes Tippen (kein Ersetzen per IME, kein Einfügen aus der Zwischenablage)
        guard isAutoPairing, replacementRange.location == NSNotFound, !hasMarkedText(), let character = string as? String,
              (character as NSString).length == 1, let storage = textStorage,
              let edit = TextEditing.typed(character, in: storage.mutableString, selection: selectedRange()) else {
            super.insertText(string, replacementRange: replacementRange)
            return
        }
        apply(edit, actionName: "Tippen")
    }

    override func deleteBackward(_ sender: Any?) {
        guard isAutoPairing, let storage = textStorage,
              let edit = TextEditing.deleteBackward(in: storage.mutableString, selection: selectedRange()) else {
            super.deleteBackward(sender)
            return
        }
        apply(edit, actionName: "Löschen")
    }

    /// Enter: Einrückung übernehmen, `\end{…}` ergänzen, Listen mit `\item` fortsetzen.
    override func insertNewline(_ sender: Any?) {
        guard let storage = textStorage, !hasMarkedText() else {
            super.insertNewline(sender)
            return
        }
        apply(TextEditing.newline(in: storage.mutableString, selection: selectedRange()), actionName: "Zeilenumbruch")
    }

    /// Tab mit mehrzeiliger Auswahl rückt die Zeilen ein, sonst normaler Tabulator.
    override func insertTab(_ sender: Any?) {
        guard let storage = textStorage, spansLines(selectedRange(), in: storage.mutableString) else {
            super.insertTab(sender)
            return
        }
        indentLines(sender)
    }

    override func insertBacktab(_ sender: Any?) {
        outdentLines(sender)
    }

    private func spansLines(_ selection: NSRange, in text: NSString) -> Bool {
        selection.length > 0 && text.substring(with: selection).contains("\n")
    }

    // MARK: ⌘-Klick auf Verweise

    /// ⌘-Klick auf `\ref`, `\cite`, `\input` …: zum Ziel springen
    var onJumpToTarget: ((JumpTarget) -> Void)?
    /// „Label umbenennen …“ im Kontextmenü
    var onRenameLabel: ((String) -> Void)?
    private var jumpTrackingArea: NSTrackingArea?

    override func mouseDown(with event: NSEvent) {
        guard let target = commandClickTarget(for: event) else {
            super.mouseDown(with: event)
            return
        }
        onJumpToTarget?(target)
    }

    /// Das Ziel, wenn der Klick ein ⌘-Klick (ohne weitere Taste) auf einen Verweis, ein Zitat oder einen Dateipfad ist.
    func commandClickTarget(for event: NSEvent) -> JumpTarget? {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, onJumpToTarget != nil else { return nil }
        return jumpTarget(atWindowPoint: event.locationInWindow)
    }

    private func jumpTarget(atWindowPoint point: NSPoint) -> JumpTarget? {
        guard let storage = textStorage else { return nil }
        let local = convert(point, from: nil)
        guard bounds.contains(local) else { return nil }
        return JumpTargetFinder.target(at: characterIndexForInsertion(at: local), in: storage.mutableString)?.target
    }

    /// Mit gedrückter ⌘-Taste über einem Ziel: Hand statt Textcursor.
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let jumpTrackingArea { removeTrackingArea(jumpTrackingArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        jumpTrackingArea = area
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        updateJumpCursor(flags: event.modifierFlags, windowPoint: event.locationInWindow)
    }

    override func flagsChanged(with event: NSEvent) {
        super.flagsChanged(with: event)
        guard let window else { return }
        if !updateJumpCursor(flags: event.modifierFlags, windowPoint: window.mouseLocationOutsideOfEventStream) {
            // ⌘ losgelassen: den Textcursor wieder von AppKit bestimmen lassen
            window.invalidateCursorRects(for: self)
        }
    }

    @discardableResult
    private func updateJumpCursor(flags: NSEvent.ModifierFlags, windowPoint: NSPoint) -> Bool {
        guard flags.intersection(.deviceIndependentFlagsMask) == .command, onJumpToTarget != nil,
              jumpTarget(atWindowPoint: windowPoint) != nil else { return false }
        NSCursor.pointingHand.set()
        return true
    }

    /// Rechtsklick auf ein Label oder einen Verweis: „Label umbenennen …“
    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event)
        guard onRenameLabel != nil, let storage = textStorage else { return menu }
        let location = characterIndexForInsertion(at: convert(event.locationInWindow, from: nil))
        guard let key = JumpTargetFinder.label(at: location, in: storage.mutableString) else { return menu }
        let item = NSMenuItem(title: "Label „\(key)“ umbenennen …", action: #selector(renameLabelFromMenu(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = key
        menu?.insertItem(.separator(), at: 0)
        menu?.insertItem(item, at: 0)
        return menu
    }

    @objc private func renameLabelFromMenu(_ sender: NSMenuItem) {
        guard let key = sender.representedObject as? String else { return }
        onRenameLabel?(key)
    }

    // MARK: Suchen im Editor

    /// ⌘F, ⌥⌘F (Ersetzen), ⌘G, ⇧⌘G und ⌘E gehen zuerst durch die Textansicht und erst danach ins Menü: So
    /// funktionieren sie auch, wenn das Menü der App keinen Suchen-Eintrag mit diesem Kürzel hat. ⇧⌘F (Projekt) bleibt im Menü.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard let key = event.charactersIgnoringModifiers, let action = Self.findAction(key: key, flags: event.modifierFlags) else {
            return super.performKeyEquivalent(with: event)
        }
        showFinder(action)
        return true
    }

    static func findAction(key: String, flags: NSEvent.ModifierFlags) -> NSTextFinder.Action? {
        let modifiers = flags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
        switch (key.lowercased(), modifiers) {
        case ("f", .command): return .showFindInterface
        case ("f", [.command, .option]): return .showReplaceInterface
        case ("g", .command): return .nextMatch
        case ("g", [.command, .shift]): return .previousMatch
        case ("e", .command): return .setSearchString
        default: return nil
        }
    }

    /// `performTextFinderAction` liest die Aktion aus dem `tag` des Absenders.
    func showFinder(_ action: NSTextFinder.Action) {
        let sender = NSMenuItem()
        sender.tag = action.rawValue
        performTextFinderAction(sender)
    }

    // MARK: Menübefehle (über die Responder-Kette, wirken auf den Editor mit dem Fokus)

    @objc func toggleComment(_ sender: Any?) { perform(TextEditing.toggleComment, actionName: "Kommentar") }
    @objc func indentLines(_ sender: Any?) { perform(TextEditing.indent, actionName: "Einrücken") }
    @objc func outdentLines(_ sender: Any?) { perform(TextEditing.outdent, actionName: "Ausrücken") }
    @objc func moveLinesUp(_ sender: Any?) { perform({ TextEditing.moveLines(up: true, in: $0, selection: $1) }, actionName: "Zeilen verschieben") }
    @objc func moveLinesDown(_ sender: Any?) { perform({ TextEditing.moveLines(up: false, in: $0, selection: $1) }, actionName: "Zeilen verschieben") }
    @objc func duplicateLines(_ sender: Any?) { perform(TextEditing.duplicateLines, actionName: "Zeilen verdoppeln") }
    @objc func deleteLines(_ sender: Any?) { perform(TextEditing.deleteLines, actionName: "Zeilen löschen") }
    @objc func formatBold(_ sender: Any?) { perform({ TextEditing.wrap("textbf", in: $0, selection: $1) }, actionName: "Fett") }
    @objc func formatEmphasis(_ sender: Any?) { perform({ TextEditing.wrap("emph", in: $0, selection: $1) }, actionName: "Hervorheben") }
    @objc func formatMonospace(_ sender: Any?) { perform({ TextEditing.wrap("texttt", in: $0, selection: $1) }, actionName: "Schreibmaschine") }

    private func perform(_ operation: (NSString, NSRange) -> TextEdit?, actionName: String) {
        guard isEditable, let storage = textStorage, let edit = operation(storage.mutableString, selectedRange()) else { return }
        apply(edit, actionName: actionName)
    }

    /// Eine Bearbeitung als ein Undo-Schritt, über den normalen Weg (Highlighting, Zeilenindex, Delegate).
    func apply(_ edit: TextEdit, actionName: String) {
        guard let storage = textStorage else { return }
        guard edit.range.length > 0 || !edit.text.isEmpty else {
            setSelectedRange(edit.selection.clamped(toLength: storage.length))
            return
        }
        guard shouldChangeText(in: edit.range, replacementString: edit.text) else { return }
        storage.replaceCharacters(in: edit.range, with: edit.text)
        // Auswahl vor `didChangeText` setzen, wie NSTextView beim Tippen: Wer auf die Änderung reagiert
        // (z. B. die Vervollständigung), sieht schon den neuen Cursor.
        let selection = edit.selection.clamped(toLength: storage.length)
        setSelectedRange(selection)
        didChangeText()
        undoManager?.setActionName(actionName)
        scrollRangeToVisible(selection)
    }

    // MARK: Rechtschreibung

    override func setSpellingState(_ value: Int, range charRange: NSRange) {
        if value != 0, isSyntax(charRange) { return }
        super.setSpellingState(value, range: charRange)
    }

    func isSyntax(_ range: NSRange) -> Bool {
        syntaxTokensProvider?(range).containsOverlap(with: range) ?? false
    }
}
