import Foundation

/// Stelle im PDF in SyncTeX-Koordinaten: PDF-Punkte (bp), Ursprung oben links der Seite, y nach unten.
struct SyncTeXBox: Equatable, Sendable {
    /// 1-basiert
    let page: Int
    let rect: CGRect
}

struct SyncTeXSourceLocation: Equatable, Sendable {
    let file: URL
    /// 1-basiert
    let line: Int
}

enum SyncTeXError: Error, Equatable {
    case notGzip
    case corrupt
}

/// Entpackt gzip mit dem `Compression`-Framework von macOS (keine externen Werkzeuge).
enum Gzip {
    private static let magic: [UInt8] = [0x1F, 0x8B]
    private static let deflateMethod: UInt8 = 8
    private static let headerLength = 10
    private static let trailerLength = 8
    private static let flagHeaderCRC: UInt8 = 0x02
    private static let flagExtra: UInt8 = 0x04
    private static let flagName: UInt8 = 0x08
    private static let flagComment: UInt8 = 0x10

    static func isGzip(_ data: Data) -> Bool {
        data.count >= headerLength && data.prefix(2).elementsEqual(magic)
    }

    static func decompress(_ data: Data) throws -> Data {
        let bytes = [UInt8](data)
        guard isGzip(data), bytes[2] == deflateMethod else { throw SyncTeXError.notGzip }
        let start = try payloadStart(bytes)
        guard bytes.count - trailerLength > start else { throw SyncTeXError.corrupt }
        let payload = Data(bytes[start..<(bytes.count - trailerLength)])
        // `.zlib` ist bei Apple rohes DEFLATE (RFC 1951) ohne zlib-Kopf, also genau der gzip-Inhalt.
        guard let decompressed = try? (payload as NSData).decompressed(using: .zlib) else { throw SyncTeXError.corrupt }
        return decompressed as Data
    }

    /// Überspringt den gzip-Kopf mit seinen optionalen Feldern (RFC 1952).
    private static func payloadStart(_ bytes: [UInt8]) throws -> Int {
        let flags = bytes[3]
        var position = headerLength
        if flags & flagExtra != 0 {
            guard position + 2 <= bytes.count else { throw SyncTeXError.corrupt }
            position += 2 + Int(bytes[position]) + Int(bytes[position + 1]) << 8
        }
        for flag in [flagName, flagComment] where flags & flag != 0 {
            guard let end = bytes[min(position, bytes.count)...].firstIndex(of: 0) else { throw SyncTeXError.corrupt }
            position = end + 1
        }
        if flags & flagHeaderCRC != 0 { position += 2 }
        guard position <= bytes.count else { throw SyncTeXError.corrupt }
        return position
    }
}

/// Umrechnung zwischen SyncTeX (oben links, y nach unten) und PDFKit-Seitenkoordinaten (unten links).
enum SyncTeXCoordinates {
    static func pdfRect(from box: CGRect, mediaBox: CGRect) -> CGRect {
        CGRect(x: mediaBox.minX + box.minX, y: mediaBox.maxY - box.maxY, width: box.width, height: box.height)
    }

    static func syncTeXPoint(fromPDF point: CGPoint, mediaBox: CGRect) -> CGPoint {
        CGPoint(x: point.x - mediaBox.minX, y: mediaBox.maxY - point.y)
    }
}

/// Eingelesene SyncTeX-Daten mit Vorwärtssuche (Quelltext → PDF) und Rückwärtssuche (PDF → Quelltext).
/// Liest `main.synctex.gz` selbst; kein `synctex`-Programm nötig.
struct SyncTeXIndex: Sendable {
    struct Record: Sendable {
        let kind: UInt8
        let tag: Int32
        let line: Int32
        let page: Int32
        let x: Int32
        let y: Int32
        let width: Int32
        let height: Int32
        let depth: Int32
        /// Index der umschließenden Box oder -1
        let parent: Int32
        /// Bei Boxen: erster Index nach dem Box-Inhalt
        var end: Int32
    }

    /// TeX-Punkte (sp) pro PDF-Punkt (bp): 65536 · 72,27 / 72
    private static let scaledPointsPerBigPoint = 65_781.76
    private static let defaultMagnification = 1_000.0
    /// Höhe einer Markierung, wenn ein Element ohne umschließende Zeilenbox gefunden wurde (bp)
    private static let fallbackLineHeight: CGFloat = 10

    let inputs: [Int32: URL]
    let records: [Record]
    let pageRanges: [Int: Range<Int>]
    let unit: Double
    let magnification: Double
    let xOffset: Double
    let yOffset: Double
    /// Pro normalisiertem Dateipfad: Indizes in `records`, sortiert nach Zeile, dann Position.
    /// Eine Datei kann mehrfach in der `Input:`-Liste stehen; ihre Nummern sind hier schon zusammengeführt.
    private let recordsByPath: [String: [Int]]

    static func load(contentsOf url: URL) throws -> SyncTeXIndex {
        let measurement = Signposts.begin("SyncTeXLoad")
        defer { measurement.end() }
        let data = try Data(contentsOf: url)
        return try parse(Gzip.isGzip(data) ? Gzip.decompress(data) : data)
    }

    static func parse(_ data: Data) throws -> SyncTeXIndex {
        var parser = SyncTeXParser()
        try data.withUnsafeBytes { raw in
            try parser.parse(raw.bindMemory(to: UInt8.self))
        }
        return SyncTeXIndex(parser: parser)
    }

    private init(parser: SyncTeXParser) {
        inputs = parser.inputs.mapValues { URL(fileURLWithPath: $0) }
        records = parser.records
        pageRanges = parser.pageRanges
        unit = parser.unit
        magnification = parser.magnification
        xOffset = parser.xOffset
        yOffset = parser.yOffset
        recordsByPath = Self.groupByPath(parser.records, inputs: parser.inputs)
    }

    /// Vergleichsschlüssel für Pfade: `/./`, `..`, Symlinks (`/tmp` → `/private/tmp`) aufgelöst.
    static func normalizedPath(_ url: URL) -> String {
        url.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL.path
    }

    private static func groupByPath(_ records: [Record], inputs: [Int32: String]) -> [String: [Int]] {
        let pathsByTag = inputs.mapValues { normalizedPath(URL(fileURLWithPath: $0)) }
        var groups: [String: [Int]] = [:]
        for (index, record) in records.enumerated() where record.line > 0 && isLocatable(record.kind) {
            guard let path = pathsByTag[record.tag] else { continue }
            groups[path, default: []].append(index)
        }
        return groups.mapValues { indices in
            indices.sorted { (records[$0].line, $0) < (records[$1].line, $1) }
        }
    }

    private static func isLocatable(_ kind: UInt8) -> Bool {
        kind != SyncTeXParser.vbox
    }
}

// MARK: - Vorwärtssuche

extension SyncTeXIndex {
    /// Stelle im PDF zur Quelltextzeile. Gibt es die Zeile nicht (Leerzeile, veraltete Daten),
    /// wird die nächste Zeile davor genommen, sonst die nächste danach.
    func forward(file: URL, line: Int) -> SyncTeXBox? {
        guard let candidates = recordsByPath[Self.normalizedPath(file)],
              let matching = recordsOfBestLine(in: candidates, near: Int32(clamping: line)),
              let page = matching.map({ records[$0].page }).min() else { return nil }
        let onPage = matching.filter { records[$0].page == page }
        let leaves = onPage.filter { !Self.isBox(records[$0].kind) }
        let rects = (leaves.isEmpty ? onPage : leaves).compactMap(highlightRect(for:))
        guard let first = rects.first else { return nil }
        return SyncTeXBox(page: Int(page), rect: rects.dropFirst().reduce(first) { $0.union($1) })
    }

    /// Einträge der gesuchten Zeile; fehlt sie, die der nächsten Zeile davor, sonst danach (Binärsuche).
    private func recordsOfBestLine(in candidates: [Int], near target: Int32) -> ArraySlice<Int>? {
        guard !candidates.isEmpty else { return nil }
        let firstAtOrAfter = lowerBound(in: candidates, line: target)
        let hasExact = firstAtOrAfter < candidates.count && records[candidates[firstAtOrAfter]].line == target
        let chosen: Int32
        if hasExact {
            chosen = target
        } else if firstAtOrAfter > 0 {
            chosen = records[candidates[firstAtOrAfter - 1]].line
        } else {
            chosen = records[candidates[firstAtOrAfter]].line
        }
        let start = lowerBound(in: candidates, line: chosen)
        let end = lowerBound(in: candidates, line: chosen + 1)
        return candidates[start..<end]
    }

    private func lowerBound(in candidates: [Int], line: Int32) -> Int {
        var low = 0
        var high = candidates.count
        while low < high {
            let middle = (low + high) / 2
            if records[candidates[middle]].line < line { low = middle + 1 } else { high = middle }
        }
        return low
    }

    /// Rechteck der Zeilenbox (hbox), in der das Element steht.
    private func highlightRect(for index: Int) -> CGRect? {
        var current = index
        while current >= 0 {
            let record = records[current]
            if record.kind == SyncTeXParser.hbox, record.width > 0 { return boxRect(record) }
            current = Int(record.parent)
        }
        let record = records[index]
        let point = CGPoint(x: toBigPoints(record.x, offset: xOffset), y: toBigPoints(record.y, offset: yOffset))
        return CGRect(x: point.x, y: point.y - Self.fallbackLineHeight, width: 1, height: Self.fallbackLineHeight)
    }

    private func boxRect(_ record: Record) -> CGRect {
        let left = toBigPoints(record.x, offset: xOffset)
        let baseline = toBigPoints(record.y, offset: yOffset)
        let height = toBigPoints(record.height, offset: 0)
        return CGRect(x: left, y: baseline - height, width: toBigPoints(record.width, offset: 0),
                      height: height + toBigPoints(record.depth, offset: 0))
    }

    private func toBigPoints(_ value: Int32, offset: Double) -> CGFloat {
        CGFloat((Double(value) * unit * magnification / Self.defaultMagnification + offset) / Self.scaledPointsPerBigPoint)
    }

    private static func isBox(_ kind: UInt8) -> Bool {
        kind == SyncTeXParser.hbox || kind == SyncTeXParser.vbox
    }
}

// MARK: - Rückwärtssuche

extension SyncTeXIndex {
    /// Quelltextstelle zu einem Punkt auf einer Seite (SyncTeX-Koordinaten). Nur `.tex`-Dateien,
    /// Treffer in Hilfsdateien (`.toc`, `.aux`, …) ergeben nil.
    func backward(page: Int, point: CGPoint) -> SyncTeXSourceLocation? {
        guard let range = pageRanges[page] else { return nil }
        guard let box = lineBox(at: point, in: range) else { return nil }
        let content = (box + 1)..<Int(records[box].end)
        let leaf = content
            .filter { !Self.isBox(records[$0].kind) && records[$0].line > 0 && isTeXSource(records[$0].tag) }
            .min { horizontalDistance(of: $0, to: point) < horizontalDistance(of: $1, to: point) }
        let source = leaf ?? box
        guard records[source].line > 0, isTeXSource(records[source].tag),
              let file = inputs[records[source].tag] else { return nil }
        return SyncTeXSourceLocation(file: file.standardizedFileURL, line: Int(records[source].line))
    }

    /// Kleinste Zeilenbox, die den Punkt enthält; sonst die vertikal nächstgelegene.
    private func lineBox(at point: CGPoint, in range: Range<Int>) -> Int? {
        let boxes = range.filter { records[$0].kind == SyncTeXParser.hbox && records[$0].width > 0 }
        let containing = boxes.filter { boxRect(records[$0]).contains(point) }
        if let smallest = containing.min(by: { area(of: $0) < area(of: $1) }) { return smallest }
        return boxes.min { verticalDistance(of: $0, to: point) < verticalDistance(of: $1, to: point) }
    }

    private func area(of index: Int) -> CGFloat {
        let rect = boxRect(records[index])
        return rect.width * rect.height
    }

    private func verticalDistance(of index: Int, to point: CGPoint) -> CGFloat {
        let rect = boxRect(records[index])
        if point.y < rect.minY { return rect.minY - point.y }
        return max(point.y - rect.maxY, 0)
    }

    private func horizontalDistance(of index: Int, to point: CGPoint) -> CGFloat {
        abs(toBigPoints(records[index].x, offset: xOffset) - point.x)
    }

    private func isTeXSource(_ tag: Int32) -> Bool {
        inputs[tag]?.pathExtension.lowercased() == "tex"
    }
}

// MARK: - Parser

/// Liest das SyncTeX-Textformat zeilenweise auf Byte-Ebene.
private struct SyncTeXParser {
    static let vbox = UInt8(ascii: "[")
    static let hbox = UInt8(ascii: "(")
    private static let vboxClose = UInt8(ascii: "]")
    private static let hboxClose = UInt8(ascii: ")")
    private static let pageOpen = UInt8(ascii: "{")
    private static let pageClose = UInt8(ascii: "}")
    private static let voidHBox = UInt8(ascii: "h")
    private static let voidVBox = UInt8(ascii: "v")
    private static let kern = UInt8(ascii: "k")
    private static let glue = UInt8(ascii: "g")
    private static let current = UInt8(ascii: "x")
    private static let math = UInt8(ascii: "$")
    private static let rule = UInt8(ascii: "r")
    private static let newline = UInt8(ascii: "\n")
    private static let inputPrefix = Array("Input:".utf8)
    private static let unitPrefix = Array("Unit:".utf8)
    private static let magnificationPrefix = Array("Magnification:".utf8)
    private static let xOffsetPrefix = Array("X Offset:".utf8)
    private static let yOffsetPrefix = Array("Y Offset:".utf8)

    var inputs: [Int32: String] = [:]
    var records: [SyncTeXIndex.Record] = []
    var pageRanges: [Int: Range<Int>] = [:]
    var unit = 1.0
    var magnification = 1_000.0
    var xOffset = 0.0
    var yOffset = 0.0
    private var page: Int32 = 0
    private var pageStart = 0
    private var openBoxes: [Int] = []

    mutating func parse(_ bytes: UnsafeBufferPointer<UInt8>) throws {
        guard let base = bytes.baseAddress else { throw SyncTeXError.corrupt }
        var start = 0
        while start < bytes.count {
            let found = memchr(base + start, Int32(Self.newline), bytes.count - start)
            let end = found.map { base.distance(to: $0.assumingMemoryBound(to: UInt8.self)) } ?? bytes.count
            parseLine(UnsafeBufferPointer(rebasing: bytes[start..<end]))
            start = end + 1
        }
        guard !records.isEmpty || !inputs.isEmpty else { throw SyncTeXError.corrupt }
    }

    private mutating func parseLine(_ line: UnsafeBufferPointer<UInt8>) {
        guard let first = line.first else { return }
        switch first {
        case Self.vbox, Self.hbox, Self.voidHBox, Self.voidVBox, Self.rule:
            addRecord(line, kind: first, fieldCount: 7)
        case Self.kern:
            addRecord(line, kind: first, fieldCount: 5)
        case Self.glue, Self.current, Self.math:
            addRecord(line, kind: first, fieldCount: 4)
        case Self.vboxClose, Self.hboxClose:
            closeBox()
        case Self.pageOpen:
            page = Int32(clamping: Self.integers(in: line, from: 1, count: 1).first ?? 0)
            pageStart = records.count
            openBoxes = []
        case Self.pageClose:
            pageRanges[Int(page)] = pageStart..<records.count
        default:
            parseHeader(line)
        }
    }

    private mutating func addRecord(_ line: UnsafeBufferPointer<UInt8>, kind: UInt8, fieldCount: Int) {
        let values = Self.integers(in: line, from: 1, count: fieldCount)
        guard values.count >= 4, page > 0 else { return }
        let value = { (index: Int) in Int32(clamping: index < values.count ? values[index] : 0) }
        records.append(SyncTeXIndex.Record(
            kind: kind, tag: value(0), line: value(1), page: page, x: value(2), y: value(3),
            width: value(4), height: value(5), depth: value(6),
            parent: Int32(openBoxes.last ?? -1), end: Int32(records.count + 1)
        ))
        if kind == Self.vbox || kind == Self.hbox { openBoxes.append(records.count - 1) }
    }

    private mutating func closeBox() {
        guard let box = openBoxes.popLast() else { return }
        records[box].end = Int32(records.count)
    }

    private mutating func parseHeader(_ line: UnsafeBufferPointer<UInt8>) {
        if Self.hasPrefix(line, Self.inputPrefix) {
            let rest = UnsafeBufferPointer(rebasing: line[Self.inputPrefix.count...])
            guard let colon = rest.firstIndex(of: UInt8(ascii: ":")),
                  let tag = Self.integers(in: rest, from: 0, count: 1).first else { return }
            inputs[Int32(clamping: tag)] = String(decoding: UnsafeBufferPointer(rebasing: rest[(colon + 1)...]), as: UTF8.self)
        } else if Self.hasPrefix(line, Self.unitPrefix) {
            unit = Double(Self.integers(in: line, from: Self.unitPrefix.count, count: 1).first ?? 1)
        } else if Self.hasPrefix(line, Self.magnificationPrefix) {
            magnification = Double(Self.integers(in: line, from: Self.magnificationPrefix.count, count: 1).first ?? 1_000)
        } else if Self.hasPrefix(line, Self.xOffsetPrefix) {
            xOffset = Double(Self.integers(in: line, from: Self.xOffsetPrefix.count, count: 1).first ?? 0)
        } else if Self.hasPrefix(line, Self.yOffsetPrefix) {
            yOffset = Double(Self.integers(in: line, from: Self.yOffsetPrefix.count, count: 1).first ?? 0)
        }
    }

    /// Liest bis zu `count` ganze Zahlen (mit Vorzeichen) ab `start`; Trenner sind `,` und `:`.
    private static func integers(in line: UnsafeBufferPointer<UInt8>, from start: Int, count: Int) -> [Int] {
        var values: [Int] = []
        values.reserveCapacity(count)
        var position = start
        while position < line.count, values.count < count {
            let isNegative = line[position] == UInt8(ascii: "-")
            if isNegative { position += 1 }
            var value = 0
            var hasDigits = false
            while position < line.count, line[position] >= UInt8(ascii: "0"), line[position] <= UInt8(ascii: "9") {
                value = value &* 10 &+ Int(line[position] - UInt8(ascii: "0"))
                hasDigits = true
                position += 1
            }
            guard hasDigits else { break }
            values.append(isNegative ? -value : value)
            position += 1
        }
        return values
    }

    private static func hasPrefix(_ line: UnsafeBufferPointer<UInt8>, _ prefix: [UInt8]) -> Bool {
        line.count >= prefix.count && zip(line, prefix).allSatisfy { $0 == $1 }
    }
}
