import AppKit

/// Farben für Token-Arten. Nur `.foregroundColor` wird gesetzt, damit kein Neu-Layout der Glyphen nötig ist.
/// Die Farben sind dynamisch und passen sich Hell- und Dunkelmodus beim Zeichnen an.
@MainActor
enum SyntaxTheme {
    private static let command = dynamicColor(light: 0x1F5FBF, dark: 0x6CB4FF)
    private static let delimiter = dynamicColor(light: 0x5A6B85, dark: 0x9AA8BD)
    private static let argument = dynamicColor(light: 0x8A3FB8, dark: 0xD09CFF)
    private static let math = dynamicColor(light: 0x1B7F3B, dark: 0x7DD38B)
    private static let comment = dynamicColor(light: 0x8A8A8A, dark: 0x7F8A93)
    private static let verbatim = dynamicColor(light: 0xA0522D, dark: 0xE3A06B)

    /// Setzt `range` auf die Grundfarbe und färbt danach die Tokens ein.
    static func apply(_ tokens: [SyntaxToken], in range: NSRange, to storage: NSTextStorage) {
        guard range.length > 0 else { return }
        storage.addAttribute(.foregroundColor, value: NSColor.textColor, range: range)
        for token in tokens {
            storage.addAttribute(.foregroundColor, value: color(for: token.kind), range: token.range)
        }
    }

    static func color(for kind: TokenKind) -> NSColor {
        switch kind {
        case .command: command
        case .delimiter: delimiter
        case .optionalArgument, .keyArgument: argument
        case .math: math
        case .comment: comment
        case .verbatim: verbatim
        }
    }

    private static func dynamicColor(light: UInt32, dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return rgbColor(isDark ? dark : light)
        }
    }

    private nonisolated static func rgbColor(_ hex: UInt32) -> NSColor {
        let maxComponent: CGFloat = 255
        return NSColor(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / maxComponent,
            green: CGFloat((hex >> 8) & 0xFF) / maxComponent,
            blue: CGFloat(hex & 0xFF) / maxComponent,
            alpha: 1
        )
    }
}

extension Array where Element == SyntaxToken {
    /// Binärsuche in nach Position sortierten, überlappungsfreien Tokens.
    func containsOverlap(with range: NSRange) -> Bool {
        var low = 0
        var high = count
        while low < high {
            let middle = (low + high) / 2
            if NSMaxRange(self[middle].range) <= range.location {
                low = middle + 1
            } else {
                high = middle
            }
        }
        return low < count && self[low].location < NSMaxRange(range)
    }
}
