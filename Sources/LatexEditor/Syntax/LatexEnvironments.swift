import Foundation

/// Umgebungsnamen, deren Inhalt kein Fließtext ist. Gemeinsam für Wortzähler und Verweisprüfung.
enum LatexEnvironments {
    private static let verbatimLike: Set<String> = ["verbatim", "verbatim*", "lstlisting", "minted", "comment", "Verbatim"]
    private static let math: Set<String> = [
        "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*", "multline", "multline*",
        "flalign", "flalign*", "eqnarray", "eqnarray*", "displaymath", "math", "split",
    ]
    private static let graphics: Set<String> = ["tikzpicture", "pgfpicture"]
    /// Sprachumgebungen der HgbThesis (`PythonCode`, `JavaCode` …)
    private static let codeSuffix = "Code"

    /// Quelltext, der nicht gesetzt, sondern abgedruckt wird (Zeichen wie `%` oder `\ref` sind dort keine LaTeX-Befehle).
    /// Der Tokenizer färbt den Inhalt als Code.
    static func isCode(_ name: String) -> Bool {
        verbatimLike.contains(name) || (name.hasSuffix(codeSuffix) && name.count > codeSuffix.count)
    }

    static func isMath(_ name: String) -> Bool {
        math.contains(name)
    }

    /// Inhalt zählt nicht als Text (Code, Formeln, Zeichnungen)
    static func skipsContent(_ name: String) -> Bool {
        isCode(name) || isMath(name) || graphics.contains(name)
    }
}
