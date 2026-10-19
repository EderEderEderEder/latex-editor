import Foundation

/// Eine Ersetzung im Text (UTF-16-Bereich)
struct TextCorrection: Equatable, Sendable {
    let range: NSRange
    let replacement: String
}

/// Groß-/Kleinschreibung im Fließtext: Satzanfang groß, „ZWei“ Großbuchstaben am Wortanfang.
/// Reine Logik auf NSString; ob eine Stelle Fließtext ist (keine Befehle, Mathe, Kommentare), prüft der Aufrufer.
enum Capitalization {
    /// Einstellung „Groß-/Kleinschreibung automatisch korrigieren“ (Menü Bearbeiten)
    static let automaticKey = "autoCapitalize"

    static var isAutomatic: Bool {
        UserDefaults.standard.object(forKey: automaticKey) as? Bool ?? true
    }

    /// Abkürzungen (klein, ohne Punkt), nach deren Punkt kein neuer Satz beginnt. Einzelbuchstaben
    /// („z. B.“, „d. h.“, Initialen) und Zahlen („3. Kapitel“) gelten ohnehin nicht als Satzende.
    static let abbreviations: Set<String> = [
        "bzw", "vgl", "ggf", "usw", "etc", "abb", "tab", "kap", "nr", "ca", "evtl", "inkl", "exkl", "bspw", "sog",
        "bzgl", "insb", "zzgl", "mio", "mrd", "dr", "prof", "hr", "fr", "jh", "jhd", "bd", "hrsg", "aufl", "ff", "vs",
        "resp", "al", "zit", "anm", "abs", "art", "gem", "lt", "max", "min", "mind", "orig", "st", "str", "tel", "ugs",
        "urspr", "verf", "vol", "eg", "ie", "cf", "fig", "eq", "sec", "ch", "pp", "ed", "eds", "approx", "no", "dipl",
        "ing", "mag", "bsp"
    ]

    /// Bei Wörtern aus Großbuchstaben + „s“ (Mehrzahl von Abkürzungen: „IDs“, „PCs“) nichts ändern
    private static let pluralSuffix = "s"
    private static let minimumTwoCapitalsLength = 3

    /// Korrektur für das Wort, das direkt vor `end` endet (gerade wurde ein Leerzeichen oder Satzzeichen getippt).
    static func correction(forWordEndingAt end: Int, in text: NSString) -> TextCorrection? {
        guard let range = word(endingAt: end, in: text) else { return nil }
        let word = text.substring(with: range)
        if let fixed = fixingTwoInitialCapitals(word) { return TextCorrection(range: range, replacement: fixed) }
        guard isAllLowercase(word), startsSentence(at: range.location, in: text) else { return nil }
        return TextCorrection(range: range, replacement: word.prefix(1).uppercased() + word.dropFirst())
    }

    /// „DIe“ → „Die“; `nil`, wenn nichts zu tun ist (auch bei „IDs“, „API“, „LaTeX“)
    static func fixingTwoInitialCapitals(_ word: String) -> String? {
        let characters = Array(word)
        guard characters.count >= minimumTwoCapitalsLength, characters[0].isUppercase, characters[1].isUppercase else { return nil }
        let rest = characters.dropFirst(2)
        guard rest.allSatisfy({ $0.isLetter && $0.isLowercase }), String(rest) != pluralSuffix else { return nil }
        return String(characters[0]) + String(characters[1...]).lowercased()
    }

    static func isAllLowercase(_ word: String) -> Bool {
        !word.isEmpty && word.allSatisfy { $0.isLetter && $0.isLowercase }
    }

    /// Wort aus Buchstaben direkt vor `end`; davor steht Leerraum, eine Klammer oder der Textanfang.
    static func word(endingAt end: Int, in text: NSString) -> NSRange? {
        guard end > 0, end <= text.length else { return nil }
        var start = end
        while start > 0, isLetter(text.character(at: start - 1)) { start -= 1 }
        guard start < end else { return nil }
        if start > 0 {
            let before = text.character(at: start - 1)
            guard isWhitespace(before) || before == Unit.openParenthesis else { return nil }
        }
        return NSRange(location: start, length: end - start)
    }

    /// Beginnt bei `wordStart` ein Satz? Nach `.`, `!`, `?` (nicht nach Abkürzung, Zahl oder „…“) oder am Absatzanfang.
    static func startsSentence(at wordStart: Int, in text: NSString) -> Bool {
        var index = wordStart - 1
        var newlines = 0
        while index >= 0 {
            let character = text.character(at: index)
            if character == Unit.newline {
                newlines += 1
            } else if !isWhitespace(character) {
                break
            }
            index -= 1
        }
        if newlines >= 2 { return true }
        guard index >= 0 else { return false }
        switch text.character(at: index) {
        case Unit.exclamation, Unit.question: return true
        case Unit.period: return isSentenceEndingPeriod(at: index, in: text)
        default: return false
        }
    }

    private static func isSentenceEndingPeriod(at period: Int, in text: NSString) -> Bool {
        guard period > 0 else { return false }
        let before = text.character(at: period - 1)
        if before == Unit.period { return false }
        var start = period
        while start > 0, isLetter(text.character(at: start - 1)) { start -= 1 }
        let length = period - start
        guard length > 0 else { return Unit.closers.contains(before) }
        guard length > 1 else { return false }
        let word = text.substring(with: NSRange(location: start, length: length)).lowercased()
        return !abbreviations.contains(word)
    }

    // MARK: Zeichen

    private enum Unit {
        static let newline = UInt16(UInt8(ascii: "\n"))
        static let period = UInt16(UInt8(ascii: "."))
        static let exclamation = UInt16(UInt8(ascii: "!"))
        static let question = UInt16(UInt8(ascii: "?"))
        static let openParenthesis = UInt16(UInt8(ascii: "("))
        /// Satzende nach Klammer, Anführung oder Formel: „(siehe oben).“, „\enquote{so}.“, „$x$.“
        static let closers: Set<UInt16> = Set(")]}\"'$“”«»".utf16)
    }

    static func isLetter(_ unit: UInt16) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return CharacterSet.letters.contains(scalar)
    }

    static func isWhitespace(_ unit: UInt16) -> Bool {
        unit == UInt16(UInt8(ascii: " ")) || unit == UInt16(UInt8(ascii: "\t")) || unit == UInt16(UInt8(ascii: "\r"))
            || unit == Unit.newline
    }
}

extension LatexEnvironments {
    private static let maximumNameLength = 40

    /// Liegt `location` im Inhalt einer Code-Umgebung (`lstlisting`, `PythonCode` …)? Sucht rückwärts nach dem
    /// letzten `\begin{…}` einer Code-Umgebung ohne zugehöriges `\end`. Nur für seltene Einzelprüfungen gedacht.
    static func isInsideCode(at location: Int, in text: NSString) -> Bool {
        var searchEnd = min(location, text.length)
        while searchEnd > 0 {
            let found = text.range(of: "\\begin{", options: .backwards, range: NSRange(location: 0, length: searchEnd))
            guard found.location != NSNotFound else { return false }
            searchEnd = found.location
            let nameStart = NSMaxRange(found)
            let window = NSRange(location: nameStart, length: min(maximumNameLength, text.length - nameStart))
            let close = text.range(of: "}", options: [], range: window)
            guard close.location != NSNotFound else { continue }
            let name = text.substring(with: NSRange(location: nameStart, length: close.location - nameStart))
            guard isCode(name) else { continue }
            let bodyStart = NSMaxRange(close)
            guard bodyStart <= location else { return false }
            let body = NSRange(location: bodyStart, length: location - bodyStart)
            return text.range(of: "\\end{\(name)}", options: [], range: body).location == NSNotFound
        }
        return false
    }
}
