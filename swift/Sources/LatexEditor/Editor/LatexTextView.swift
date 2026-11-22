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

    /// Zugeklappte Bereiche der angezeigten Datei (siehe `LatexTextView+Folding`)
    var foldState: FoldState?

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        drawFoldPlaceholders(in: dirtyRect)
    }

    /// Rechteck der aktuellen logischen Zeile (inklusive umbrochener Folgezeilen), sonst `.zero`.
    private(set) var currentLineRect = NSRect.zero
    private var isCurrentLineUpdateScheduled = false

    // MARK: Aktuelle Zeile

    /// Spalte der Hilfslinie (nur bei Festbreitenschrift sinnvoll); `nil`: keine Linie
    var columnGuideColumn: Int? {
        didSet { if columnGuideColumn != oldValue { needsDisplay = true } }
    }

    override func drawBackground(in rect: NSRect) {
        super.drawBackground(in: rect)
        drawColumnGuide(in: rect)
        let band = currentLineRect.intersection(rect)
        guard !band.isEmpty else { return }
        EditorAppearance.currentLineColor.setFill()
        band.fill(using: .sourceOver)
    }

    /// Eine feine, durchgehende Linie hinter dem Text bei Spalte N, damit man Zeilenlängen einschätzen kann
    private func drawColumnGuide(in rect: NSRect) {
        guard let column = columnGuideColumn, let textContainer else { return }
        let glyphWidth = ("0" as NSString).size(withAttributes: [.font: font ?? EditorAppearance.font]).width
        let x = (textContainerOrigin.x + textContainer.lineFragmentPadding + glyphWidth * CGFloat(column)).rounded() + 0.5
        guard x >= rect.minX - 1, x <= rect.maxX + 1, x < bounds.width else { return }
        NSColor.separatorColor.setFill()
        NSRect(x: x - 0.5, y: rect.minY, width: 1, height: rect.height).fill(using: .sourceOver)
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
        closeImagePreview()
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
        guard highlightsCurrentLine else { return .zero }
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
        closeImagePreview()
        // Nur echtes Tippen (kein Ersetzen per IME, kein Einfügen aus der Zwischenablage)
        let isTyping = replacementRange.location == NSNotFound && !hasMarkedText()
        let character = string as? String
        let wordEnd = isTyping && character.map(Self.endsWord) == true ? collapsedCursor : nil
        if isAutoPairing, isTyping, let character, (character as NSString).length == 1, let storage = textStorage,
           let edit = TextEditing.typed(character, in: storage.mutableString, selection: selectedRange()) {
            apply(edit, actionName: "Tippen")
        } else {
            super.insertText(string, replacementRange: replacementRange)
        }
        if let wordEnd { scheduleCapitalization(wordEndingAt: wordEnd) }
    }

    override func deleteBackward(_ sender: Any?) {
        unfoldBeforeCaretForDeletion()
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
        let wordEnd = collapsedCursor
        apply(TextEditing.newline(in: storage.mutableString, selection: selectedRange(), unit: indentUnit), actionName: "Zeilenumbruch")
        if let wordEnd { scheduleCapitalization(wordEndingAt: wordEnd) }
    }

    // MARK: Groß-/Kleinschreibung

    /// Nur in .tex-Dateien (in .bib sind Titel absichtlich so geschrieben, wie sie sind)
    var allowsProseCorrection: () -> Bool = { false }
    /// Nach diesen Zeichen ist ein Wort fertig getippt
    private static let wordTerminators: Set<String> = [" ", ",", ".", ";", ":", "!", "?", ")"]
    private static let newline = UInt16(UInt8(ascii: "\n"))

    private static func endsWord(_ typed: String) -> Bool {
        wordTerminators.contains(typed)
    }

    private var collapsedCursor: Int? {
        let selection = selectedRange()
        return selection.length == 0 ? selection.location : nil
    }

    /// Satzanfang groß, „ZWei“ Großbuchstaben, als eigener Undo-Schritt: Der UndoManager gruppiert pro Ereignis, deshalb
    /// erst im nächsten Durchlauf (sonst nähme ⌘Z das getippte Zeichen mit zurück). Bis dahin kann schon weitergetippt
    /// worden sein, daher wird dort alles frisch geprüft.
    private func scheduleCapitalization(wordEndingAt end: Int) {
        guard Capitalization.isAutomatic, allowsProseCorrection(), let storage = textStorage else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.textStorage === storage else { return }
            self.correctCapitalization(wordEndingAt: end, in: storage)
        }
    }

    /// Nur im Fließtext (nicht in Befehlen, Schlüsseln, Mathe, Kommentaren, Code) und nur, wenn hinter dem Wort noch
    /// das Zeichen steht, das es beendet hat.
    private func correctCapitalization(wordEndingAt end: Int, in storage: NSTextStorage) {
        let text = storage.mutableString
        guard end < text.length, Self.endsWord(text.substring(with: NSRange(location: end, length: 1))) || text.character(at: end) == Self.newline,
              let correction = Capitalization.correction(forWordEndingAt: end, in: text),
              !isSyntax(correction.range), !LatexEnvironments.isInsideCode(at: correction.range.location, in: text) else { return }
        replaceKeepingCursor(correction.range, with: correction.replacement, actionName: "Autokorrektur")
    }

    /// Ersetzt mit eigenem Rückgängig-Schritt: Das Rückgängig von NSTextView würde danach das Wort markieren, und
    /// Weitertippen überschriebe es. So bleibt der Cursor in beide Richtungen, wo er ist (Wiederholen inklusive).
    private func replaceKeepingCursor(_ range: NSRange, with replacement: String, actionName: String) {
        guard let storage = textStorage, let undoManager, NSMaxRange(range) <= storage.length else { return }
        let original = storage.mutableString.substring(with: range)
        let selection = selectedRange()
        let delta = (replacement as NSString).length - range.length
        let cursor = selection.location >= NSMaxRange(range) ? selection.location + delta : selection.location
        breakUndoCoalescing()
        undoManager.disableUndoRegistration()
        apply(TextEdit(range: range, text: replacement, selection: NSRange(location: cursor, length: selection.length)), actionName: actionName)
        undoManager.enableUndoRegistration()
        let replaced = NSRange(location: range.location, length: (replacement as NSString).length)
        undoManager.registerUndo(withTarget: self) { textView in
            textView.replaceKeepingCursor(replaced, with: original, actionName: actionName)
        }
        undoManager.setActionName(actionName)
        breakUndoCoalescing()
    }

    /// Einrückung aus den Einstellungen (setzt der Coordinator): Tab-Taste, ⌘]/⌘[, Enter
    var indentUnit = TextEditing.tabUnit
    /// „Aktuelle Zeile hervorheben“ (setzt der Coordinator)
    var highlightsCurrentLine = true {
        didSet { if highlightsCurrentLine != oldValue { scheduleCurrentLineHighlightUpdate() } }
    }

    /// Tab mit mehrzeiliger Auswahl rückt die Zeilen ein, sonst ein Tabulator bzw. die eingestellten Leerzeichen.
    override func insertTab(_ sender: Any?) {
        guard let storage = textStorage, spansLines(selectedRange(), in: storage.mutableString) else {
            if indentUnit == TextEditing.tabUnit || hasMarkedText() {
                super.insertTab(sender)
            } else {
                insertText(indentUnit, replacementRange: selectedRange())
            }
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
    /// ⌘-Klick auf eine andere Stelle: im PDF zeigen (Zeichenposition)
    var onShowInPDF: ((Int) -> Void)?
    /// „Umbenennen …“ im Kontextmenü: Möglichkeiten an einer Zeichenposition und Ausführen
    var renameScopes: ((Int) -> [RenameScope])?
    var onRename: ((RenameScope) -> Void)?
    /// „Verwendungen anzeigen“: Name und Stelle (UTF-16) im Text
    var onShowUsages: ((RenameSubject, Int) -> Void)?
    private var jumpTrackingArea: NSTrackingArea?

    override func mouseDown(with event: NSEvent) {
        closeImagePreview()
        if unfoldPlaceholder(atWindowPoint: event.locationInWindow) { return }
        if let target = commandClickTarget(for: event) {
            onJumpToTarget?(target)
        } else if let location = commandClickLocation(for: event) {
            setSelectedRange(NSRange(location: location, length: 0))
            onShowInPDF?(location)
        } else {
            super.mouseDown(with: event)
        }
    }

    /// Zeichenposition eines ⌘-Klicks (ohne weitere Taste) auf eine Stelle ohne Sprungziel: dort im PDF zeigen.
    func commandClickLocation(for event: NSEvent) -> Int? {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, onShowInPDF != nil else { return nil }
        let local = convert(event.locationInWindow, from: nil)
        guard bounds.contains(local) else { return nil }
        return characterIndexForInsertion(at: local)
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
        let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        jumpTrackingArea = area
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        updateJumpCursor(flags: event.modifierFlags, windowPoint: event.locationInWindow)
        scheduleImagePreview(atWindowPoint: event.locationInWindow)
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        closeImagePreview()
    }

    // MARK: Bildvorschau über `\includegraphics{…}`

    /// Datei zu einem Pfad im Text (Projekt, `\graphicspath`); gesetzt vom Editor
    var imageResolver: ((String) -> URL?)?
    private let imagePresenter = ImagePopoverPresenter()
    private var imagePreviewTask: Task<Void, Never>?
    private static let imagePreviewDelay = Duration.milliseconds(600)

    /// Zeigt nach kurzer Ruhe der Maus auf dem Pfad die Vorschau; sobald die Maus den Pfad verlässt, verschwindet sie.
    private func scheduleImagePreview(atWindowPoint point: NSPoint) {
        imagePreviewTask?.cancel()
        guard let hit = imagePathHit(atWindowPoint: point) else {
            if imagePresenter.shownURL != nil { closeImagePreview() }
            return
        }
        guard let url = imageResolver?(hit.path) else {
            closeImagePreview()
            return
        }
        guard imagePresenter.shownURL != url else { return }
        imagePreviewTask = Task { [weak self] in
            try? await Task.sleep(for: Self.imagePreviewDelay)
            guard !Task.isCancelled, let self, let rect = self.rect(forCharacters: hit.range) else { return }
            self.imagePresenter.present(url, relativePath: hit.path, from: self, at: rect)
        }
    }

    private func imagePathHit(atWindowPoint point: NSPoint) -> (path: String, range: NSRange)? {
        guard imageResolver != nil, let storage = textStorage, storage.length > 0 else { return nil }
        let local = convert(point, from: nil)
        guard visibleRect.contains(local) else { return nil }
        return GraphicsResolver.path(at: characterIndexForInsertion(at: local), in: storage.mutableString)
    }

    /// Welches Bild die Vorschau gerade zeigt (für Tests)
    var shownImagePreviewURL: URL? { imagePresenter.shownURL }

    func closeImagePreview() {
        imagePreviewTask?.cancel()
        imagePresenter.close()
    }

    private func rect(forCharacters range: NSRange) -> NSRect? {
        guard let layoutManager, let textContainer else { return nil }
        let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        var rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
        rect.origin.x += textContainerOrigin.x
        rect.origin.y += textContainerOrigin.y
        return rect
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

    /// Rechtsklick auf ein Label, einen Literaturschlüssel, eine Abkürzung, einen eigenen Befehl oder `\begin`/`\end`:
    /// „… umbenennen …“ (bei Umgebungen zwei Einträge: dieses Paar oder überall)
    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event)
        guard let menu, let renameScopes else { return menu }
        let location = characterIndexForInsertion(at: convert(event.locationInWindow, from: nil))
        let scopes = renameScopes(location)
        guard !scopes.isEmpty else { return menu }
        menu.insertItem(.separator(), at: 0)
        for scope in scopes.reversed() {
            guard case let .project(subject) = scope else { continue }
            let item = NSMenuItem(title: "Verwendungen von \(subject.displayName) anzeigen …", action: #selector(showUsagesFromMenu(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = UsageRequest(subject: subject, location: location)
            menu.insertItem(item, at: 0)
        }
        for scope in scopes.reversed() {
            let item = NSMenuItem(title: scope.menuTitle, action: #selector(renameFromMenu(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = scope
            menu.insertItem(item, at: 0)
        }
        return menu
    }

    private final class UsageRequest: NSObject {
        let subject: RenameSubject
        let location: Int

        init(subject: RenameSubject, location: Int) {
            self.subject = subject
            self.location = location
        }
    }

    @objc private func showUsagesFromMenu(_ sender: NSMenuItem) {
        guard let request = sender.representedObject as? UsageRequest else { return }
        onShowUsages?(request.subject, request.location)
    }

    /// Menü Bearbeiten › Verwendungen anzeigen (⌥⌘U): der Name unter dem Cursor
    @objc func showUsages(_ sender: Any?) {
        let location = selectedRange().location
        for scope in renameScopes?(location) ?? [] {
            if case let .project(subject) = scope {
                onShowUsages?(subject, location)
                return
            }
        }
        NSSound.beep()
    }

    @objc private func renameFromMenu(_ sender: NSMenuItem) {
        guard let scope = sender.representedObject as? RenameScope else { return }
        onRename?(scope)
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
    @objc func indentLines(_ sender: Any?) {
        perform({ TextEditing.indent(in: $0, selection: $1, unit: indentUnit) }, actionName: "Einrücken")
    }

    @objc func outdentLines(_ sender: Any?) {
        perform({ TextEditing.outdent(in: $0, selection: $1, unit: indentUnit) }, actionName: "Ausrücken")
    }
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
        if value != 0, isSyntax(charRange) || isTechnicalTerm(charRange) { return }
        super.setSpellingState(value, range: charRange)
    }

    /// Fachwort aus dem Standardvokabular (`TechnicalVocabulary`): keine Rechtschreibmarkierung
    func isTechnicalTerm(_ range: NSRange) -> Bool {
        guard let storage = textStorage, NSMaxRange(range) <= storage.length else { return false }
        return SpellingVocabulary.accepts(storage.mutableString.substring(with: range))
    }

    func isSyntax(_ range: NSRange) -> Bool {
        syntaxTokensProvider?(range).containsOverlap(with: range) ?? false
    }
}
