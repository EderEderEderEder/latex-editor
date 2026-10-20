import AppKit
import SwiftUI
import Testing
@testable import LatexEditor

/// Die Tests ändern nie die echten Einstellungen (UserDefaults.standard): Andere Testgruppen laufen parallel und
/// lesen sie. Werte werden über eine eigene UserDefaults-Suite bzw. direkt am Editor gesetzt.
@Suite("Einstellungen: Werte")
struct EditorSettingsValueTests {
    /// Eigene Suite im Temp-Ordner (`temporaryDefaults`), nie die echten Einstellungen
    private func withStore(_ body: (UserDefaults) throws -> Void) rethrows {
        try body(temporaryDefaults())
    }

    @Test("Standardwerte, wenn nichts gespeichert ist")
    func defaults() throws {
        try withStore { store in
            #expect(EditorSettings.value(EditorSettings.Key.appearance, default: AppAppearance.system, in: store) == .system)
            #expect(EditorSettings.value(EditorSettings.Key.colorScheme, default: EditorColorScheme.standard, in: store) == .standard)
            #expect(EditorSettings.fontSize(in: store) == 13)
            #expect(EditorSettings.tabWidth(in: store) == 4)
            for key in [EditorSettings.Key.showsLineNumbers, EditorSettings.Key.highlightsCurrentLine, EditorSettings.Key.wrapsLines,
                        EditorSettings.Key.checksSpelling] {
                #expect(EditorSettings.flag(key, in: store), "\(key) ist standardmäßig an")
            }
            #expect(EditorSettings.Key.fontSize != "editorFontSize", "Der alte Schlüssel gehört der Zoom-Übernahme")
        }
    }

    @Test("Ungültige Werte fallen auf Grenzen bzw. Standard zurück")
    func invalidValues() throws {
        try withStore { store in
            store.set(50.0, forKey: EditorSettings.Key.fontSize)
            #expect(EditorSettings.fontSize(in: store) == 24)
            store.set(5.0, forKey: EditorSettings.Key.fontSize)
            #expect(EditorSettings.fontSize(in: store) == 10)
            store.set(3, forKey: EditorSettings.Key.tabWidth)
            #expect(EditorSettings.tabWidth(in: store) == 4)
            store.set("lila", forKey: EditorSettings.Key.colorScheme)
            #expect(EditorSettings.value(EditorSettings.Key.colorScheme, default: EditorColorScheme.standard, in: store) == .standard)
        }
    }

    @Test("Einrückung, Sprache und Zeilenabstand: Werte der Auswahl")
    func choices() {
        #expect(Indentation.tab.unit == "\t" && Indentation.twoSpaces.unit == "  " && Indentation.fourSpaces.unit == "    ")
        #expect(SpellingLanguage.austrianGerman.candidates.first == "de_AT")
        #expect(LineSpacing.allCases.map(\.lineHeightMultiple) == [1.0, 1.2, 1.4])
        #expect(Set(EditorSettings.Key.appearanceTab).isDisjoint(with: EditorSettings.Key.editorTab))
    }

    @Test("Ausrücken nimmt eine Einrückung der gewählten Art weg")
    func outdentUnits() {
        let text = "    vier\n\tTab\n x" as NSString
        let whole = NSRange(location: 0, length: text.length)
        #expect(TextEditing.outdent(in: text, selection: whole, unit: "  ").text == "  vier\nTab\nx")
        #expect(TextEditing.outdent(in: text, selection: whole, unit: "\t").text == "vier\nTab\nx")
        #expect(TextEditing.indent(in: "a\n\nb" as NSString, selection: NSRange(location: 0, length: 4), unit: "  ").text == "  a\n\n  b")
    }
}

@Suite("Farbschemata")
struct EditorThemeTests {
    private func srgb(_ color: NSColor, dark: Bool) -> NSColor? {
        var result: NSColor?
        NSAppearance(named: dark ? .darkAqua : .aqua)?.performAsCurrentDrawingAppearance {
            result = color.usingColorSpace(.sRGB)
        }
        return result
    }

    private func luminance(_ color: NSColor) -> Double {
        func channel(_ value: CGFloat) -> Double {
            let component = Double(value)
            return component <= 0.03928 ? component / 12.92 : pow((component + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(color.redComponent) + 0.7152 * channel(color.greenComponent) + 0.0722 * channel(color.blueComponent)
    }

    private func contrast(_ first: NSColor, _ second: NSColor) -> Double {
        let (light, dark) = (max(luminance(first), luminance(second)), min(luminance(first), luminance(second)))
        return (light + 0.05) / (dark + 0.05)
    }

    @Test("Jede Farbe jedes Schemas hat genug Kontrast zum Hintergrund (4,5:1, Hoher Kontrast 7:1)", arguments: EditorColorScheme.allCases)
    func contrast(of scheme: EditorColorScheme) throws {
        for dark in [false, true] {
            let palette = scheme.palette(dark: dark)
            let background = try #require(srgb(EditorTheme.resolved(\.background, scheme: scheme, dark: dark, system: .textBackgroundColor), dark: dark))
            let text = try #require(srgb(EditorTheme.resolved(\.text, scheme: scheme, dark: dark, system: .textColor), dark: dark))
            let colors = [("Text", text)] + [("Befehl", palette.command), ("Klammer", palette.delimiter), ("Argument", palette.argument),
                                              ("Mathe", palette.math), ("Kommentar", palette.comment), ("Code", palette.verbatim)]
                .map { ($0.0, EditorTheme.rgb($0.1)) }
            for (name, color) in colors {
                let ratio = contrast(color, background)
                #expect(ratio >= scheme.minimumContrast, "\(scheme.title) \(dark ? "dunkel" : "hell"), \(name): \(ratio)")
            }
        }
    }

    @Test("Standard entspricht den bisherigen Farben (nichts ändert sich ohne Wahl)")
    func standardUnchanged() throws {
        let light = EditorColorScheme.standard.palette(dark: false)
        let dark = EditorColorScheme.standard.palette(dark: true)
        #expect(light.command == 0x1F5FBF && dark.command == 0x6CB4FF)
        #expect(light.comment == 0x737373 && dark.comment == 0x7F8A93)
        #expect(light.background == nil && light.text == nil, "System-Hintergrund und -Text wie bisher")
    }
}

@Suite("Einstellungen im Editor", .serialized)
@MainActor
struct EditorSettingsEditorTests {
    @Test("Absatzstil: Zeilenabstand und Tabbreite in Zeichen der Schrift")
    func paragraphStyle() {
        let font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        let style = EditorAppearance.paragraphStyle(font: font, lineSpacing: .wide, tabWidth: 8)
        let space = (" " as NSString).size(withAttributes: [.font: font]).width
        #expect(style.lineHeightMultiple == 1.4)
        #expect(abs(style.defaultTabInterval - 8 * space) < 0.001)
        #expect(style.tabStops.isEmpty)
    }

    @Test("Schrift und Absatzstil übernehmen ist kein Bearbeitungsschritt")
    func applyingIsNotAnEdit() {
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/einstellungen.tex"), text: "\\section{A}\nText\n")
        session.applyEditorFont()
        #expect(!session.isDirty)
        #expect(!session.undoManager.canUndo)
        #expect(session.textStorage.attribute(.paragraphStyle, at: 3, effectiveRange: nil) is NSParagraphStyle)
        #expect((session.textStorage.attribute(.font, at: 3, effectiveRange: nil) as? NSFont)?.pointSize == EditorAppearance.fontSize)
    }

    @Test("Zeilenumbruch aus: lange Zeilen laufen weiter, waagerechter Scroller; wieder an: Breite folgt dem Fenster")
    func lineWrapping() async throws {
        let harness = CompletionHarness(text: String(repeating: "Wort ", count: 400))
        try await harness.start()
        let scrollView = try #require(harness.window.contentView as? NSScrollView)
        let container = try #require(harness.textView.textContainer)

        harness.coordinator.applyLineWrapping(false)
        harness.textView.layoutManager?.ensureLayout(for: container)
        harness.textView.sizeToFit()
        #expect(!container.widthTracksTextView)
        #expect(scrollView.hasHorizontalScroller)
        #expect(harness.textView.frame.width > scrollView.contentSize.width * 2)

        harness.coordinator.applyLineWrapping(true)
        #expect(container.widthTracksTextView)
        #expect(!scrollView.hasHorizontalScroller)
        #expect(abs(harness.textView.frame.width - scrollView.contentSize.width) < 1)
    }

    @Test("Zeilennummern und aktuelle Zeile lassen sich abschalten")
    func lineNumbersAndCurrentLine() async throws {
        let harness = CompletionHarness(text: "eins\nzwei\n")
        try await harness.start()
        let scrollView = try #require(harness.window.contentView as? NSScrollView)
        #expect(scrollView.rulersVisible)
        harness.coordinator.showLineNumbers(false)
        #expect(!scrollView.rulersVisible)
        harness.coordinator.showLineNumbers(true)

        harness.textView.setSelectedRange(NSRange(location: 1, length: 0))
        harness.textView.updateCurrentLineHighlight()
        #expect(!harness.textView.currentLineRect.isEmpty)
        harness.textView.highlightsCurrentLine = false
        harness.textView.updateCurrentLineHighlight()
        #expect(harness.textView.currentLineRect.isEmpty)
    }

    @Test("Rechtschreibprüfung ab- und anschalten, Sprache wechseln")
    func spelling() async throws {
        let harness = CompletionHarness(text: "Text")
        try await harness.start()
        defer { harness.coordinator.applySpelling(checks: true, language: .austrianGerman) }

        harness.coordinator.applySpelling(checks: false, language: .austrianGerman)
        #expect(!harness.textView.isContinuousSpellCheckingEnabled)
        harness.coordinator.applySpelling(checks: true, language: .english)
        #expect(harness.textView.isContinuousSpellCheckingEnabled)
        if NSSpellChecker.shared.availableLanguages.contains(where: { $0.hasPrefix("en") }) {
            #expect(harness.coordinator.appliedSpellingLanguage?.hasPrefix("en") == true)
        }
    }
}

extension AppModelSuite {
    @Suite("Einstellungsfenster")
    @MainActor
    struct SettingsWindowTests {
        @Test("Das Fenster baut sich mit allen Reitern auf")
        func rendersOffscreen() throws {
            let view = NSHostingView(rootView: SettingsView(model: AppModel.shared))
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 600), styleMask: [.titled], backing: .buffered, defer: false)
            window.contentView = view
            view.layoutSubtreeIfNeeded()
            #expect(view.fittingSize.width > 0 && view.fittingSize.height > 0)
            window.contentView = NSView()
        }
    }
}
