import AppKit
import Foundation
import PDFKit
@testable import LatexEditor

/// Ein kleines PDF mit bekannten Zeilen und eine erfundene SyncTeX-Abbildung dazu (Quellzeile → PDF-Zeilen)
@MainActor
struct MarkFixture {
    static let pageHeight: CGFloat = 792
    static let left: CGFloat = 72
    static let firstRowTop: CGFloat = 100
    static let rowPitch: CGFloat = 20
    static let rowHeight: CGFloat = 16

    let root: URL
    let rows: [String]
    let document: PDFDocument
    /// Quellzeile (1-basiert) → die PDF-Zeilen, die sie setzt
    var layout: [Int: ClosedRange<Int>]

    init(rows: [String], layout: [Int: ClosedRange<Int>], root: URL = URL(fileURLWithPath: "/tmp/projekt")) {
        self.root = root
        self.rows = rows
        self.layout = layout
        document = Self.makeDocument(rows)
    }

    private static func makeDocument(_ rows: [String]) -> PDFDocument {
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 612, height: pageHeight)
        let context = CGContext(consumer: CGDataConsumer(data: data)!, mediaBox: &box, nil)!
        context.beginPDFPage(nil)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont(name: "Helvetica", size: 12)!]
        for (index, row) in rows.enumerated() {
            NSAttributedString(string: row, attributes: attributes)
                .draw(at: CGPoint(x: left, y: pageHeight - top(of: index) - 12))
        }
        NSGraphicsContext.restoreGraphicsState()
        context.endPDFPage()
        context.closePDF()
        return PDFDocument(data: data as Data)!
    }

    static func top(of row: Int) -> CGFloat { firstRowTop + CGFloat(row) * rowPitch }

    /// Wie SyncTeX: Rechteck oben links, y nach unten; mehrere Zeilen ergeben die Vereinigung
    func forward(_ file: URL, _ line: Int) -> SyncTeXBox? {
        guard let range = layout[line] else { return nil }
        let top = Self.top(of: range.lowerBound) - 2
        let bottom = Self.top(of: range.upperBound) - 2 + Self.rowHeight
        return SyncTeXBox(page: 1, rect: CGRect(x: Self.left, y: top, width: 468, height: bottom - top))
    }

    func backward(_ page: Int, _ point: CGPoint) -> SyncTeXSourceLocation? {
        guard let (line, _) = layout.first(where: { _, rows in
            (Self.top(of: rows.lowerBound) - 2...Self.top(of: rows.upperBound) + Self.rowHeight).contains(point.y)
        }) else { return nil }
        return SyncTeXSourceLocation(file: root.appendingPathComponent("main.tex"), line: line)
    }

    /// Auswahl vom Anfang des ersten bis zum Ende des zweiten Textes (im Text der Seite)
    func selection(from first: String, to last: String) -> PDFSelection? {
        guard let page = document.page(at: 0), let text = page.string as NSString? else { return nil }
        let start = text.range(of: first)
        let end = text.range(of: last)
        guard start.location != NSNotFound, end.location != NSNotFound else { return nil }
        return page.selection(for: NSRange(location: start.location, length: NSMaxRange(end) - start.location))
    }
}
