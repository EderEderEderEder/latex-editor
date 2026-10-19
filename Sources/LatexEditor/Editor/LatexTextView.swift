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
