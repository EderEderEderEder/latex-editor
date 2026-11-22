import AppKit

/// Farben für Token-Arten. Nur `.foregroundColor` wird gesetzt, damit kein Neu-Layout der Glyphen nötig ist.
/// Die Farben kommen aus dem aktiven Farbschema (`EditorTheme`) und werden erst beim Zeichnen ausgewertet:
/// Hell/Dunkel und ein Schemawechsel brauchen nur ein Neuzeichnen.
@MainActor
enum SyntaxTheme {
    /// Setzt `range` auf die Grundfarbe und färbt danach die Tokens ein.
    static func apply(_ tokens: [SyntaxToken], in range: NSRange, to storage: NSTextStorage) {
        guard range.length > 0 else { return }
        storage.addAttribute(.foregroundColor, value: EditorTheme.text, range: range)
        for token in tokens {
            storage.addAttribute(.foregroundColor, value: color(for: token.kind), range: token.range)
        }
    }

    static func color(for kind: TokenKind) -> NSColor {
        switch kind {
        case .command: EditorTheme.command
        case .delimiter: EditorTheme.delimiter
        case .optionalArgument, .keyArgument: EditorTheme.argument
        case .math: EditorTheme.math
        case .comment: EditorTheme.comment
        case .verbatim: EditorTheme.verbatim
        }
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
