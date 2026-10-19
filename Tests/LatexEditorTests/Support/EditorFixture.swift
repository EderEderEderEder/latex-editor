import AppKit
@testable import LatexEditor

/// Echter TextKit-1-Stapel wie im Editor (ohne Fenster), mit Ruler und Session.
@MainActor
struct EditorFixture {
    static let defaultSize = NSSize(width: 600, height: 800)

    let session: DocumentSession
    let textView: LatexTextView
    let scrollView: NSScrollView
    let ruler: LineNumberRulerView

    init(text: String, size: NSSize = defaultSize) {
        session = DocumentSession(url: URL(fileURLWithPath: "/tmp/fixture.tex"), text: text)

        let layoutManager = NSLayoutManager()
        layoutManager.allowsNonContiguousLayout = true
        session.textStorage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: NSSize(width: size.width, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)

        textView = LatexTextView(frame: NSRect(origin: .zero, size: size), textContainer: container)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = .width

        scrollView = NSScrollView(frame: NSRect(origin: .zero, size: size))
        scrollView.documentView = textView
        ruler = LineNumberRulerView(textView: textView, scrollView: scrollView)
        let session = session
        ruler.lineIndexProvider = { session.lineIndex }
    }

    /// Simuliert eine Eingabe auf Storage-Ebene (löst den kompletten Bearbeitungspfad aus).
    func replace(_ range: NSRange, with string: String) {
        session.textStorage.replaceCharacters(in: range, with: string)
    }

    func color(at location: Int) -> NSColor? {
        session.textStorage.attribute(.foregroundColor, at: location, effectiveRange: nil) as? NSColor
    }

    func labels(in rect: NSRect) -> [LineNumberRulerView.Label] {
        ruler.visibleLabels(in: rect, lines: session.lineIndex)
    }

    /// Layoutet die Zielzeile wie `scrollRangeToVisible` und berechnet die Nummern um sie herum.
    func labelsAfterJump(toLine line: Int) -> [LineNumberRulerView.Label] {
        guard let layoutManager = textView.layoutManager else { return [] }
        let range = session.lineIndex.fullRange(ofLine: line)
        layoutManager.ensureLayout(forCharacterRange: range)
        let glyph = layoutManager.glyphIndexForCharacter(at: range.location)
        let fragment = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let visible = NSRect(x: 0, y: fragment.minY, width: Self.defaultSize.width, height: Self.defaultSize.height)
        return labels(in: visible)
    }
}
