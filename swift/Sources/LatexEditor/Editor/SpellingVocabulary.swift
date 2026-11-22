import AppKit

/// Verbindet `TechnicalVocabulary` mit der Systemprüfung: Teile von Zusammensetzungen, die nicht im Vokabular stehen, fragt
/// es bei `NSSpellChecker` nach. Ergebnisse stehen im Zwischenspeicher (pro Wort einmal), er wird bei einem Sprachwechsel geleert.
@MainActor
enum SpellingVocabulary {
    private static let cacheLimit = 20_000
    private static var cache: [String: Bool] = [:]

    static func accepts(_ word: String) -> Bool {
        if let cached = cache[word] { return cached }
        let accepted = TechnicalVocabulary.standard.accepts(word, isKnown: systemKnows)
        if cache.count >= cacheLimit { cache.removeAll() }
        cache[word] = accepted
        return accepted
    }

    static func resetCache() {
        cache.removeAll()
    }

    private static func systemKnows(_ word: String) -> Bool {
        NSSpellChecker.shared.checkSpelling(of: word, startingAt: 0, language: nil, wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
            .location == NSNotFound
    }
}
