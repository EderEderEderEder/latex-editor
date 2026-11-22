import AppKit

/// Zuklappbare Bereiche einer Datei und welche davon gerade zugeklappt sind (nur zur Laufzeit, pro Sitzung).
/// Der Text bleibt unverändert: Zugeklappte Zeichen blendet nur der Layout-Manager aus (`FoldGlyphDelegate`),
/// Speichern, Rückgängig, Suche und Git sehen weiter den vollen Text.
///
/// Zwischen zwei Prüfläufen führt `applyEdit` Bereiche und zugeklappte Stellen mit den Bearbeitungen nach; die
/// Prüfung selbst läuft entprellt im Hintergrund (`FoldScanner`). Eine Bearbeitung, die zugeklappten Text berührt,
/// klappt ihn auf.
@MainActor
final class FoldState {
    private static let rescanDelay = Duration.milliseconds(250)

    /// Zuletzt gefundene Bereiche, nach Startzeile sortiert
    private(set) var regions: [FoldRegion] = []
    /// Zugeklappte Bereiche als ausgeblendete Zeichen. Verschachtelte Bereiche liegen ineinander.
    private(set) var folded: [NSRange] = []
    /// Vereinigung von `folded`: sortiert und ohne Überlappung, so liest sie der Layout-Manager
    private(set) var hiddenRanges: [NSRange] = []

    var lines: (@MainActor () -> LineIndex)?
    /// Der Text zum Prüfen; `nil`, wo es nichts zuzuklappen gibt (z. B. .bib)
    var text: (@MainActor () -> String?)?
    /// Der Layout-Manager muss diese Zeichen neu aufbauen (ausgeblendet oder wieder sichtbar)
    var onHiddenChange: ((NSRange) -> Void)?
    /// Die Liste der Bereiche hat sich geändert (Zeilennummernleiste neu zeichnen)
    var onRegionsChange: (() -> Void)?

    private var generation = 0
    private var hasScanned = false
    private var rescanTask: Task<Void, Never>?

    var hasFolds: Bool { !folded.isEmpty }

    func detach() {
        onHiddenChange = nil
        onRegionsChange = nil
    }

    // MARK: Abfragen

    /// Binärsuche: `regions` ist nach Startzeile sortiert, jede Zeile kommt höchstens einmal vor
    func region(startingAtLine line: Int) -> FoldRegion? {
        var low = 0
        var high = regions.count
        while low < high {
            let middle = (low + high) / 2
            if regions[middle].startLine < line { low = middle + 1 } else { high = middle }
        }
        return low < regions.count && regions[low].startLine == line ? regions[low] : nil
    }

    func isFolded(_ region: FoldRegion, lines: LineIndex) -> Bool {
        folded.contains(region.hiddenRange(in: lines))
    }

    /// Innerster nicht zugeklappter Bereich, der die Zeile enthält (Kopfzeile eingeschlossen)
    func innermostOpenRegion(containingLine line: Int, lines: LineIndex) -> FoldRegion? {
        regions.last { $0.startLine <= line && line <= $0.endLine && !isFolded($0, lines: lines) }
    }

    /// Binärsuche: Index des ersten ausgeblendeten Bereichs, der hinter `location` endet
    func firstHiddenRangeIndex(endingAfter location: Int) -> Int {
        var low = 0
        var high = hiddenRanges.count
        while low < high {
            let middle = (low + high) / 2
            if NSMaxRange(hiddenRanges[middle]) <= location { low = middle + 1 } else { high = middle }
        }
        return low
    }

    // MARK: Zu- und Aufklappen

    func toggle(_ region: FoldRegion, lines: LineIndex) {
        isFolded(region, lines: lines) ? unfold(region, lines: lines) : fold(region, lines: lines)
    }

    func fold(_ region: FoldRegion, lines: LineIndex) {
        let range = region.hiddenRange(in: lines)
        guard range.length > 0, !folded.contains(range) else { return }
        folded.append(range)
        sortFolded()
        updateHiddenRanges()
        onHiddenChange?(range)
    }

    func unfold(_ region: FoldRegion, lines: LineIndex) {
        remove { $0 == region.hiddenRange(in: lines) }
    }

    /// Alle Bereiche, die in der Zeile beginnen (Cursor auf der zugeklappten Kopfzeile)
    func unfold(headerLine line: Int, lines: LineIndex) {
        remove { lines.line(containing: $0.location) == line }
    }

    /// Das Platzhalter-Feld hinter einer zugeklappten Kopfzeile: der äußerste Bereich, der dort beginnt
    func unfold(startingAt location: Int) {
        remove { $0.location == location }
    }

    /// Alles zuklappen, außer der Umgebung `document` (sonst bliebe von der Datei nur eine Zeile)
    func foldAll(lines: LineIndex) {
        var known = Set(folded)
        var changed = false
        for region in regions where region.kind != .environment("document") {
            let range = region.hiddenRange(in: lines)
            guard range.length > 0, known.insert(range).inserted else { continue }
            folded.append(range)
            changed = true
        }
        guard changed else { return }
        sortFolded()
        updateHiddenRanges()
        onHiddenChange?(NSRange(location: 0, length: lines.length))
    }

    private func sortFolded() {
        folded.sort { $0.location != $1.location ? $0.location < $1.location : $0.length > $1.length }
    }

    func unfoldAll() {
        remove { _ in true }
    }

    private func remove(where shouldRemove: (NSRange) -> Bool) {
        let removed = folded.filter(shouldRemove)
        guard let first = removed.first, let last = removed.max(by: { NSMaxRange($0) < NSMaxRange($1) }) else { return }
        folded.removeAll(where: shouldRemove)
        updateHiddenRanges()
        onHiddenChange?(NSRange(location: first.location, length: NSMaxRange(last) - first.location))
    }

    private func updateHiddenRanges() {
        var merged: [NSRange] = []
        for range in folded {
            if let last = merged.last, range.location <= NSMaxRange(last) {
                merged[merged.count - 1] = NSRange(location: last.location, length: max(NSMaxRange(last), NSMaxRange(range)) - last.location)
            } else {
                merged.append(range)
            }
        }
        hiddenRanges = merged
    }

    // MARK: Cursor

    /// Der Cursor soll nie in ausgeblendetem Text stehen. Hinter dem Ausgeblendeten (Ende der Zeile, z. B. nach
    /// `End` oder einem Klick rechts davon) rückt er an das Ende der Kopfzeile; ein Schritt nach rechts vom Ende der
    /// Kopfzeile springt hinter den Bereich. Alles, was mitten hinein führt (Suche, Gehe zu Zeile, Fehlerliste),
    /// klappt auf. Bei einer Auswahl klappt nur auf, wessen Rand mitten im Ausgeblendeten liegt.
    func adjustedSelection(_ selection: NSRange, previousLocation: Int, textLength: Int) -> NSRange? {
        guard hasFolds else { return nil }
        if selection.length > 0 {
            remove { Self.isInside($0, selection.location) || Self.isInside($0, NSMaxRange(selection)) }
            return nil
        }
        let location = selection.location
        if let hidden = hiddenRanges.first(where: { $0.location < location && location <= NSMaxRange($0) }) {
            if location == NSMaxRange(hidden) { return NSRange(location: hidden.location, length: 0) }
            if location == hidden.location + 1, previousLocation == hidden.location {
                return NSRange(location: min(NSMaxRange(hidden) + 1, textLength), length: 0)
            }
        }
        remove { Self.isInside($0, location) }
        return nil
    }

    private static func isInside(_ range: NSRange, _ location: Int) -> Bool {
        range.location < location && location < NSMaxRange(range)
    }

    // MARK: Bearbeitungen

    /// Führt Bereiche und zugeklappte Stellen nach einer Textänderung nach. `editedRange` bezieht sich auf den neuen Text.
    /// Pro Tastendruck bleibt das billig: Die Bereiche (Zeilennummern) ändern sich nur, wenn sich die Zahl der Zeilen ändert.
    func applyEdit(editedRange: NSRange, delta: Int, splice: LineSplice, textLength: Int) {
        generation += 1
        if splice.insertedLineCount != splice.removedLineCount {
            shiftRegions(by: splice, editedRange: editedRange, delta: delta)
            onRegionsChange?()
        }
        shiftFolded(editedRange: editedRange, delta: delta, textLength: textLength)
        if hasScanned { scheduleRescan() }
    }

    private func shiftRegions(by splice: LineSplice, editedRange: NSRange, delta: Int) {
        // Steht das Eingefügte (mit Zeilenumbruch) am Anfang einer Zeile, rückt auch deren alter Inhalt nach unten
        let insertsAboveFirstLine = delta == editedRange.length && delta > 0 && splice.insertedLineCount > splice.removedLineCount
            && editedRange.location == lines?().start(ofLine: splice.firstLine)
        let effective = insertsAboveFirstLine
            ? LineSplice(firstLine: splice.firstLine - 1, removedLineCount: splice.removedLineCount, insertedLineCount: splice.insertedLineCount)
            : splice
        regions = regions.compactMap { Self.shifted($0, by: effective) }
    }

    private static func shifted(_ region: FoldRegion, by splice: LineSplice) -> FoldRegion? {
        let start = shifted(region.startLine, by: splice)
        let end = shifted(region.endLine, by: splice)
        guard end > start else { return nil }
        return FoldRegion(kind: region.kind, startLine: start, endLine: end)
    }

    private static func shifted(_ line: Int, by splice: LineSplice) -> Int {
        if line <= splice.firstLine { return line }
        if line > splice.firstLine + splice.removedLineCount { return line + splice.insertedLineCount - splice.removedLineCount }
        return min(line, splice.firstLine + splice.insertedLineCount)
    }

    /// Eine Einfügung am Anfang des Ausgeblendeten (Ende der Kopfzeile) schiebt es nach hinten, eine Änderung am Ende
    /// lässt es stehen; alles dazwischen klappt auf.
    private func shiftFolded(editedRange: NSRange, delta: Int, textLength: Int) {
        guard hasFolds else { return }
        let oldStart = editedRange.location
        let oldEnd = NSMaxRange(editedRange) - delta
        let index = firstHiddenRangeIndex(endingAfter: oldStart)
        let overlaps = index < hiddenRanges.count && hiddenRanges[index].location < oldEnd
        guard overlaps else {
            // Nichts berührt: alles dahinter rückt um `delta`, die Vereinigung ebenso (sie wird dabei nicht zerteilt)
            guard delta != 0 else { return }
            for position in firstIndex(in: folded, atOrAfter: oldEnd)..<folded.count { folded[position].location += delta }
            for position in firstIndex(in: hiddenRanges, atOrAfter: oldEnd)..<hiddenRanges.count { hiddenRanges[position].location += delta }
            return
        }
        dropTouched(by: editedRange, delta: delta, textLength: textLength)
    }

    /// Binärsuche in einer nach Anfang sortierten Liste: erster Eintrag, der bei `location` oder dahinter beginnt
    private func firstIndex(in ranges: [NSRange], atOrAfter location: Int) -> Int {
        var low = 0
        var high = ranges.count
        while low < high {
            let middle = (low + high) / 2
            if ranges[middle].location < location { low = middle + 1 } else { high = middle }
        }
        return low
    }

    private func dropTouched(by editedRange: NSRange, delta: Int, textLength: Int) {
        let oldStart = editedRange.location
        let oldEnd = NSMaxRange(editedRange) - delta
        let touched = folded.filter { oldEnd > $0.location && oldStart < NSMaxRange($0) }
        let touchedSet = Set(touched)
        folded = folded.compactMap { range in
            if touchedSet.contains(range) { return nil }
            return range.location >= oldEnd ? NSRange(location: range.location + delta, length: range.length) : range
        }
        updateHiddenRanges()
        guard let first = touched.first else { return }
        let dropped = touched.dropFirst().reduce(first) { $0.union($1) }
        let start = min(max(min(dropped.location, editedRange.location), 0), textLength)
        let end = min(max(NSMaxRange(dropped) + delta, NSMaxRange(editedRange)), textLength)
        onHiddenChange?(NSRange(location: start, length: max(0, end - start)))
    }

    // MARK: Prüfen

    func rescanIfNeeded() {
        guard !hasScanned else { return }
        hasScanned = true
        scheduleRescan(immediately: true)
    }

    func rescanSoon() {
        hasScanned = true
        scheduleRescan()
    }

    private func scheduleRescan(immediately: Bool = false) {
        rescanTask?.cancel()
        rescanTask = Task { [weak self] in
            if !immediately {
                try? await Task.sleep(for: Self.rescanDelay)
                guard !Task.isCancelled else { return }
            }
            await self?.rescan()
        }
    }

    private func rescan() async {
        let expected = generation
        let source = text?()
        let regions: [FoldRegion]
        if let source {
            regions = await Task.detached(priority: .utility) { FoldScanner.regions(in: source) }.value
        } else {
            regions = []
        }
        guard !Task.isCancelled, expected == generation, let lines = lines?() else { return }
        adopt(regions, lines: lines)
    }

    /// Übernimmt das Ergebnis einer Prüfung; zugeklappte Stellen, zu denen es keinen Bereich mehr gibt, klappen auf.
    func adopt(_ newRegions: [FoldRegion], lines: LineIndex) {
        let valid = Set(newRegions.map { $0.hiddenRange(in: lines) })
        remove { !valid.contains($0) }
        guard newRegions != regions else { return }
        regions = newRegions
        onRegionsChange?()
    }
}

extension NSRange {
    fileprivate func union(_ other: NSRange) -> NSRange {
        let start = Swift.min(location, other.location)
        return NSRange(location: start, length: Swift.max(NSMaxRange(self), NSMaxRange(other)) - start)
    }
}

/// Blendet die zugeklappten Zeichen aus: Ihre Glyphen bekommen die Eigenschaft `null`, haben keine Breite, und die
/// Zeilenumbrüche darin trennen keine Zeilen mehr. Kopfzeile und Rest des letzten Zeilenendes bleiben so eine Zeile.
@MainActor
final class FoldGlyphDelegate: NSObject, @preconcurrency NSLayoutManagerDelegate {
    weak var folds: FoldState?

    func layoutManager(
        _ layoutManager: NSLayoutManager,
        shouldGenerateGlyphs glyphs: UnsafePointer<CGGlyph>,
        properties props: UnsafePointer<NSLayoutManager.GlyphProperty>,
        characterIndexes charIndexes: UnsafePointer<Int>,
        font aFont: NSFont,
        forGlyphRange glyphRange: NSRange
    ) -> Int {
        guard let folds, folds.hasFolds, glyphRange.length > 0 else { return 0 }
        var rangeIndex = folds.firstHiddenRangeIndex(endingAfter: charIndexes[0])
        guard rangeIndex < folds.hiddenRanges.count,
              folds.hiddenRanges[rangeIndex].location <= charIndexes[glyphRange.length - 1] else { return 0 }

        var properties = Array(UnsafeBufferPointer(start: props, count: glyphRange.length))
        for index in 0..<glyphRange.length {
            let character = charIndexes[index]
            while rangeIndex < folds.hiddenRanges.count, NSMaxRange(folds.hiddenRanges[rangeIndex]) <= character { rangeIndex += 1 }
            guard rangeIndex < folds.hiddenRanges.count else { break }
            if folds.hiddenRanges[rangeIndex].location <= character { properties[index] = .null }
        }
        properties.withUnsafeBufferPointer { buffer in
            layoutManager.setGlyphs(glyphs, properties: buffer.baseAddress!, characterIndexes: charIndexes, font: aFont, forGlyphRange: glyphRange)
        }
        return glyphRange.length
    }
}
