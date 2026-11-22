import Foundation

/// Fachwörter aus Mathematik, Informatik, Physik und angrenzenden Gebieten, die die Rechtschreibprüfung von macOS nicht
/// kennt. Die Prüfung selbst bleibt die des Systems; der Editor lässt nur Treffer fallen, die dieses Vokabular erklärt
/// (`LatexTextView.setSpellingState`, `EditorCoordinator.textView(_:didCheckTextIn:…)`). Das persönliche Wörterbuch
/// des Nutzers bleibt unberührt.
///
/// Gespeichert sind Grundformen (Wortlisten in `TechnicalWords`, ohne Beugung); `accepts` erkennt dazu:
/// - gebeugte Formen (Mehrzahl, Genitiv, Steigerung, Verbformen),
/// - Zusammensetzungen aus zwei oder mehr Teilen, die alle bekannt sind: Teile des Vokabulars oder Wörter, die die
///   Systemprüfung selbst kennt (`Matrixberechnung`, `Eigenwertproblem`, `Quantenfouriertransformation`).
struct TechnicalVocabulary: Sendable {
    static let standard = TechnicalVocabulary(
        nouns: TechnicalWords.nouns, adjectives: TechnicalWords.adjectives,
        verbs: TechnicalWords.verbs, names: TechnicalWords.names
    )

    private static let minimumWordLength = 4
    /// Jeder Teil einer Zusammensetzung hat mindestens so viele Buchstaben (sonst passte fast alles zusammen)
    private static let minimumPartLength = 3
    private static let maximumCompoundParts = 4

    private static let nounEndings = ["", "e", "en", "n", "s", "es", "er", "ern", "ens", "se", "sen"]
    private static let adjectiveEndings = ["", "e", "en", "er", "es", "em", "keit", "keiten", "heit", "heiten", "lich", "erweise", "weise"]
    /// Verben sind als Wortstamm gespeichert (`optimier` für `optimieren`)
    private static let verbEndings = ["", "e", "en", "est", "st", "t", "et", "te", "ten", "tet", "end", "ung", "ungen", "bar", "er", "ern", "erung"]
    private static let nameEndings = ["", "s", "sche", "schen", "scher", "sches", "schem", "ian", "ianer"]
    /// Fugenelemente zwischen den Teilen einer Zusammensetzung (`Zufall|s|variable`, `Quant|en|computer`)
    private static let linkingElements = ["", "s", "n", "en", "e", "es", "er", "ens"]

    private let nouns: Set<String>
    private let adjectives: Set<String>
    private let verbs: Set<String>
    private let names: Set<String>

    /// Wortlisten: durch Leerraum getrennt, Groß-/Kleinschreibung egal
    init(nouns: String, adjectives: String, verbs: String, names: String) {
        self.nouns = Self.parse(nouns)
        self.adjectives = Self.parse(adjectives)
        self.verbs = Self.parse(verbs)
        self.names = Self.parse(names)
    }

    private static func parse(_ list: String) -> Set<String> {
        Set(list.split(whereSeparator: \.isWhitespace).map { $0.lowercased() })
    }

    var wordCount: Int { nouns.count + adjectives.count + verbs.count + names.count }

    /// Erklärt das Vokabular dieses Wort? `isKnown` fragt die Systemprüfung nach einem ganzen Wort (für Teile einer
    /// Zusammensetzung, die nicht im Vokabular stehen, z. B. `Berechnung` in `Matrixberechnung`).
    func accepts(_ word: String, isKnown: (String) -> Bool) -> Bool {
        let lowered = word.lowercased()
        guard lowered.count >= Self.minimumWordLength else { return false }
        return isInflectedEntry(lowered) || isCompound(Substring(lowered), parts: 1, isKnown: isKnown)
    }

    // MARK: Einzelwörter

    private func isInflectedEntry(_ word: String) -> Bool {
        Self.matches(word, in: nouns, endings: Self.nounEndings)
            || Self.matches(word, in: adjectives, endings: Self.adjectiveEndings)
            || Self.matches(word, in: verbs, endings: Self.verbEndings)
            || Self.matches(word, in: names, endings: Self.nameEndings)
    }

    private static func matches(_ word: String, in entries: Set<String>, endings: [String]) -> Bool {
        endings.contains { ending in
            guard word.hasSuffix(ending), word.count - ending.count >= minimumPartLength else { return false }
            return entries.contains(String(word.dropLast(ending.count)))
        }
    }

    // MARK: Zusammensetzungen

    /// Zerlegt `word` in Teile: vorne ein Vokabelwort (mit Fugenelement) und hinten ein gebeugtes Vokabelwort, ein vom
    /// System bekanntes Wort oder wieder eine Zusammensetzung – oder vorne ein vom System bekanntes Wort und hinten ein
    /// Vokabelwort.
    private func isCompound(_ word: Substring, parts: Int, isKnown: (String) -> Bool) -> Bool {
        let length = word.count
        guard parts < Self.maximumCompoundParts, length >= 2 * Self.minimumPartLength else { return false }
        for split in Self.minimumPartLength...(length - Self.minimumPartLength) {
            let splitIndex = word.index(word.startIndex, offsetBy: split)
            let head = String(word[..<splitIndex])
            let tail = word[splitIndex...]
            if isVocabularyPrefix(head), isRemainder(tail, parts: parts, isKnown: isKnown) { return true }
            if isInflectedEntry(String(tail)), isKnownPrefix(head, isKnown: isKnown) { return true }
        }
        return false
    }

    private func isRemainder(_ tail: Substring, parts: Int, isKnown: (String) -> Bool) -> Bool {
        let text = String(tail)
        return isInflectedEntry(text) || isKnownByChecker(text, isKnown: isKnown)
            || isCompound(tail, parts: parts + 1, isKnown: isKnown)
    }

    /// Vorderer Teil aus dem Vokabular, mit oder ohne Fugenelement (`Zufalls`, `Quanten`)
    private func isVocabularyPrefix(_ head: String) -> Bool {
        Self.withoutLinkingElement(head).contains { candidate in
            nouns.contains(candidate) || adjectives.contains(candidate) || names.contains(candidate)
        }
    }

    /// Vorderer Teil, den die Systemprüfung kennt (dann ohne Fugenelement, großgeschrieben)
    private func isKnownPrefix(_ head: String, isKnown: (String) -> Bool) -> Bool {
        Self.withoutLinkingElement(head).contains { isKnownByChecker($0, isKnown: isKnown) }
    }

    private func isKnownByChecker(_ part: String, isKnown: (String) -> Bool) -> Bool {
        guard part.count >= Self.minimumPartLength else { return false }
        return isKnown(part.capitalized) || isKnown(part)
    }

    private static func withoutLinkingElement(_ head: String) -> [String] {
        linkingElements.compactMap { element in
            guard head.hasSuffix(element), head.count - element.count >= minimumPartLength else { return nil }
            return String(head.dropLast(element.count))
        }
    }
}
