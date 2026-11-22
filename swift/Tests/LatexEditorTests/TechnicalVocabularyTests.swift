import AppKit
import Testing
@testable import LatexEditor

@Suite("Fachvokabular für die Rechtschreibung")
struct TechnicalVocabularyTests {
    private let vocabulary = TechnicalVocabulary.standard

    /// Stand-in für die Systemprüfung: kennt nur diese Wörter (großgeschrieben)
    private func accepts(_ word: String, known: Set<String> = []) -> Bool {
        vocabulary.accepts(word) { known.contains($0) }
    }

    @Test("Grundformen, egal ob groß oder klein geschrieben")
    func baseForms() {
        for word in ["Eigenwert", "eigenwert", "Hamiltonoperator", "Qubit", "Verschränkung", "Dekohärenz", "Kryptografie", "Mutex", "Hilbertraum"] {
            #expect(accepts(word), "\(word)")
        }
    }

    @Test("Gebeugte Formen: Mehrzahl, Genitiv, Verbformen, Steigerung")
    func inflections() {
        for word in ["Eigenwerte", "Eigenwerten", "Eigenwertes", "Qubits", "Matrizen", "Tensoren", "Algorithmen", "optimiert", "Optimierung",
                     "optimierte", "diagonalisierbare", "Stetigkeit", "Gaußsche", "Hamiltonsches"] {
            #expect(accepts(word), "\(word)")
        }
    }

    @Test("Zusammensetzungen aus Vokabelwörtern, mit und ohne Fugenelement")
    func compounds() {
        for word in ["Matrixmultiplikation", "Eigenwertproblem", "Zufallszahlengenerator", "Quantenfouriertransformation",
                     "Quantenalgorithmus", "Fehlerkorrekturcode", "Wahrscheinlichkeitsverteilung", "Laufzeitanalyse", "Gaußverfahren"] {
            #expect(accepts(word), "\(word)")
        }
    }

    @Test("Zusammensetzung mit einem Teil, den nur die Systemprüfung kennt (vorn oder hinten)")
    func compoundsWithSystemWords() {
        #expect(!accepts("Matrixschublade"))
        #expect(accepts("Matrixschublade", known: ["Schublade"]))
        #expect(accepts("Schaltkreisgröße", known: ["Größe"]))
        #expect(accepts("Zeitplanqubit", known: ["Zeitplan"]))
        #expect(accepts("Hausmatrix", known: ["Haus"]))
    }

    @Test("Tippfehler und zufällige Buchstabenfolgen werden nicht durchgewunken")
    func rejectsMisspellings() {
        for word in ["Eigenwertt", "Matrixmultiplikazion", "Qbit", "Algoritmus", "Xyzzy", "Hallo", "Tisch", "abc", "Haus"] {
            #expect(!accepts(word), "\(word)")
        }
        #expect(!accepts("Matrixmultiplikazion", known: ["Berechnung", "Haus"]))
    }

    @Test("Zu kurze Wörter und Wortteile zählen nicht")
    func shortWords() {
        #expect(!accepts("Ab"))
        #expect(!accepts("Ich"))
        #expect(!accepts("Rang\u{200B}"))
    }

    @Test("Umfang des Vokabulars und keine Leerlisten")
    func size() {
        #expect(vocabulary.wordCount > 4_000)
    }
}

@MainActor
@Suite("Fachwörter im echten Rechtschreibfilter", .serialized)
struct TechnicalVocabularyEditorTests {
    @Test("Treffer der Systemprüfung auf Fachwörter werden verworfen, andere bleiben")
    func filtersSpellingResults() {
        let text = "Der Eigenwertproblem Qubits Quatsch xyzzyq"
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/fachwort.tex"), text: text)
        let fixture = EditorFixture(text: text)
        let coordinator = EditorCoordinator()
        _ = coordinator.makeScrollView()
        coordinator.update(session: session, jump: nil, insert: nil)
        let string = text as NSString
        let ranges = ["Eigenwertproblem", "Qubits", "Quatsch", "xyzzyq"].map { string.range(of: $0) }
        let results = ranges.map { NSTextCheckingResult.spellCheckingResult(range: $0) }
        let kept = coordinator.textView(
            fixture.textView, didCheckTextIn: NSRange(location: 0, length: string.length), types: NSTextCheckingResult.CheckingType.spelling.rawValue,
            options: [:], results: results, orthography: NSOrthography(), wordCount: 4
        )
        #expect(kept.map(\.range) == [ranges[2], ranges[3]])
    }
}
