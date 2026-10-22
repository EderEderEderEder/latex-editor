import AppKit

/// Platzhalter „⋯“ hinter einer zugeklappten Kopfzeile
struct FoldPlaceholder: Equatable {
    let rect: NSRect
    /// Ende der Kopfzeile = Anfang des Ausgeblendeten
    let hiddenStart: Int
}

extension LatexTextView {
    private static let placeholderLabel = "⋯"
    private static let placeholderGap: CGFloat = 5
    private static let placeholderPadding: CGFloat = 5
    private static let placeholderRadius: CGFloat = 4
    private static let placeholderBackgroundAlpha: CGFloat = 0.1

    // MARK: Anbindung

    /// Zeigt die zugeklappten Bereiche einer Sitzung: Der Layout-Manager blendet sie über `glyphDelegate` aus, ändert sich
    /// etwas, baut diese Ansicht die betroffenen Zeilen neu auf.
    func attach(folds: FoldState?, glyphDelegate: FoldGlyphDelegate, onRegionsChange: @escaping () -> Void) {
        glyphDelegate.folds = folds
        foldState = folds
        guard let folds else { return }
        folds.onHiddenChange = { [weak self] range in self?.relayoutFolded(range) }
        folds.onRegionsChange = onRegionsChange
        folds.rescanIfNeeded()
    }

    /// Baut Glyphen und Layout der geänderten Zeilen neu auf (ausgeblendet oder wieder sichtbar).
    private func relayoutFolded(_ range: NSRange) {
        guard let layoutManager, let storage = textStorage else { return }
        let lineRange = storage.mutableString.lineRange(for: range.clamped(toLength: storage.length))
        layoutManager.invalidateGlyphs(forCharacterRange: lineRange, changeInLength: 0, actualCharacterRange: nil)
        layoutManager.invalidateLayout(forCharacterRange: lineRange, actualCharacterRange: nil)
        needsDisplay = true
        enclosingScrollView?.verticalRulerView?.needsDisplay = true
        scheduleCurrentLineHighlightUpdate()
    }

    // MARK: Platzhalter

    /// Die Felder der sichtbaren zugeklappten Kopfzeilen (in Koordinaten dieser View)
    func foldPlaceholders(in rect: NSRect) -> [FoldPlaceholder] {
        guard let folds = foldState, folds.hasFolds, let layoutManager, let container = textContainer,
              let storage = textStorage else { return [] }
        let origin = textContainerOrigin
        let glyphs = layoutManager.glyphRange(forBoundingRect: rect.offsetBy(dx: -origin.x, dy: -origin.y), in: container)
        let visible = layoutManager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        let size = placeholderSize()
        return folds.hiddenRanges.compactMap { hidden in
            guard hidden.location >= visible.location, hidden.location <= NSMaxRange(visible), hidden.location < storage.length else { return nil }
            let glyph = layoutManager.glyphIndexForCharacter(at: hidden.location)
            let fragment = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            let x = origin.x + fragment.minX + layoutManager.location(forGlyphAt: glyph).x + Self.placeholderGap
            let y = origin.y + fragment.minY + (fragment.height - size.height) / 2
            return FoldPlaceholder(rect: NSRect(origin: NSPoint(x: x, y: y), size: size), hiddenStart: hidden.location)
        }
    }

    private func placeholderAttributes() -> [NSAttributedString.Key: Any] {
        [.font: font ?? EditorAppearance.font, .foregroundColor: NSColor.secondaryLabelColor]
    }

    private func placeholderSize() -> NSSize {
        let text = (Self.placeholderLabel as NSString).size(withAttributes: placeholderAttributes())
        return NSSize(width: text.width + 2 * Self.placeholderPadding, height: text.height)
    }

    func drawFoldPlaceholders(in dirtyRect: NSRect) {
        let attributes = placeholderAttributes()
        for placeholder in foldPlaceholders(in: dirtyRect) where placeholder.rect.intersects(dirtyRect) {
            NSColor.labelColor.withAlphaComponent(Self.placeholderBackgroundAlpha).setFill()
            NSBezierPath(roundedRect: placeholder.rect, xRadius: Self.placeholderRadius, yRadius: Self.placeholderRadius).fill()
            let point = NSPoint(x: placeholder.rect.minX + Self.placeholderPadding, y: placeholder.rect.minY)
            (Self.placeholderLabel as NSString).draw(at: point, withAttributes: attributes)
        }
    }

    /// Klick auf ein Platzhalter-Feld klappt den Bereich auf. Gibt an, ob der Klick damit erledigt ist.
    func unfoldPlaceholder(atWindowPoint point: NSPoint) -> Bool {
        let local = convert(point, from: nil)
        guard let hit = foldPlaceholders(in: visibleRect).first(where: { $0.rect.contains(local) }) else { return false }
        foldState?.unfold(startingAt: hit.hiddenStart)
        return true
    }

    // MARK: Befehle (Menü „Einklappen“, über die Responder-Kette)

    @objc func foldAtCursor(_ sender: Any?) {
        guard let folds = foldState, let lines = folds.lines?() else { return }
        let line = lines.clampedLine(containing: selectedRange().location)
        guard let region = folds.innermostOpenRegion(containingLine: line, lines: lines) else { return }
        folds.fold(region, lines: lines)
        moveCaretOutOfHiddenText()
    }

    @objc func unfoldAtCursor(_ sender: Any?) {
        guard let folds = foldState, let lines = folds.lines?() else { return }
        folds.unfold(headerLine: lines.clampedLine(containing: selectedRange().location), lines: lines)
    }

    @objc func foldAllRegions(_ sender: Any?) {
        guard let folds = foldState, let lines = folds.lines?() else { return }
        folds.foldAll(lines: lines)
        moveCaretOutOfHiddenText()
    }

    @objc func unfoldAllRegions(_ sender: Any?) {
        foldState?.unfoldAll()
    }

    /// Klick auf das Dreieck in der Zeilennummernleiste
    func toggleFold(atLine line: Int) {
        guard let folds = foldState, let lines = folds.lines?(), let region = folds.region(startingAtLine: line) else { return }
        folds.toggle(region, lines: lines)
        moveCaretOutOfHiddenText()
    }

    // MARK: Cursorbewegung über zugeklappte Bereiche

    /// AppKit findet von der Kopfzeile aus über die ausgeblendeten Zeichen hinweg kein Ziel (der Cursor sprang an den
    /// Textanfang, eine Auswahl wurde sinnlos), deshalb springen Pfeil rechts und Wortsprung selbst hinter den Bereich.
    override func moveRight(_ sender: Any?) {
        if !hopOverFold(forward: true, extending: false) { super.moveRight(sender) }
    }

    override func moveForward(_ sender: Any?) {
        if !hopOverFold(forward: true, extending: false) { super.moveForward(sender) }
    }

    override func moveWordRight(_ sender: Any?) {
        if !hopOverFold(forward: true, extending: false) { super.moveWordRight(sender) }
    }

    override func moveRightAndModifySelection(_ sender: Any?) {
        if !hopOverFold(forward: true, extending: true) { super.moveRightAndModifySelection(sender) }
    }

    override func moveWordLeft(_ sender: Any?) {
        if !hopOverFold(forward: false, extending: false) { super.moveWordLeft(sender) }
    }

    override func moveLeftAndModifySelection(_ sender: Any?) {
        if !hopOverFold(forward: false, extending: true) { super.moveLeftAndModifySelection(sender) }
    }

    /// Cursor an der Kopfzeile (vorwärts) bzw. am Anfang der Zeile hinter dem Bereich (rückwärts): über das Ausgeblendete hinweg
    private func hopOverFold(forward: Bool, extending: Bool) -> Bool {
        guard let folds = foldState, folds.hasFolds, let storage = textStorage, selectedRange().length == 0 else { return false }
        let caret = selectedRange().location
        let hidden = forward
            ? folds.hiddenRanges.first { $0.location == caret }
            : folds.hiddenRanges.first { NSMaxRange($0) + 1 == caret }
        guard let hidden else { return false }
        let target = forward ? min(NSMaxRange(hidden) + 1, storage.length) : hidden.location
        let edge = min(caret, target)
        setSelectedRange(extending ? NSRange(location: edge, length: abs(target - caret)) : NSRange(location: target, length: 0))
        scrollRangeToVisible(selectedRange())
        return true
    }

    /// Rückschritt am Anfang der Zeile hinter einem zugeklappten Bereich löscht den Zeilenumbruch an dessen Ende:
    /// Dann soll man sehen, was damit zusammenwächst.
    func unfoldBeforeCaretForDeletion() {
        guard let folds = foldState, folds.hasFolds, selectedRange().length == 0 else { return }
        let caret = selectedRange().location
        guard let hidden = folds.hiddenRanges.first(where: { NSMaxRange($0) + 1 == caret }) else { return }
        folds.unfold(startingAt: hidden.location)
    }

    /// Nach dem Zuklappen steht der Cursor am Ende der Kopfzeile, wenn die Auswahl im Ausgeblendeten lag.
    private func moveCaretOutOfHiddenText() {
        guard let folds = foldState else { return }
        let selection = selectedRange()
        let end = NSMaxRange(selection)
        guard let hidden = folds.hiddenRanges.first(where: { range in
            [selection.location, end].contains { $0 > range.location && $0 <= NSMaxRange(range) }
        }) else { return }
        setSelectedRange(NSRange(location: hidden.location, length: 0))
        scrollRangeToVisible(selectedRange())
    }
}
