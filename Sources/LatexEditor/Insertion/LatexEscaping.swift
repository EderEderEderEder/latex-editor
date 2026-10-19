import Foundation

/// Maskiert Sonderzeichen, damit Nutzertext in LaTeX als reiner Text erscheint.
enum LatexEscaping {
    private static let replacements: [Character: String] = [
        "\\": "\\textbackslash{}",
        "&": "\\&",
        "%": "\\%",
        "$": "\\$",
        "#": "\\#",
        "_": "\\_",
        "{": "\\{",
        "}": "\\}",
        "~": "\\textasciitilde{}",
        "^": "\\textasciicircum{}"
    ]

    /// Zeilenumbrüche werden zu Leerzeichen, damit eine Zelle oder Beschriftung einzeilig bleibt.
    static func escape(_ text: String) -> String {
        var result = ""
        result.reserveCapacity(text.count)
        for character in text {
            if character.isNewline {
                result.append(" ")
            } else if let replacement = replacements[character] {
                result += replacement
            } else {
                result.append(character)
            }
        }
        return result
    }
}

/// Erzeugt Label-Namen aus Beschriftungen („Ergebnisse der Messung“ → `tab:ergebnisse-der-messung`).
enum LabelNaming {
    private static let maximumWords = 5
    private static let maximumLength = 40
    private static let transliterations: [Character: String] = [
        "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "ae", "Ö": "oe", "Ü": "ue"
    ]

    static func slug(_ text: String) -> String {
        var words: [String] = []
        var current = ""
        for character in text {
            if let replacement = transliterations[character] {
                current += replacement
            } else if character.isASCII, character.isLetter || character.isNumber {
                current.append(Character(character.lowercased()))
            } else if !current.isEmpty {
                words.append(current)
                current = ""
            }
        }
        if !current.isEmpty { words.append(current) }
        return String(words.prefix(maximumWords).joined(separator: "-").prefix(maximumLength))
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    /// `prefix:slug`, bei Kollision mit `-2`, `-3`, …
    static func label(prefix: String, caption: String, fallback: String, existing: Set<String>) -> String {
        let slug = slug(caption)
        let base = "\(prefix):\(slug.isEmpty ? fallback : slug)"
        guard existing.contains(base) else { return base }
        var number = 2
        while existing.contains("\(base)-\(number)") { number += 1 }
        return "\(base)-\(number)"
    }
}

/// Setzt einen Block (mehrere Zeilen, endet mit Zeilenumbruch) sauber in eine Zeile ein.
enum BlockPlacement {
    private static let newline = UInt16(UInt8(ascii: "\n"))

    /// Steht der Cursor mitten in einer Zeile, beginnt der Block in einer neuen Zeile.
    /// Folgt direkt ein Zeilenumbruch, wird der des Blocks weggelassen (keine Leerzeile).
    static func adjust(_ block: String, in text: NSString, replacing range: NSRange) -> String {
        let range = range.clamped(toLength: text.length)
        var result = block
        let atLineStart = range.location == 0 || text.character(at: range.location - 1) == newline
        if !atLineStart { result = "\n" + result }
        let end = NSMaxRange(range)
        if end < text.length, text.character(at: end) == newline, result.hasSuffix("\n") {
            result.removeLast()
        }
        return result
    }
}
