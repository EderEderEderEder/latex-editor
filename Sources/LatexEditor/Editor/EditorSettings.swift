import AppKit

/// Einstellungen des Editors aus dem Fenster „Einstellungen“ (⌘,), gespeichert in UserDefaults.
/// Nach einer Änderung `EditorSettings.didChange(affectsText:)`: Editor, offene Dateien und Ruler übernehmen sie sofort
/// (derselbe Weg wie der Zoom). Die Schalter für Schreiben und Kompilieren liegen bei ihren Features.
enum EditorSettings {
    enum Key {
        static let colorScheme = "editorColorScheme"
        static let fontFamily = "editorFontFamily"
        /// Nicht `editorFontSize`: Das war die frühere Zoom-Einstellung (`InterfaceZoom.migrateLegacySetting`)
        static let fontSize = "editorBaseFontSize"
        static let lineSpacing = "editorLineSpacing"
        static let showsLineNumbers = "showsLineNumbers"
        static let highlightsCurrentLine = "highlightsCurrentLine"
        static let wrapsLines = "wrapsLines"
        static let indentation = "indentation"
        static let tabWidth = "tabWidth"
        static let checksSpelling = "checksSpelling"
        static let spellingLanguage = "spellingLanguage"

        /// Bereiche „Darstellung“, „Editor“ und „Rechtschreibung“ (für „Standard wiederherstellen“)
        static let appearanceTab = [colorScheme, fontFamily, fontSize, lineSpacing, showsLineNumbers, highlightsCurrentLine]
        static let editorTab = [wrapsLines, indentation, tabWidth]
        static let spellingTab = [checksSpelling, spellingLanguage]
    }

    static let fontSizes: [Double] = Array(stride(from: 10.0, through: 24.0, by: 1.0))
    static let defaultFontSize = Double(EditorAppearance.defaultFontSize)
    static let tabWidths = [2, 4, 8]
    static let defaultTabWidth = 4
    /// Leer: die Festbreitenschrift des Systems (SF Mono)
    static let systemFontFamily = ""

    private static var defaults: UserDefaults { .standard }

    // MARK: Werte

    static var colorScheme: EditorColorScheme { value(Key.colorScheme, default: .standard) }
    static var lineSpacing: LineSpacing { value(Key.lineSpacing, default: .normal) }
    static var indentation: Indentation { value(Key.indentation, default: .tab) }
    static var spellingLanguage: SpellingLanguage { value(Key.spellingLanguage, default: .austrianGerman) }
    static var fontFamily: String { defaults.string(forKey: Key.fontFamily) ?? systemFontFamily }
    static var showsLineNumbers: Bool { flag(Key.showsLineNumbers) }
    static var highlightsCurrentLine: Bool { flag(Key.highlightsCurrentLine) }
    static var wrapsLines: Bool { flag(Key.wrapsLines) }
    static var checksSpelling: Bool { flag(Key.checksSpelling) }

    static var fontSize: Double { fontSize(in: defaults) }
    static var tabWidth: Int { tabWidth(in: defaults) }

    /// Auf 10–24 pt begrenzt (ein von Hand gesetzter Wert außerhalb bleibt brauchbar)
    static func fontSize(in store: UserDefaults) -> Double {
        let stored = store.object(forKey: Key.fontSize) as? Double ?? defaultFontSize
        return min(max(stored, fontSizes[0]), fontSizes[fontSizes.count - 1])
    }

    static func tabWidth(in store: UserDefaults) -> Int {
        let stored = store.object(forKey: Key.tabWidth) as? Int ?? defaultTabWidth
        return tabWidths.contains(stored) ? stored : defaultTabWidth
    }

    /// Unbekannter Wert (z. B. aus einer späteren Version) → Standard
    static func value<T: RawRepresentable>(_ key: String, default fallback: T, in store: UserDefaults = .standard) -> T
        where T.RawValue == String {
        store.string(forKey: key).flatMap(T.init(rawValue:)) ?? fallback
    }

    /// Alle Schalter dieses Fensters sind standardmäßig an
    static func flag(_ key: String, in store: UserDefaults = .standard) -> Bool {
        store.object(forKey: key) as? Bool ?? true
    }

    // MARK: Ändern

    /// Nur die Ansicht ändert sich (Farbschema, Zeilennummern, Umbruch, Einrückung, Rechtschreibung): Der Text der
    /// offenen Dateien bleibt, wie er ist (kein Neu-Layout aller Dateien).
    static let viewDidChange = Notification.Name("EditorViewSettingsDidChange")

    /// Ändert sich der Text (Schrift, Größe, Zeilenabstand, Tabbreite), übernehmen Editor, alle offenen Dateien und
    /// Ruler die Werte (wie beim Zoom); sonst nur die Ansicht. Hell/Dunkel folgt immer dem System (kein eigener Schalter,
    /// HIG `dark-mode.md`).
    @MainActor
    static func didChange(affectsText: Bool) {
        NotificationCenter.default.post(name: affectsText ? EditorAppearance.fontDidChange : viewDidChange, object: nil)
    }

    @MainActor
    static func reset(_ keys: [String]) {
        for key in keys { defaults.removeObject(forKey: key) }
        didChange(affectsText: true)
    }

    // MARK: Schrift

    /// Installierte Festbreitenschriften (Familien), alphabetisch; die Systemschrift steht gesondert davor.
    static func monospacedFamilies() -> [String] {
        let manager = NSFontManager.shared
        return manager.availableFontFamilies.filter { family in
            guard !family.hasPrefix("."), let font = manager.font(withFamily: family, traits: [], weight: 5, size: 12) else { return false }
            return font.isFixedPitch
        }.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    /// Gewählte Schrift; fehlt sie (deinstalliert), die Systemschrift
    static func font(size: CGFloat) -> NSFont {
        let family = fontFamily
        guard family != systemFontFamily,
              let font = NSFontManager.shared.font(withFamily: family, traits: [], weight: 5, size: size) else {
            return NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
        }
        return font
    }
}

enum LineSpacing: String, CaseIterable, Identifiable {
    case compact
    case normal
    case wide

    var id: String { rawValue }

    var title: String {
        switch self {
        case .compact: "Eng"
        case .normal: "Normal"
        case .wide: "Weit"
        }
    }

    var lineHeightMultiple: CGFloat {
        switch self {
        case .compact: 1.0
        case .normal: 1.2
        case .wide: 1.4
        }
    }
}

enum Indentation: String, CaseIterable, Identifiable {
    case tab
    case twoSpaces
    case fourSpaces

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tab: "Tabulator"
        case .twoSpaces: "2 Leerzeichen"
        case .fourSpaces: "4 Leerzeichen"
        }
    }

    /// Was ein Einrücken einfügt
    var unit: String {
        switch self {
        case .tab: "\t"
        case .twoSpaces: "  "
        case .fourSpaces: "    "
        }
    }
}

enum SpellingLanguage: String, CaseIterable, Identifiable {
    case austrianGerman
    case german
    case english

    var id: String { rawValue }

    var title: String {
        switch self {
        case .austrianGerman: "Deutsch (Österreich)"
        case .german: "Deutsch (Deutschland)"
        case .english: "Englisch"
        }
    }

    /// In dieser Reihenfolge versucht; nicht jedes macOS hat jede Variante
    var candidates: [String] {
        switch self {
        case .austrianGerman: ["de_AT", "de_DE", "de"]
        case .german: ["de_DE", "de"]
        case .english: ["en", "en_US", "en_GB"]
        }
    }
}
