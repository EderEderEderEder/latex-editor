import PDFKit

/// Pfade zwischen Projektordner und Markierungen (relativ gespeichert, damit das Projekt verschoben werden kann)
enum MarkPaths {
    static func relative(_ file: URL, to root: URL) -> String? {
        let prefix = SyncTeXIndex.normalizedPath(root) + "/"
        let path = SyncTeXIndex.normalizedPath(file)
        return path.hasPrefix(prefix) ? String(path.dropFirst(prefix.count)) : nil
    }

    static func absolute(_ path: String, in root: URL) -> URL {
        root.appendingPathComponent(path).standardizedFileURL
    }
}

/// Legt Markierungen auf ein PDF: Zeile im Quelltext finden → SyncTeX → Seite und Rechteck der Zeile → darin die
/// gemerkten Wörter suchen. Findet es die Wörter nicht (Formel, Silbentrennung), bleibt die Zeile.
@MainActor
struct MarkResolver {
    private static let rectTolerance: CGFloat = 1
    private static let maximumWordsMatched = 3
    /// Größe und Abstand des Notizsymbols am linken Rand der Zeile
    static let noteIconSize: CGFloat = 16
    private static let noteIconGap: CGFloat = 6
    private static let pageEdgeInset: CGFloat = 4
    /// Wie weit (in Zeichen) ein Treffer von der gewählten Stelle abweichen darf, um als dieser zu gelten
    private static let occurrenceTolerance = 2
    /// SyncTeX liefert für manche Zeilen (Gleichungsrahmen, Leerraum) Rechtecke ohne Höhe: sichtbar machen
    private static let minimumLineHeight: CGFloat = 8

    let root: URL
    let document: PDFDocument
    /// Zeilen der Datei, wie sie kompiliert wurden (relativer Pfad); `nil`, wenn nicht lesbar
    let linesOf: (String) -> [String]?
    let forward: (URL, Int) -> SyncTeXBox?
    /// Ist die Datei neuer als das PDF? Dann stimmen die SyncTeX-Zeilen nicht mehr mit ihr überein.
    let isNewerThanPDF: (String) -> Bool
    /// Zeichenlagen und Text der Seiten, einmal je Seite für den ganzen Lauf gelesen
    private let pages = PageTextCache()

    /// Liegen mehrere Markierungen auf einer Seite, fragte sonst jede Seite der Markierung alle Zeichen der Seite neu ab
    /// (`characterBounds` für jedes Zeichen, bei jedem Zuordnen nach einem Build, auf dem Main-Thread).
    private final class PageTextCache {
        private var centers: [Int: [CGPoint]] = [:]
        private var texts: [Int: NSString] = [:]

        func characterCenters(of page: PDFPage, index: Int) -> [CGPoint] {
            if let known = centers[index] { return known }
            let computed = (0..<page.numberOfCharacters).map { character -> CGPoint in
                let bounds = page.characterBounds(at: character)
                return CGPoint(x: bounds.midX, y: bounds.midY)
            }
            centers[index] = computed
            return computed
        }

        func text(of page: PDFPage, index: Int) -> NSString? {
            if let known = texts[index] { return known }
            guard let text = page.string as NSString? else { return nil }
            texts[index] = text
            return text
        }
    }

    func resolve(_ mark: PDFMark) -> MarkResolution {
        if isNewerThanPDF(mark.start.path) || isNewerThanPDF(mark.end.path) { return .pending }
        if mark.kind == .note { return resolveNote(mark) }
        guard let start = side(of: mark.start, isStart: true), let end = side(of: mark.end, isStart: false) else { return .orphaned }
        return placement(from: start, to: end)
    }

    // MARK: Eine Seite der Markierung

    private struct Side {
        let page: PDFPage
        let pageIndex: Int
        /// Das Rechteck der Quellzeile im PDF (PDFKit-Koordinaten)
        let rect: CGRect
        /// Alle Zeichen der Seite im Rechteck
        let characters: NSRange?
        /// Die gefundenen Wörter des Ankers
        let matched: NSRange?
    }

    /// Seite und Rechteck der Quellzeile des Ankers im PDF
    private func lineBox(of anchor: MarkAnchor) -> (page: PDFPage, index: Int, rect: CGRect)? {
        guard let lines = linesOf(anchor.path), let line = MarkAnchorLocator.locate(anchor, in: lines),
              let box = forward(MarkPaths.absolute(anchor.path, in: root), line),
              let page = document.page(at: box.page - 1) else { return nil }
        var rect = SyncTeXCoordinates.pdfRect(from: box.rect, mediaBox: page.bounds(for: .mediaBox))
        if rect.height < Self.minimumLineHeight {
            rect = rect.insetBy(dx: 0, dy: -(Self.minimumLineHeight - rect.height) / 2)
        }
        return (page, box.page - 1, rect)
    }

    /// Eine Notiz sitzt am linken Rand, auf der Höhe der ersten Zeile ihres Absatzes (die Stelle in der Zeile ist nicht bekannt)
    private func resolveNote(_ mark: PDFMark) -> MarkResolution {
        guard let box = lineBox(of: mark.start) else { return .orphaned }
        let mediaBox = box.page.bounds(for: .mediaBox)
        let size = Self.noteIconSize
        let x = max(box.rect.minX - size - Self.noteIconGap, mediaBox.minX + Self.pageEdgeInset)
        let icon = CGRect(x: x, y: box.rect.maxY - size, width: size, height: size)
        return .placed(segments: [MarkResolution.Segment(pageIndex: box.index, rect: icon)], precision: .lines)
    }

    private func side(of anchor: MarkAnchor, isStart: Bool) -> Side? {
        guard let box = lineBox(of: anchor) else { return nil }
        let (page, pageIndex, rect) = (box.page, box.index, box.rect)
        let characters = charactersInside(rect, on: page, pageIndex: pageIndex)
        let matched = characters.flatMap { matchWords(anchor, isStart: isStart, in: $0, on: page, pageIndex: pageIndex) }
        return Side(page: page, pageIndex: pageIndex, rect: rect, characters: characters, matched: matched)
    }

    private func charactersInside(_ rect: CGRect, on page: PDFPage, pageIndex: Int) -> NSRange? {
        let area = rect.insetBy(dx: -Self.rectTolerance, dy: -Self.rectTolerance)
        var first: Int?
        var last = 0
        for (index, center) in pages.characterCenters(of: page, index: pageIndex).enumerated() where area.contains(center) {
            first = first ?? index
            last = index
        }
        return first.map { NSRange(location: $0, length: last - $0 + 1) }
    }

    /// Treffer der ersten (letzten) drei, zwei, ein Wort(e) in den Wörtern der Zeile, in Lesereihenfolge
    private func wordCandidates(
        _ words: [String], isStart: Bool, in range: NSRange, on page: PDFPage, pageIndex: Int
    ) -> [(count: Int, ranges: [NSRange])] {
        guard !words.isEmpty, let text = pages.text(of: page, index: pageIndex), NSMaxRange(range) <= text.length else { return [] }
        let tokens = MarkText.tokens(in: text.substring(with: range)).map {
            MarkText.Token(text: $0.text, range: NSRange(location: $0.range.location + range.location, length: $0.range.length))
        }
        return stride(from: min(words.count, Self.maximumWordsMatched), through: 1, by: -1).map { count in
            let wanted = isStart ? Array(words.prefix(count)) : Array(words.suffix(count))
            let hits = tokens.indices.filter { index in
                index + count <= tokens.count && (0..<count).allSatisfy { tokens[index + $0].text == wanted[$0] }
            }
            let ranges = hits.map { NSRange(location: tokens[$0].range.location, length: NSMaxRange(tokens[$0 + count - 1].range) - tokens[$0].range.location) }
            return (count, ranges)
        }
    }

    /// Zuerst die ersten (letzten) drei Wörter hintereinander, dann zwei, dann eins. Hat der Anker sich den Treffer gemerkt
    /// (`occurrence`), gilt er; sonst der erste (letzte), und ein einzelnes Wort nur, wenn es in der Zeile genau einmal
    /// vorkommt: Sonst wäre es geraten.
    private func matchWords(_ anchor: MarkAnchor, isStart: Bool, in range: NSRange, on page: PDFPage, pageIndex: Int) -> NSRange? {
        for (count, ranges) in wordCandidates(anchor.words, isStart: isStart, in: range, on: page, pageIndex: pageIndex) where !ranges.isEmpty {
            if count == anchor.matchedWords, let occurrence = anchor.occurrence, occurrence < ranges.count {
                return isStart ? ranges[occurrence] : ranges[ranges.count - 1 - occurrence]
            }
            guard count > 1 || ranges.count == 1 else { continue }
            return isStart ? ranges.first : ranges.last
        }
        return nil
    }

    /// Beim Anlegen: der wievielte Treffer der Wortfolge in der Zeile ist die gewählte Stelle? `characterIndex` ist das Zeichen
    /// der Seite am Rand der Auswahl (Anfang bzw. Ende). `nil`, wenn kein Treffer bei dieser Stelle liegt.
    func occurrence(for anchor: MarkAnchor, isStart: Bool, characterIndex: Int) -> (words: Int, occurrence: Int)? {
        guard let box = lineBox(of: anchor), let characters = charactersInside(box.rect, on: box.page, pageIndex: box.index) else { return nil }
        for (count, ranges) in wordCandidates(anchor.words, isStart: isStart, in: characters, on: box.page, pageIndex: box.index) where !ranges.isEmpty {
            let distances = ranges.map { isStart ? abs($0.location - characterIndex) : abs(NSMaxRange($0) - 1 - characterIndex) }
            guard let nearest = distances.indices.min(by: { distances[$0] < distances[$1] }),
                  distances[nearest] <= Self.occurrenceTolerance else { return nil }
            return (count, isStart ? nearest : ranges.count - 1 - nearest)
        }
        return nil
    }

    // MARK: Rechtecke

    private func placement(from start: Side, to end: Side) -> MarkResolution {
        let precision: MarkResolution.Precision = start.matched != nil && end.matched != nil ? .words : .lines
        if let startIndex = (start.matched ?? start.characters)?.location,
           let endIndex = (end.matched ?? end.characters).map({ NSMaxRange($0) - 1 }),
           isInOrder(start, startIndex, end, endIndex),
           let selection = document.selection(from: start.page, atCharacterIndex: startIndex, to: end.page, atCharacterIndex: endIndex) {
            let segments = segments(of: selection)
            if !segments.isEmpty { return .placed(segments: segments, precision: precision) }
        }
        return .placed(segments: lineSegments(start, end), precision: .lines)
    }

    private func isInOrder(_ start: Side, _ startIndex: Int, _ end: Side, _ endIndex: Int) -> Bool {
        start.pageIndex != end.pageIndex ? start.pageIndex < end.pageIndex : startIndex <= endIndex
    }

    private func segments(of selection: PDFSelection) -> [MarkResolution.Segment] {
        MarkResolution.segments(of: selection, in: document)
    }

    /// Ohne Text im Rechteck (Formel, Bild): die Zeilenrechtecke selbst
    private func lineSegments(_ start: Side, _ end: Side) -> [MarkResolution.Segment] {
        let first = MarkResolution.Segment(pageIndex: start.pageIndex, rect: start.rect)
        let last = MarkResolution.Segment(pageIndex: end.pageIndex, rect: end.rect)
        return first == last ? [first] : [first, last]
    }
}

extension MarkResolution {
    /// Die Zeilenrechtecke einer Auswahl im PDF (so sähe eine Markierung genau dort aus)
    static func segments(of selection: PDFSelection, in document: PDFDocument) -> [Segment] {
        selection.selectionsByLine().flatMap { line in
            line.pages.map { Segment(pageIndex: document.index(for: $0), rect: line.bounds(for: $0)) }
        }.filter { !$0.rect.isEmpty }
    }

    /// Wie viel zwei Rechtecke mindestens übereinander liegen müssen (Punkte): Nachbarwörter berühren sich um Bruchteile
    static let minimumOverlap: CGFloat = 1

    /// Liegt die Markierung (zumindest teilweise) auf einem der Rechtecke? `false` für Nicht-Zugeordnete.
    func overlaps(_ others: [Segment]) -> Bool {
        guard case .placed(let segments, _) = self else { return false }
        return segments.contains { mine in
            others.contains {
                let common = $0.rect.intersection(mine.rect)
                return $0.pageIndex == mine.pageIndex && !common.isNull && common.width > Self.minimumOverlap && common.height > Self.minimumOverlap
            }
        }
    }
}

/// Legt aus einer Auswahl im PDF eine Markierung an: Anfang und Ende werden über SyncTeX auf Quelltextzeilen abgebildet.
@MainActor
struct MarkCreator {
    private static let maximumStoredWords = 3
    private static let maximumStoredTextLength = 2_000
    private static let edgeInset: CGFloat = 1

    enum Failure: Error, Equatable {
        case emptySelection
        /// Anfang oder Ende liegt nicht im Quelltext (Inhaltsverzeichnis, Titelseite aus der Klasse …)
        case noSourceLine
        case outsideProject

        var message: String {
            switch self {
            case .emptySelection: "Es ist kein Text ausgewählt."
            case .noSourceLine: "Diese Stelle lässt sich keiner Zeile im Text zuordnen (z. B. Inhaltsverzeichnis oder Titelseite)."
            case .outsideProject: "Diese Stelle stammt aus einer Datei außerhalb des Projekts."
            }
        }
    }

    let root: URL
    let document: PDFDocument
    let linesOf: (String) -> [String]?
    let backward: (Int, CGPoint) -> SyncTeXSourceLocation?
    /// Quelle → PDF: damit sich der Anker den Treffer merken kann, wenn die Wörter in der Zeile mehrfach vorkommen
    var forward: ((URL, Int) -> SyncTeXBox?)?

    /// Die Dateien, in denen Anfang und Ende der Auswahl liegen (zum Lesen, bevor die Markierung angelegt wird)
    func sourcePaths(of selection: PDFSelection) -> Set<String> {
        let lines = selection.selectionsByLine()
        let edges: [(PDFSelection, Bool)] = [(lines.first, true), (lines.last, false)].compactMap { line, isStart in line.map { ($0, isStart) } }
        return Set(edges.compactMap { line, isStart in
            guard let page = isStart ? line.pages.first : line.pages.last else { return nil }
            let bounds = line.bounds(for: page)
            let point = CGPoint(x: isStart ? bounds.minX + Self.edgeInset : bounds.maxX - Self.edgeInset, y: bounds.midY)
            let syncPoint = SyncTeXCoordinates.syncTeXPoint(fromPDF: point, mediaBox: page.bounds(for: .mediaBox))
            return backward(document.index(for: page) + 1, syncPoint).flatMap { MarkPaths.relative($0.file, to: root) }
        })
    }

    /// Eine Notiz an der Zeile unter `point` (PDFKit-Seitenkoordinaten)
    func makeNote(on page: PDFPage, at point: CGPoint, color: MarkColor, comment: String = "") throws -> PDFMark {
        let anchor = try anchor(on: page, at: point, words: [], isStart: true)
        return PDFMark(
            id: UUID(), kind: .note, color: color, comment: comment, text: "", start: anchor, end: anchor,
            pageHint: document.index(for: page) + 1, createdAt: Date()
        )
    }

    func makeMark(from selection: PDFSelection, color: MarkColor, comment: String = "") throws -> PDFMark {
        let text = (selection.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let words = MarkText.tokens(in: text).map(\.text)
        let lines = selection.selectionsByLine()
        guard !words.isEmpty, let first = lines.first, let last = lines.last,
              let firstPage = first.pages.first, let lastPage = last.pages.last else { throw Failure.emptySelection }
        let startBounds = first.bounds(for: firstPage)
        let endBounds = last.bounds(for: lastPage)
        let start = try anchor(on: firstPage, at: CGPoint(x: startBounds.minX + Self.edgeInset, y: startBounds.midY),
                               words: Array(words.prefix(Self.maximumStoredWords)), isStart: true)
        let end = try anchor(on: lastPage, at: CGPoint(x: endBounds.maxX - Self.edgeInset, y: endBounds.midY),
                             words: Array(words.suffix(Self.maximumStoredWords)), isStart: false)
        return PDFMark(
            id: UUID(), color: color, comment: comment, text: String(text.prefix(Self.maximumStoredTextLength)),
            start: start, end: end, pageHint: document.index(for: firstPage) + 1, createdAt: Date()
        )
    }

    /// Die Datei, in der die Zeile unter `point` liegt (zum Lesen, bevor eine Notiz angelegt wird)
    func sourcePath(on page: PDFPage, at point: CGPoint) -> String? {
        let syncPoint = SyncTeXCoordinates.syncTeXPoint(fromPDF: point, mediaBox: page.bounds(for: .mediaBox))
        return backward(document.index(for: page) + 1, syncPoint).flatMap { MarkPaths.relative($0.file, to: root) }
    }

    private func anchor(on page: PDFPage, at point: CGPoint, words: [String], isStart: Bool) throws -> MarkAnchor {
        let syncPoint = SyncTeXCoordinates.syncTeXPoint(fromPDF: point, mediaBox: page.bounds(for: .mediaBox))
        guard let location = backward(document.index(for: page) + 1, syncPoint) else { throw Failure.noSourceLine }
        guard let path = MarkPaths.relative(location.file, to: root) else { throw Failure.outsideProject }
        guard let lines = linesOf(path) else { throw Failure.noSourceLine }
        let line = MarkAnchorLocator.bestLine(near: location.line, containing: words, in: lines)
        var anchor = MarkAnchorLocator.anchor(path: path, line: line, in: lines, words: words)
        let characterIndex = page.characterIndex(at: point)
        guard let forward, !words.isEmpty, characterIndex >= 0 else { return anchor }
        let resolver = MarkResolver(root: root, document: document, linesOf: linesOf, forward: forward, isNewerThanPDF: { _ in false })
        if let found = resolver.occurrence(for: anchor, isStart: isStart, characterIndex: characterIndex) {
            anchor.matchedWords = found.words
            anchor.occurrence = found.occurrence
        }
        return anchor
    }
}
