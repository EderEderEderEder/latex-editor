import AppKit

/// Farben eines Schemas für eine Helligkeit. `nil` bei Hintergrund und Text: die Systemfarben (`textBackgroundColor`, `textColor`).
struct EditorPalette: Sendable {
    var background: UInt32?
    var text: UInt32?
    var command: UInt32
    var delimiter: UInt32
    var argument: UInt32
    var math: UInt32
    var comment: UInt32
    var verbatim: UInt32
}

/// Farbschemata des Editors, je mit heller und dunkler Variante (folgt dem Erscheinungsbild).
/// Alle Farben haben mindestens 4,5:1 Kontrast zum Hintergrund, „Hoher Kontrast“ mindestens 7:1 (`EditorThemeTests`).
enum EditorColorScheme: String, CaseIterable, Identifiable, Sendable {
    case standard
    case classic
    case solarized
    case highContrast

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: "Standard"
        case .classic: "Klassisch"
        case .solarized: "Solarized"
        case .highContrast: "Hoher Kontrast"
        }
    }

    var minimumContrast: Double { self == .highContrast ? 7 : 4.5 }

    func palette(dark: Bool) -> EditorPalette {
        switch (self, dark) {
        case (.standard, false):
            EditorPalette(command: 0x1F5FBF, delimiter: 0x5A6B85, argument: 0x8A3FB8, math: 0x1B7F3B, comment: 0x737373, verbatim: 0xA0522D)
        case (.standard, true):
            EditorPalette(command: 0x6CB4FF, delimiter: 0x9AA8BD, argument: 0xD09CFF, math: 0x7DD38B, comment: 0x7F8A93, verbatim: 0xE3A06B)
        case (.classic, false):
            EditorPalette(background: 0xFFFFFF, text: 0x000000, command: 0x9B2393, delimiter: 0x5C6670, argument: 0x0B4F79,
                          math: 0x1C00CF, comment: 0x5D6C79, verbatim: 0xC41A16)
        case (.classic, true):
            EditorPalette(background: 0x1F1F24, text: 0xDFDFE0, command: 0xFC5FA3, delimiter: 0xA6A6AD, argument: 0x5DD8FF,
                          math: 0xD0BF69, comment: 0x8A99A6, verbatim: 0xFC6A5D)
        case (.solarized, false):
            EditorPalette(background: 0xFDF6E3, text: 0x3E5159, command: 0x1A6AA6, delimiter: 0x5C6E73, argument: 0x8C3B8A,
                          math: 0x5F7300, comment: 0x62706F, verbatim: 0xA8521E)
        case (.solarized, true):
            EditorPalette(background: 0x002B36, text: 0xA4B1B1, command: 0x4FA8E8, delimiter: 0x93A1A1, argument: 0xC79BE0,
                          math: 0xA9B83A, comment: 0x869799, verbatim: 0xE08A4E)
        case (.highContrast, false):
            EditorPalette(background: 0xFFFFFF, text: 0x000000, command: 0x0033B3, delimiter: 0x333333, argument: 0x6B00A8,
                          math: 0x005A1E, comment: 0x4D4D4D, verbatim: 0x8B2500)
        case (.highContrast, true):
            EditorPalette(background: 0x000000, text: 0xFFFFFF, command: 0x8CCBFF, delimiter: 0xD0D0D0, argument: 0xE2B6FF,
                          math: 0x8CF0A0, comment: 0xBBBBBB, verbatim: 0xFFB57A)
        }
    }
}

/// Dynamische Farben des aktiven Schemas. Sie werden erst beim Zeichnen ausgewertet: Ein Schemawechsel braucht nur
/// ein Neuzeichnen, keine neue Tokenisierung und keine Änderung im Text (Undo und „geändert“ bleiben unberührt).
enum EditorTheme {
    static let background = color(\.background, system: .textBackgroundColor)
    static let text = color(\.text, system: .textColor)
    static let command = color(\.command)
    static let delimiter = color(\.delimiter)
    static let argument = color(\.argument)
    static let math = color(\.math)
    static let comment = color(\.comment)
    static let verbatim = color(\.verbatim)

    static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }

    private static func color(_ keyPath: KeyPath<EditorPalette, UInt32>) -> NSColor {
        NSColor(name: nil) { appearance in
            rgb(EditorSettings.colorScheme.palette(dark: isDark(appearance))[keyPath: keyPath])
        }
    }

    private static func color(_ keyPath: KeyPath<EditorPalette, UInt32?>, system: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            resolved(keyPath, scheme: EditorSettings.colorScheme, dark: isDark(appearance), system: system)
        }
    }

    /// Hintergrund oder Text eines Schemas; ohne eigene Farbe die Systemfarbe
    static func resolved(_ keyPath: KeyPath<EditorPalette, UInt32?>, scheme: EditorColorScheme, dark: Bool, system: NSColor) -> NSColor {
        scheme.palette(dark: dark)[keyPath: keyPath].map(rgb) ?? system
    }

    static func rgb(_ hex: UInt32) -> NSColor {
        let maximum: CGFloat = 255
        return NSColor(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / maximum,
            green: CGFloat((hex >> 8) & 0xFF) / maximum,
            blue: CGFloat(hex & 0xFF) / maximum,
            alpha: 1
        )
    }
}
