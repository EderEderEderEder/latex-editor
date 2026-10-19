import Foundation

/// Ein Hinweis im Fließtext (blau gepunktet unterstrichen, Erklärung im Tooltip). Kein Fehler: LaTeX kompiliert trotzdem.
struct WritingHint: Equatable, Sendable {
    enum Kind: Sendable {
        case repeatedWord
        case spaceBeforePunctuation
        case missingSpace
        case multipleSpaces
        case abbreviationSpacing
        case ellipsis
        case straightQuote
        case lowercaseSentenceStart
        case twoInitialCapitals
    }

    let kind: Kind
    let range: NSRange
    let message: String
}

/// Einfache, verlässliche Regeln statt einer Grammatikprüfung (die von macOS kann kein Deutsch, LanguageTool
/// bräuchte Java oder Internet). Geprüft wird nur Fließtext: nicht in der Präambel, nicht in Befehlen, Schlüsseln,
/// Optionen, Mathe, Kommentaren, Code und `\verb`.
enum WritingHints {
    /// Einstellung „Schreibhinweise anzeigen“ (Menü Bearbeiten)
    static let enabledKey = "writingHints"
    static let maximumCount = 1_000

    private static let documentBegin = "\\begin{document}"

    private struct Rule: Sendable {
        let kind: WritingHint.Kind
        let expression: NSRegularExpression
        /// Gruppe, die unterstrichen wird (0 = ganzer Treffer)
        var group = 0
        /// Meldung zum Treffer; `nil` verwirft ihn
        let message: @Sendable (NSTextCheckingResult, NSString) -> String?
    }

    private static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static let rules: [Rule] = [
        Rule(kind: .repeatedWord, expression: regex(#"(?<![\p{L}\\])(\p{L}{2,})(?:[ \t]+|[ \t]*\n[ \t]*)(\1)(?!\p{L})"#, .caseInsensitive),
             group: 2) { match, text in "„\(text.substring(with: match.range(at: 2)))“ steht zweimal hintereinander." },
        Rule(kind: .spaceBeforePunctuation, expression: regex(#"(?<=[\p{L}\}])[ \t]+(?=[,;:!?]|\.(?![.\d]))"#)) { _, _ in
            "Leerzeichen vor dem Satzzeichen."
        },
        Rule(kind: .missingSpace, expression: regex(#"(?<=\p{L})[,;](?=\p{L})|(?<=\p{Ll}\p{Ll})\.(?=\p{Lu}\p{Ll})"#)) { match, text in
            "Nach „\(text.substring(with: match.range))“ fehlt ein Leerzeichen."
        },
        Rule(kind: .multipleSpaces, expression: regex(#"(?<=[\p{L}\d.,;:!?)\}])[ ]{2,}(?=[\p{L}\d(\\])"#)) { _, _ in
            "Mehrere Leerzeichen hintereinander (im PDF wirkt nur eines)."
        },
        Rule(kind: .abbreviationSpacing, expression: regex(#"(?<![\p{L}\\.])(\p{L})\.( ?)(\p{L})\.(?!\p{L})"#)) { match, text in
            let first = text.substring(with: match.range(at: 1))
            let second = text.substring(with: match.range(at: 3))
            // Zwei Großbuchstaben sind meist Initialen („J. R.“)
            guard first.lowercased() == first else { return nil }
            return "Abkürzung mit schmalem Abstand setzen: \(first).\\,\(second)."
        },
        Rule(kind: .ellipsis, expression: regex(#"(?<![.\\])\.\.\.(?!\.)"#)) { _, _ in
            "Auslassungspunkte mit \\dots setzen (gleichmäßige Abstände)."
        },
        Rule(kind: .straightQuote, expression: regex(#"(?:^|(?<=[\s(]))"(?=\p{L})|(?<=[\p{L}.,!?])"(?=[\s.,;:!?)]|$)"#, .anchorsMatchLines)) { _, _ in
            "Gerade Anführungszeichen: besser \\enquote{…} oder „…“."
        },
        Rule(kind: .lowercaseSentenceStart, expression: regex(#"(?:[.!?](?:[ \t]+\n?|\n)[ \t]*|\n[ \t]*\n\s*)(\p{Ll}\p{L}*)(?![\p{L}\d\\{])"#), group: 1) { match, text in
            let range = match.range(at: 1)
            let word = text.substring(with: range)
            guard Capitalization.isAllLowercase(word), Capitalization.startsSentence(at: range.location, in: text) else { return nil }
            return "Satzanfang klein geschrieben: „\(word.prefix(1).uppercased() + word.dropFirst())“?"
        },
        Rule(kind: .twoInitialCapitals, expression: regex(#"(?<![\p{L}\\])\p{Lu}\p{Lu}\p{Ll}+(?!\p{L})"#)) { match, text in
            Capitalization.fixingTwoInitialCapitals(text.substring(with: match.range)).map { "Zwei Großbuchstaben am Wortanfang: „\($0)“?" }
        },
    ]

    /// Alle Hinweise eines .tex-Texts, nach Position sortiert (höchstens `maximumCount`). Läuft im Hintergrund.
    static func hints(in text: String) -> [WritingHint] {
        let original = text as NSString
        let maskedText = LatexMasking.scannable(text)
        let masked = maskedText as NSString
        var highlighter = SyntaxHighlighter()
        let tokens = highlighter.highlightAll(original, lines: LineIndex(text: original))
        let begin = masked.range(of: documentBegin)
        let start = begin.location == NSNotFound ? 0 : NSMaxRange(begin)
        let body = NSRange(location: start, length: masked.length - start)

        var hints: [WritingHint] = []
        for rule in rules {
            for match in rule.expression.matches(in: maskedText, range: body) {
                let range = match.range(at: rule.group)
                guard isProse(range, original: original, masked: masked, tokens: tokens),
                      let message = rule.message(match, masked) else { continue }
                hints.append(WritingHint(kind: rule.kind, range: range, message: message))
            }
        }
        hints.sort { $0.range.location < $1.range.location }
        return Array(hints.prefix(maximumCount))
    }

    /// Nicht maskiert (kein Kommentar/Code) und kein Syntax-Token (Befehl, Schlüssel, Mathe …)
    private static func isProse(_ range: NSRange, original: NSString, masked: NSString, tokens: [SyntaxToken]) -> Bool {
        guard range.location != NSNotFound, range.length > 0 else { return false }
        return original.substring(with: range) == masked.substring(with: range) && !tokens.containsOverlap(with: range)
    }
}
