// Spike S2: unabhängige Referenz mit PDFKit (dieselbe Logik wie swift/Sources/LatexEditor/PDF/MarkResolver.swift,
// hier nachgebaut, die App selbst wird nicht verwendet). Wegwerfcode.
//
//   swift pdfkitReference.swift dump <pdf>                 Zeilen jeder Seite mit Rechteck (zum Festlegen der Testmarkierungen)
//   swift pdfkitReference.swift resolve <eingabe.json>     Segmente je Markierung als JSON auf stdout
//
// Koordinaten in der Ausgabe: PDF-Punkte, Ursprung oben links der Seite (wie SyncTeX), y nach unten.
import Foundation
import PDFKit

let rectTolerance: CGFloat = 1
let maximumWordsMatched = 3
let minimumLineHeight: CGFloat = 8

struct Box: Codable { let x: Double; let y: Double; let width: Double; let height: Double }
struct Side: Codable { let page: Int; let rect: Box; let words: [String] }
struct MarkInput: Codable { let id: String; let pdf: String; let start: Side; let end: Side }
struct Segment: Codable { let page: Int; let rect: Box }
struct MarkOutput: Codable {
    let id: String
    let precision: String
    let segments: [Segment]
    let text: String
}

func tokens(_ text: NSString) -> [(text: String, range: NSRange)] {
    let wordCharacters = CharacterSet.alphanumerics.union(.nonBaseCharacters)
    var result: [(String, NSRange)] = []
    var start: Int?
    for index in 0...text.length {
        let isWord = index < text.length && Unicode.Scalar(text.character(at: index)).map(wordCharacters.contains) == true
        if isWord {
            if start == nil { start = index }
        } else if let begin = start {
            let range = NSRange(location: begin, length: index - begin)
            result.append((text.substring(with: range).precomposedStringWithCompatibilityMapping.lowercased(), range))
            start = nil
        }
    }
    return result
}

/// SyncTeX (oben links) → PDFKit (unten links)
func pdfRect(_ box: Box, page: PDFPage) -> CGRect {
    let media = page.bounds(for: .mediaBox)
    var rect = CGRect(x: media.minX + box.x, y: media.maxY - box.y - box.height, width: box.width, height: box.height)
    if rect.height < minimumLineHeight { rect = rect.insetBy(dx: 0, dy: -(minimumLineHeight - rect.height) / 2) }
    return rect
}

func toBox(_ rect: CGRect, page: PDFPage) -> Box {
    let media = page.bounds(for: .mediaBox)
    return Box(x: rect.minX - media.minX, y: media.maxY - rect.maxY, width: rect.width, height: rect.height)
}

/// Mittelpunkte der Zeichen im Indexraum von `page.string`. Nicht `characterBounds(at:)`: Dessen Index läuft nach
/// Ligaturen gegen `page.string` auseinander (im Testdokument um ~17 Zeichen nach der ersten Absatzhälfte).
var centersCache: [ObjectIdentifier: [CGPoint?]] = [:]

func characterCenters(of page: PDFPage) -> [CGPoint?] {
    if let known = centersCache[ObjectIdentifier(page)] { return known }
    let length = (page.string as NSString?)?.length ?? 0
    let centers = (0..<length).map { index -> CGPoint? in
        guard let bounds = page.selection(for: NSRange(location: index, length: 1))?.bounds(for: page), !bounds.isEmpty else { return nil }
        return CGPoint(x: bounds.midX, y: bounds.midY)
    }
    centersCache[ObjectIdentifier(page)] = centers
    return centers
}

func charactersInside(_ rect: CGRect, page: PDFPage) -> NSRange? {
    let area = rect.insetBy(dx: -rectTolerance, dy: -rectTolerance)
    var first: Int?
    var last = 0
    for (index, center) in characterCenters(of: page).enumerated() {
        guard let center, area.contains(center) else { continue }
        first = first ?? index
        last = index
    }
    return first.map { NSRange(location: $0, length: last - $0 + 1) }
}

/// Erste (Anfang) bzw. letzte (Ende) Fundstelle von 3, 2, 1 Wörtern; ein einzelnes Wort nur, wenn eindeutig
func matchWords(_ words: [String], isStart: Bool, in range: NSRange, page: PDFPage) -> NSRange? {
    guard !words.isEmpty, let text = page.string as NSString? else { return nil }
    let found = tokens(text.substring(with: range) as NSString).map { ($0.text, NSRange(location: $0.range.location + range.location, length: $0.range.length)) }
    for count in stride(from: min(words.count, maximumWordsMatched), through: 1, by: -1) {
        let wanted = isStart ? Array(words.prefix(count)) : Array(words.suffix(count))
        let hits = found.indices.filter { index in
            index + count <= found.count && (0..<count).allSatisfy { found[index + $0].0 == wanted[$0] }
        }
        guard !hits.isEmpty, count > 1 || hits.count == 1 else { continue }
        let hit = isStart ? hits.first! : hits.last!
        return NSRange(location: found[hit].1.location, length: NSMaxRange(found[hit + count - 1].1) - found[hit].1.location)
    }
    return nil
}

/// Auswahl im Indexraum von `page.string` (über `page.selection(for: NSRange)`), auch über Seitengrenzen
func stringSelection(_ document: PDFDocument, from start: (PDFPage, Int), to end: (PDFPage, Int)) -> PDFSelection? {
    let first = document.index(for: start.0)
    let last = document.index(for: end.0)
    guard first <= last else { return nil }
    var combined: PDFSelection?
    for index in first...last {
        guard let page = document.page(at: index) else { continue }
        let length = (page.string as NSString?)?.length ?? 0
        let from = index == first ? start.1 : 0
        let to = index == last ? end.1 : length - 1
        guard to >= from, let part = page.selection(for: NSRange(location: from, length: to - from + 1)) else { continue }
        if let existing = combined { existing.add(part) } else { combined = part }
    }
    return combined
}

func resolve(_ mark: MarkInput, document: PDFDocument) -> MarkOutput {
    guard let startPage = document.page(at: mark.start.page - 1), let endPage = document.page(at: mark.end.page - 1) else {
        return MarkOutput(id: mark.id, precision: "orphaned", segments: [], text: "")
    }
    let startRect = pdfRect(mark.start.rect, page: startPage)
    let endRect = pdfRect(mark.end.rect, page: endPage)
    let startChars = charactersInside(startRect, page: startPage)
    let endChars = charactersInside(endRect, page: endPage)
    let startMatch = startChars.flatMap { matchWords(mark.start.words, isStart: true, in: $0, page: startPage) }
    let endMatch = endChars.flatMap { matchWords(mark.end.words, isStart: false, in: $0, page: endPage) }
    let precision = startMatch != nil && endMatch != nil ? "words" : "lines"
    if let startIndex = (startMatch ?? startChars)?.location, let endRange = endMatch ?? endChars,
       let selection = stringSelection(document, from: (startPage, startIndex), to: (endPage, NSMaxRange(endRange) - 1)) {
        let segments = selection.selectionsByLine().flatMap { line in
            line.pages.map { page in Segment(page: document.index(for: page) + 1, rect: toBox(line.bounds(for: page), page: page)) }
        }.filter { $0.rect.width > 0 }
        if !segments.isEmpty { return MarkOutput(id: mark.id, precision: precision, segments: segments, text: selection.string ?? "") }
    }
    let lines = [Segment(page: mark.start.page, rect: toBox(startRect, page: startPage)), Segment(page: mark.end.page, rect: toBox(endRect, page: endPage))]
    return MarkOutput(id: mark.id, precision: "lines", segments: lines, text: "")
}

func dump(_ path: String) {
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else { fatalError("PDF nicht lesbar: \(path)") }
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index), let all = page.selection(for: page.bounds(for: .mediaBox)) else { continue }
        print("=== Seite \(index + 1)")
        for line in all.selectionsByLine() {
            let box = toBox(line.bounds(for: page), page: page)
            print(String(format: "y=%6.1f x=%6.1f-%6.1f | ", box.y, box.x, box.x + box.width) + (line.string ?? "").replacingOccurrences(of: "\n", with: "⏎"))
        }
    }
}

/// Zeigt für eine Markierung den Text der Zeichen im SyncTeX-Rechteck (Fehlersuche)
func debug(_ mark: MarkInput) {
    guard let document = PDFDocument(url: URL(fileURLWithPath: mark.pdf)) else { return }
    for (name, side) in [("Anfang", mark.start), ("Ende", mark.end)] {
        guard let page = document.page(at: side.page - 1), let text = page.string as NSString? else { continue }
        let rect = pdfRect(side.rect, page: page)
        let range = charactersInside(rect, page: page)
        print("\(name) \(side.words) rect=\(rect) chars=\(String(describing: range))")
        guard let range else { continue }
        print("  »\(text.substring(with: range))«")
        for index in max(0, NSMaxRange(range) - 3)..<min(text.length, NSMaxRange(range) + 4) {
            let selection = page.selection(for: NSRange(location: index, length: 1))
            print("  [\(index)] \(text.substring(with: NSRange(location: index, length: 1))) characterBounds=\(page.characterBounds(at: index)) selection=»\(selection?.string ?? "-")« \(selection?.bounds(for: page) ?? .zero)")
        }
    }
}

let arguments = CommandLine.arguments
if arguments.count == 4 && arguments[1] == "debug" {
    let marks = try JSONDecoder().decode([MarkInput].self, from: Data(contentsOf: URL(fileURLWithPath: arguments[2])))
    marks.filter { $0.id == arguments[3] }.forEach(debug)
} else if arguments.count == 3 && arguments[1] == "dump" {
    dump(arguments[2])
} else if arguments.count == 3 && arguments[1] == "resolve" {
    let data = try Data(contentsOf: URL(fileURLWithPath: arguments[2]))
    let marks = try JSONDecoder().decode([MarkInput].self, from: data)
    var documents: [String: PDFDocument] = [:]
    let outputs = marks.map { mark -> MarkOutput in
        let document = documents[mark.pdf] ?? PDFDocument(url: URL(fileURLWithPath: mark.pdf))!
        documents[mark.pdf] = document
        return resolve(mark, document: document)
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    print(String(data: try encoder.encode(outputs), encoding: .utf8)!)
} else {
    print("Aufruf: dump <pdf> | resolve <eingabe.json>")
}
