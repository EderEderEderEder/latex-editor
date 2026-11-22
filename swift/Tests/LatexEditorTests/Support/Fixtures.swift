import Foundation

/// Temporärer Projektordner für Tests. Mit `remove()` aufräumen (per `defer`).
struct TemporaryProject {
    let root: URL

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("LatexEditorTests-\(UUID().uuidString)", isDirectory: true)
            .standardizedFileURL
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func url(_ relativePath: String) -> URL {
        root.appendingPathComponent(relativePath).standardizedFileURL
    }

    @discardableResult
    func write(_ relativePath: String, _ contents: String = "") throws -> URL {
        let fileURL = url(relativePath)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try contents.write(to: fileURL, atomically: true, encoding: .utf8)
        return fileURL
    }

    func makeDirectory(_ relativePath: String) throws {
        try FileManager.default.createDirectory(at: url(relativePath), withIntermediateDirectories: true)
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }
}

/// UserDefaults nur für einen Test. Der Suite-Name ist ein absoluter Pfad in einem eigenen Temp-Ordner: So landet die
/// .plist dort und nicht in ~/Library/Preferences (`removePersistentDomain` leert eine normale Suite nur, die Datei
/// bliebe liegen – so hatten sich dort Hunderte angesammelt). Den Temp-Ordner räumt macOS selbst auf.
func temporaryDefaults() -> UserDefaults {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("LatexEditorTests-Einstellungen-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    guard let defaults = UserDefaults(suiteName: directory.appendingPathComponent("einstellungen").path) else {
        preconditionFailure("UserDefaults für Tests konnten nicht angelegt werden")
    }
    return defaults
}

/// Erzeugt ein realistisches LaTeX-Dokument mit gemischten Konstrukten.
enum LargeDocument {
    static let defaultLineCount = 10_000

    static func make(lineCount: Int = defaultLineCount) -> String {
        var lines: [String] = []
        lines.reserveCapacity(lineCount + block(0).count)
        var blockIndex = 0
        while lines.count < lineCount {
            lines.append(contentsOf: block(blockIndex))
            blockIndex += 1
        }
        return lines.prefix(lineCount).joined(separator: "\n") + "\n"
    }

    private static func block(_ index: Int) -> [String] {
        [
            "\\section{Abschnitt \(index) mit \\emph{Betonung}}",
            "\\label{sec:abschnitt-\(index)}",
            "% Kommentar mit $Mathe$ und \\section{nicht echt}",
            "Ein Absatz mit Inline-Mathe $a_{\(index)}^2 + b^2 = c^2$ und Zitat \\cite{knuth1984,lamport1994}.",
            "Weiter mit 50\\,\\% Rabatt, Kosten von 5\\$ und \\verb|$x$ % kein Kommentar| im Text.",
            "Siehe Abbildung~\\ref{fig:bild-\(index)} sowie \\textbf{fetten \\textit{verschachtelten}} Text.",
            "Mehrzeiliger Absatz, der weiterläuft und \\( x \\in \\mathbb{R} \\) enthält, damit es realistisch ist,",
            "und noch eine Zeile mit gewöhnlichem deutschem Fließtext über Quantencomputer und Algorithmen.",
            "\\begin{equation}",
            "    E = mc^2 + \\sum_{i=0}^{n} \\frac{1}{i!} \\label{eq:\(index)}",
            "\\end{equation}",
            "\\[",
            "    \\int_0^1 f(x)\\,dx = \\left[ F(x) \\right]_0^1",
            "\\]",
            "\\begin{itemize}",
            "    \\item[a)] Erster Punkt mit \\texttt{code}",
            "    \\item Zweiter Punkt % mit Kommentar",
            "\\end{itemize}",
            "\\begin{figure}[htbp]",
            "    \\centering",
            "    \\includegraphics[width=0.8\\textwidth]{images/bild-\(index).pdf}",
            "    \\caption{Beschriftung \(index)}",
            "\\end{figure}",
            "",
            "Neuer Absatz nach einer Leerzeile mit $$ x^2 $$ Display-Mathe.",
            ""
        ]
    }
}

/// Median-Laufzeit über mehrere Durchläufe (robuster gegen Ausreißer als ein Einzelwert).
/// Schnellster von `iterations` Läufen. Nicht der mittlere: Im Gesamtlauf teilen sich über 100 Testgruppen die
/// Maschine, einzelne Läufe werden dann zufällig langsam (Gliederung 54 ms allein, bis 130 ms unter Last). Ein echter
/// Rückschritt macht jeden Lauf langsam und fällt auch beim schnellsten auf.
func fastestDuration(iterations: Int, _ body: () throws -> Void) rethrows -> Duration {
    let clock = ContinuousClock()
    var fastest = Duration.seconds(Int64.max)
    for _ in 0..<iterations {
        fastest = min(fastest, try clock.measure(body))
    }
    return fastest
}

extension Duration {
    var milliseconds: Double {
        Double(components.seconds) * 1_000 + Double(components.attoseconds) / 1e15
    }
}
