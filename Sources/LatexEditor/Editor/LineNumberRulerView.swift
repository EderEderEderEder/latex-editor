import AppKit

/// Zeilennummern links vom Editor. Eine Nummer nur an der ersten visuellen Zeile einer logischen Zeile;
/// umbrochene Folgezeilen bleiben leer. Gezeichnet wird nur der sichtbare Bereich.
final class LineNumberRulerView: NSRulerView, NSViewToolTipOwner {
    struct Label: Equatable {
        /// 1-basiert
        let number: Int
        /// Oberkante der ersten Zeilenfragments in Koordinaten der Text-View
        let y: CGFloat
        let height: CGFloat
    }

    private static let fontSize: CGFloat = 11
    private static let horizontalPadding: CGFloat = 8
    private static let minimumDigits = 2
    private static let separatorWidth: CGFloat = 1

    private static let changeBarWidth: CGFloat = 3
    /// Abstand des Änderungsstreifens vom Trennstrich
    private static let changeBarInset: CGFloat = 2
    private static let deletionTriangleSize: CGFloat = 4
    private static let dashLength: CGFloat = 3
    private static let dashGap: CGFloat = 2

    private static let markDiameter: CGFloat = 6
    private static let markInset: CGFloat = 3
    /// Abstand zwischen Markierung und breitester Zeilennummer
    private static let markGap: CGFloat = 2

    /// Spalte für die Dreiecke zum Zu- und Aufklappen, links vom Änderungsstreifen
    private static let foldAreaWidth: CGFloat = 12
    private static let foldTriangleSize: CGFloat = 7
    /// Klickbar etwas über die Spalte hinaus
    private static let foldClickSlack: CGFloat = 3

    /// Zeilenindex der aktuell angezeigten Datei.
    var lineIndexProvider: (() -> LineIndex?)?

    /// Build-Meldungen der angezeigten Datei: 1-basierte Zeile → Schwere.
    var issueMarks: [Int: BuildIssue.Severity] = [:] {
        didSet { needsDisplay = true }
    }

    /// Text der Meldungen pro Zeile (Tooltip über der Markierung)
    var issueMessages: [Int: String] = [:]

    /// Git-Änderungen der angezeigten Datei gegenüber HEAD (schmaler Streifen am rechten Rand).
    var changeMarks = ChangeMarks() {
        didSet { needsDisplay = true }
    }

    private var numberFont = NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .regular)
    private var currentNumberFont = NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .semibold)
    private var digitCount = 0
    private var isRefreshScheduled = false

    /// Maus über der Leiste: dann zeigen alle zuklappbaren Zeilen ihr Dreieck, sonst nur zugeklappte
    private var isHovering = false {
        didSet { if isHovering != oldValue { needsDisplay = true } }
    }
    private var hoverTrackingArea: NSTrackingArea?

    private var textView: LatexTextView? { clientView as? LatexTextView }

    init(textView: LatexTextView, scrollView: NSScrollView) {
        super.init(scrollView: scrollView, orientation: .verticalRuler)
        // Seit macOS 14 ist clipsToBounds standardmäßig aus; dann kann dirtyRect über den Ruler
        // hinausreichen und das Füllen des Hintergrunds den Text übermalen.
        clipsToBounds = true
        clientView = textView
        observeChanges(of: textView, in: scrollView)
        // Sonst stünden die Nummern bei schon vergrößertem Zoom (z. B. nach dem Start) bis zur nächsten Änderung klein da
        updateFont()
        refresh()
    }

    @available(*, unavailable)
    required init(coder: NSCoder) {
        fatalError("init(coder:) wird nicht unterstützt")
    }

    override var isFlipped: Bool { true }

    /// Merkt `refresh()` für den nächsten Runloop-Durchlauf vor. Eine neue Breite löst ein Neu-Layout
    /// der Scroll-View aus und darf deshalb nie synchron aus `updateNSView` oder einem Layout heraus laufen.
    func scheduleRefresh() {
        guard !isRefreshScheduled else { return }
        isRefreshScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.isRefreshScheduled = false
            self.refresh()
        }
    }

    /// Zeilennummern zwei Punkt kleiner als der Text, aber nie unter der Grundgröße.
    func updateFont() {
        // Immer 2 pt kleiner als die Editorschrift (Grundgröße × Zoom), mindestens 11 pt
        let size = max(Self.fontSize, EditorAppearance.fontSize - (EditorAppearance.defaultFontSize - Self.fontSize))
        numberFont = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .regular)
        currentNumberFont = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .semibold)
        digitCount = 0
        scheduleRefresh()
    }

    /// Breite an die Stellenzahl anpassen und neu zeichnen.
    func refresh() {
        let lineCount = lineIndexProvider?()?.lineCount ?? 1
        let digits = max(Self.minimumDigits, String(lineCount).count)
        if digits != digitCount {
            digitCount = digits
            let digitWidth = ("8" as NSString).size(withAttributes: [.font: numberFont]).width
            let markArea = Self.markInset + Self.markDiameter + Self.markGap
            ruleThickness = ceil(CGFloat(digits) * digitWidth + Self.horizontalPadding + markArea + Self.foldAreaWidth)
        }
        needsDisplay = true
    }

    // MARK: Zeichnen

    override func draw(_ dirtyRect: NSRect) {
        (textView?.backgroundColor ?? .textBackgroundColor).setFill()
        bounds.intersection(dirtyRect).fill()
        drawSeparator()
        drawHashMarksAndLabels(in: dirtyRect)
    }

    override func drawHashMarksAndLabels(in rect: NSRect) {
        guard let textView, let lines = lineIndexProvider?() else { return }
        drawCurrentLineBand(of: textView)
        let currentNumber = lines.clampedLine(containing: textView.selectedRange().location) + 1
        let labels = visibleLabels(in: textView.visibleRect, lines: lines)
        for label in labels {
            draw(label, isCurrent: label.number == currentNumber, textView: textView)
        }
        drawChangeMarks(for: labels, lines: lines, textView: textView)
        drawFoldMarkers(for: labels, lines: lines, textView: textView)
        updateToolTips(for: labels, textView: textView)
    }

    // MARK: Tooltips

    private var toolTipTexts: [NSView.ToolTipTag: String] = [:]

    /// Über Zeilen mit Meldung oder Git-Änderung erklärt ein Tooltip, was die Markierung bedeutet.
    private func updateToolTips(for labels: [Label], textView: NSTextView) {
        removeAllToolTips()
        toolTipTexts.removeAll()
        for label in labels {
            guard let text = toolTipText(forLine: label.number) else { continue }
            let top = convert(NSPoint(x: 0, y: label.y), from: textView).y
            let rect = NSRect(x: 0, y: top, width: foldColumnMinX, height: label.height)
            toolTipTexts[addToolTip(rect, owner: self, userData: nil)] = text
        }
    }

    func toolTipText(forLine line: Int) -> String? {
        var parts: [String] = []
        if let severity = issueMarks[line] {
            let kind = switch severity {
            case .error: "Fehler"
            case .warning: "Warnung"
            case .badBox: "Box (Über-/Unterfüllung)"
            }
            parts.append(issueMessages[line].map { "\(kind): \($0)" } ?? kind)
        }
        switch changeMarks.lines[line] {
        case .added?: parts.append("Neu seit dem letzten Commit")
        case .modified?: parts.append("Geändert seit dem letzten Commit")
        case .deletedAbove?: parts.append("Darüber wurden Zeilen gelöscht")
        case nil: break
        }
        return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }

    // MARK: Zuklappen

    private var foldColumnMinX: CGFloat {
        ruleThickness - Self.horizontalPadding - Self.foldAreaWidth
    }

    private func drawFoldMarkers(for labels: [Label], lines: LineIndex, textView: LatexTextView) {
        guard let folds = textView.foldState, !folds.regions.isEmpty else { return }
        for label in labels {
            guard let region = folds.region(startingAtLine: label.number - 1) else { continue }
            let isFolded = folds.isFolded(region, lines: lines)
            guard isFolded || isHovering else { continue }
            let top = convert(NSPoint(x: 0, y: label.y), from: textView).y
            let center = NSPoint(x: foldColumnMinX + Self.foldAreaWidth / 2, y: top + label.height / 2)
            drawFoldTriangle(folded: isFolded, around: center)
        }
    }

    private func drawFoldTriangle(folded: Bool, around center: NSPoint) {
        let half = Self.foldTriangleSize / 2
        let path = NSBezierPath()
        if folded {
            path.move(to: NSPoint(x: center.x - half + 1, y: center.y - half))
            path.line(to: NSPoint(x: center.x + half, y: center.y))
            path.line(to: NSPoint(x: center.x - half + 1, y: center.y + half))
        } else {
            path.move(to: NSPoint(x: center.x - half, y: center.y - half + 1))
            path.line(to: NSPoint(x: center.x + half, y: center.y - half + 1))
            path.line(to: NSPoint(x: center.x, y: center.y + half))
        }
        path.close()
        (folded ? NSColor.secondaryLabelColor : NSColor.tertiaryLabelColor).setFill()
        path.fill()
    }

    /// Zeile (0-basiert) mit einem Bereich, dessen Dreieck an diesem Punkt (Koordinaten der Leiste) liegt
    func foldableLine(at point: NSPoint) -> Int? {
        guard let textView, let lines = lineIndexProvider?(), let folds = textView.foldState, !folds.regions.isEmpty,
              point.x >= foldColumnMinX - Self.foldClickSlack else { return nil }
        let local = textView.convert(point, from: self)
        let character = textView.characterIndexForInsertion(at: NSPoint(x: textView.textContainerOrigin.x + 1, y: local.y))
        let line = lines.clampedLine(containing: character)
        return folds.region(startingAtLine: line) == nil ? nil : line
    }

    override func mouseDown(with event: NSEvent) {
        guard let line = foldableLine(at: convert(event.locationInWindow, from: nil)) else {
            super.mouseDown(with: event)
            return
        }
        textView?.toggleFold(atLine: line)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverTrackingArea { removeTrackingArea(hoverTrackingArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        hoverTrackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        isHovering = true
    }

    override func mouseExited(with event: NSEvent) {
        isHovering = false
    }

    // MARK: Git-Änderungen

    private var changeBarX: CGFloat {
        ruleThickness - Self.separatorWidth - Self.changeBarInset - Self.changeBarWidth
    }

    private func drawChangeMarks(for labels: [Label], lines: LineIndex, textView: NSTextView) {
        guard !changeMarks.isEmpty else { return }
        for label in labels {
            let top = convert(NSPoint(x: 0, y: label.y), from: textView).y
            switch changeMarks.lines[label.number] {
            case .added?: drawChangeBar(.systemGreen, top: top, height: logicalLineHeight(label, lines: lines))
            case .modified?: drawChangeBar(.systemOrange, top: top, height: logicalLineHeight(label, lines: lines), dashed: true)
            case .deletedAbove?: drawDeletionTriangle(at: top)
            case nil: break
            }
        }
        if changeMarks.deletedAtEnd, let last = labels.last, last.number == lines.lineCount {
            let top = convert(NSPoint(x: 0, y: last.y), from: textView).y
            drawDeletionTriangle(at: top + logicalLineHeight(last, lines: lines))
        }
    }

    /// Höhe aller visuellen Zeilen einer logischen Zeile (bei weichem Umbruch mehrere).
    private func logicalLineHeight(_ label: Label, lines: LineIndex) -> CGFloat {
        guard let layoutManager = textView?.layoutManager, let container = textView?.textContainer else { return label.height }
        let lineNumber = label.number - 1
        let start = lines.start(ofLine: lineNumber)
        let end = lineNumber + 1 < lines.lineCount ? lines.start(ofLine: lineNumber + 1) : lines.length
        guard end > start else { return label.height }
        let glyphs = layoutManager.glyphRange(forCharacterRange: NSRange(location: start, length: end - start), actualCharacterRange: nil)
        return max(label.height, layoutManager.boundingRect(forGlyphRange: glyphs, in: container).height)
    }

    /// Neu: durchgehender Streifen; geändert: gestrichelt (nicht nur die Farbe unterscheidet)
    private func drawChangeBar(_ color: NSColor, top: CGFloat, height: CGFloat, dashed: Bool = false) {
        color.setFill()
        guard dashed else {
            NSRect(x: changeBarX, y: top, width: Self.changeBarWidth, height: height).fill()
            return
        }
        var y = top
        while y < top + height {
            NSRect(x: changeBarX, y: y, width: Self.changeBarWidth, height: min(Self.dashLength, top + height - y)).fill()
            y += Self.dashLength + Self.dashGap
        }
    }

    /// Kleines rotes Dreieck auf der Grenze, an der Zeilen gelöscht wurden.
    private func drawDeletionTriangle(at y: CGFloat) {
        let size = Self.deletionTriangleSize
        let path = NSBezierPath()
        path.move(to: NSPoint(x: changeBarX, y: y - size))
        path.line(to: NSPoint(x: changeBarX + size, y: y))
        path.line(to: NSPoint(x: changeBarX, y: y + size))
        path.close()
        NSColor.systemRed.setFill()
        path.fill()
    }

    /// Positionen der sichtbaren Zeilennummern. Nutzt nur das Layout des sichtbaren Bereichs.
    func visibleLabels(in visibleRect: NSRect, lines: LineIndex) -> [Label] {
        guard let textView, let layoutManager = textView.layoutManager,
              let container = textView.textContainer else { return [] }
        let origin = textView.textContainerOrigin
        let containerRect = visibleRect.offsetBy(dx: -origin.x, dy: -origin.y)
        // Ohne das liefert glyphRange bei nicht-zusammenhängendem Layout für noch nicht gelayoutete
        // Bereiche (z. B. nach einem Sprung) nichts. NSTextView macht beim Zeichnen dasselbe.
        layoutManager.ensureLayout(forBoundingRect: containerRect, in: container)
        let glyphs = layoutManager.glyphRange(forBoundingRect: containerRect, in: container)
        let characters = layoutManager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)

        var labels: [Label] = []
        var line = lines.clampedLine(containing: characters.location)
        // Beginnt die erste sichtbare Zeile oberhalb (umbrochen), steht ihre Nummer außerhalb.
        if lines.start(ofLine: line) < characters.location { line += 1 }
        // Bei nicht-zusammenhängendem Layout ist der Glyph-Bereich nur eine Näherung, daher zusätzlich nach y filtern.
        while line < lines.lineCount, lines.start(ofLine: line) <= NSMaxRange(characters) {
            guard let fragment = firstFragmentRect(atCharacter: lines.start(ofLine: line), lines: lines) else { break }
            let top = fragment.minY + origin.y
            if top > visibleRect.maxY { break }
            if top + fragment.height >= visibleRect.minY {
                labels.append(Label(number: line + 1, y: top, height: fragment.height))
            }
            line = lineAfterHiddenText(startingAfter: line, lines: lines)
        }
        return labels
    }

    /// Die nächste Zeile mit Nummer: Hinter einer zugeklappten Kopfzeile fehlen die ausgeblendeten Zeilen.
    private func lineAfterHiddenText(startingAfter line: Int, lines: LineIndex) -> Int {
        guard let folds = textView?.foldState, folds.hasFolds else { return line + 1 }
        let contentEnd = NSMaxRange(lines.contentRange(ofLine: line))
        let index = folds.firstHiddenRangeIndex(endingAfter: contentEnd)
        guard index < folds.hiddenRanges.count, folds.hiddenRanges[index].location == contentEnd else { return line + 1 }
        return lines.line(containing: NSMaxRange(folds.hiddenRanges[index])) + 1
    }

    private func firstFragmentRect(atCharacter location: Int, lines: LineIndex) -> NSRect? {
        guard let layoutManager = textView?.layoutManager else { return nil }
        if location >= lines.length {
            let extra = layoutManager.extraLineFragmentRect
            return extra.isEmpty ? nil : extra
        }
        let glyph = layoutManager.glyphIndexForCharacter(at: location)
        return layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
    }

    private func draw(_ label: Label, isCurrent: Bool, textView: NSTextView) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: isCurrent ? currentNumberFont : numberFont,
            // Sekundär statt tertiär: tertiär erreichte nur etwa 1,9:1 (hell) bzw. 2,3:1 (dunkel)
            .foregroundColor: isCurrent ? NSColor.labelColor : NSColor.secondaryLabelColor
        ]
        let text = String(label.number) as NSString
        let size = text.size(withAttributes: attributes)
        let top = convert(NSPoint(x: 0, y: label.y), from: textView).y
        let point = NSPoint(
            x: ruleThickness - Self.horizontalPadding - Self.foldAreaWidth - size.width,
            y: top + (label.height - size.height) / 2
        )
        text.draw(at: point, withAttributes: attributes)
        if let severity = issueMarks[label.number] {
            drawMark(severity, centeredAt: top + label.height / 2)
        }
    }

    /// Form und Farbe zugleich (nicht nur Farbe): Fehler Kreis, Warnung Dreieck, Box Raute
    private func drawMark(_ severity: BuildIssue.Severity, centeredAt centerY: CGFloat) {
        let box = NSRect(x: Self.markInset, y: centerY - Self.markDiameter / 2, width: Self.markDiameter, height: Self.markDiameter)
        let path: NSBezierPath
        switch severity {
        case .error:
            NSColor.systemRed.setFill()
            path = NSBezierPath(ovalIn: box)
        case .warning:
            NSColor.systemOrange.setFill()
            path = NSBezierPath()
            path.move(to: NSPoint(x: box.midX, y: box.minY - 1))
            path.line(to: NSPoint(x: box.maxX + 1, y: box.maxY))
            path.line(to: NSPoint(x: box.minX - 1, y: box.maxY))
            path.close()
        case .badBox:
            NSColor.systemYellow.setFill()
            path = NSBezierPath()
            path.move(to: NSPoint(x: box.midX, y: box.minY))
            path.line(to: NSPoint(x: box.maxX, y: box.midY))
            path.line(to: NSPoint(x: box.midX, y: box.maxY))
            path.line(to: NSPoint(x: box.minX, y: box.midY))
            path.close()
        }
        path.fill()
    }

    private func drawCurrentLineBand(of textView: LatexTextView) {
        let lineRect = textView.currentLineRect
        guard !lineRect.isEmpty else { return }
        let top = convert(NSPoint(x: 0, y: lineRect.minY), from: textView).y
        EditorAppearance.currentLineColor.setFill()
        NSRect(x: 0, y: top, width: ruleThickness, height: lineRect.height).fill(using: .sourceOver)
    }

    private func drawSeparator() {
        NSColor.separatorColor.setFill()
        NSRect(x: bounds.maxX - Self.separatorWidth, y: bounds.minY, width: Self.separatorWidth, height: bounds.height)
            .fill(using: .sourceOver)
    }

    func view(_ view: NSView, stringForToolTip tag: NSView.ToolTipTag, point: NSPoint, userData data: UnsafeMutableRawPointer?) -> String {
        toolTipTexts[tag] ?? ""
    }

    // MARK: Beobachtung

    private func observeChanges(of textView: NSTextView, in scrollView: NSScrollView) {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(contentDidChange), name: NSText.didChangeNotification, object: textView)
        center.addObserver(
            self, selector: #selector(viewDidChange), name: NSTextView.didChangeSelectionNotification, object: textView
        )
        textView.postsFrameChangedNotifications = true
        center.addObserver(self, selector: #selector(viewDidChange), name: NSView.frameDidChangeNotification, object: textView)
        scrollView.contentView.postsBoundsChangedNotifications = true
        center.addObserver(
            self, selector: #selector(viewDidChange), name: NSView.boundsDidChangeNotification, object: scrollView.contentView
        )
    }

    @objc private func contentDidChange(_ notification: Notification) {
        scheduleRefresh()
    }

    @objc private func viewDidChange(_ notification: Notification) {
        needsDisplay = true
    }
}
