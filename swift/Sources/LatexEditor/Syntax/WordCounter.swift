import Foundation

/// Zählt die Wörter des Fließtexts einer LaTeX-Datei – eine Näherung wie `texcount`, aber ohne Fremdwerkzeug:
/// Präambel, Kommentare, Formeln, Code, Befehle und ihre Schlüssel-Argumente (`\label`, `\ref`, `\cite`, Dateinamen …)
/// zählen nicht; der Text in `\textbf{…}`, Überschriften, Fußnoten und Beschriftungen schon.
enum WordCounter {
    static func count(in text: String) -> Int {
        var counter = Counter(Array(body(of: text).unicodeScalars))
        return counter.run()
    }

    /// Zwischen `\begin{document}` und `\end{document}`, falls vorhanden (Kapiteldateien: der ganze Text)
    private static func body(of text: String) -> Substring {
        var result = Substring(text)
        if let begin = result.range(of: "\\begin{document}") { result = result[begin.upperBound...] }
        if let end = result.range(of: "\\end{document}") { result = result[..<end.lowerBound] }
        return result
    }

    /// Befehle, deren folgende Argumente (in `{…}`, davor `[…]`) kein Text sind: Befehl → Anzahl
    private static let commandsSkippingArguments: [String: Int] = [
        "label": 1, "ref": 1, "eqref": 1, "pageref": 1, "autoref": 1, "Autoref": 1, "cref": 1, "Cref": 1, "vref": 1,
        "nameref": 1, "labelcref": 1, "cpageref": 1, "hyperref": 0,
        "cite": 1, "citep": 1, "citet": 1, "citealp": 1, "citeauthor": 1, "citeyear": 1, "citetitle": 1, "parencite": 1,
        "Parencite": 1, "textcite": 1, "Textcite": 1, "autocite": 1, "footcite": 1, "nocite": 1, "fullcite": 1,
        "input": 1, "include": 1, "includegraphics": 1, "includepdf": 1, "lstinputlisting": 1, "subfile": 1,
        "usepackage": 1, "RequirePackage": 1, "documentclass": 1, "usetikzlibrary": 1,
        "bibliography": 1, "bibliographystyle": 1, "addbibresource": 1, "graphicspath": 1,
        "url": 1, "href": 1, "hypersetup": 1, "pagestyle": 1, "thispagestyle": 1, "geometry": 1, "lstset": 1,
        "captionsetup": 1, "hyphenation": 1, "pagenumbering": 1,
        "setlength": 2, "setcounter": 2, "addtocounter": 2, "rule": 2, "hspace": 1, "vspace": 1, "textcolor": 1,
        "color": 1, "definecolor": 3, "newcommand": 2, "renewcommand": 2, "providecommand": 2, "DeclareMathOperator": 2,
        "newenvironment": 3, "renewenvironment": 3, "newtheorem": 2, "newcounter": 1,
    ]
    /// Setzt einen Buchstaben, auch ohne Leerzeichen davor oder danach: Stra\ss e
    private static let letterCommands: Set<String> = ["ss", "ae", "AE", "oe", "OE", "aa", "AA", "o", "O", "l", "L", "i", "j"]
    /// `\c{c}`, `\v{s}` …: das Argument ist ein Buchstabe des Wortes
    private static let accentCommands: Set<String> = ["u", "v", "H", "c", "k", "r", "b", "d", "t"]
    private static let accentSymbols: Set<Unicode.Scalar> = ["\"", "'", "`", "^", "~", "=", "."]
    /// Umgebungen, deren erstes `{…}` Argument Spaltenformat oder Breite ist
    private static let environmentsWithArgument: Set<String> = [
        "tabular", "tabular*", "tabularx", "tabulary", "longtable", "array", "supertabular", "minipage", "multicols",
        "thebibliography",
    ]

    private struct Counter {
        private let scalars: [Unicode.Scalar]
        private var index = 0
        private var count = 0
        private var inWord = false

        init(_ scalars: [Unicode.Scalar]) {
            self.scalars = scalars
        }

        mutating func run() -> Int {
            while index < scalars.count {
                let scalar = scalars[index]
                switch scalar {
                case "%": skipLine()
                case "\\": command()
                case "$": skipDollarMath()
                case "{", "}": index += 1
                case "~": endWord(); index += 1
                default: plain(scalar)
                }
            }
            return count
        }

        // MARK: Zeichen

        private mutating func plain(_ scalar: Unicode.Scalar) {
            if Self.isWordScalar(scalar) {
                startOrContinueWord()
            } else if inWord, joinsWord(scalar) {
                // Bindestrich, Apostroph, Dezimalpunkt innerhalb eines Wortes
            } else {
                endWord()
            }
            index += 1
        }

        private func joinsWord(_ scalar: Unicode.Scalar) -> Bool {
            guard index + 1 < scalars.count, Self.isWordScalar(scalars[index + 1]) else { return false }
            switch scalar {
            case "-", "'", "\u{2019}": return true
            case ".", ",": return index > 0 && Self.isDigit(scalars[index - 1]) && Self.isDigit(scalars[index + 1])
            default: return false
            }
        }

        private mutating func startOrContinueWord() {
            if !inWord {
                inWord = true
                count += 1
            }
        }

        private mutating func endWord() {
            inWord = false
        }

        private static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
            scalar.value >= 0x30 && scalar.value <= 0x39
        }

        private static func isASCIILetter(_ scalar: Unicode.Scalar) -> Bool {
            (scalar.value >= 0x41 && scalar.value <= 0x5A) || (scalar.value >= 0x61 && scalar.value <= 0x7A)
        }

        private static func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
            if scalar.value < 0x80 { return isASCIILetter(scalar) || isDigit(scalar) }
            return scalar.properties.isAlphabetic || scalar.properties.numericType != nil
        }

        // MARK: Überspringen

        private mutating func skipLine() {
            while index < scalars.count, scalars[index] != "\n" { index += 1 }
            endWord()
        }

        /// `$…$` und `$$…$$`; ein offenes `$` endet spätestens an einer Leerzeile (wie im Syntaxfärber).
        private mutating func skipDollarMath() {
            endWord()
            let isDisplay = index + 1 < scalars.count && scalars[index + 1] == "$"
            index += isDisplay ? 2 : 1
            while index < scalars.count {
                let scalar = scalars[index]
                if scalar == "\\" {
                    index += 2
                } else if scalar == "$" {
                    index += (isDisplay && index + 1 < scalars.count && scalars[index + 1] == "$") ? 2 : 1
                    return
                } else if scalar == "\n", isBlankLine(at: index + 1) {
                    return
                } else {
                    index += 1
                }
            }
        }

        private func isBlankLine(at start: Int) -> Bool {
            var position = start
            while position < scalars.count, scalars[position] == " " || scalars[position] == "\t" { position += 1 }
            return position >= scalars.count || scalars[position] == "\n"
        }

        private mutating func skip(until terminator: [Unicode.Scalar]) {
            guard let found = find(terminator, from: index) else {
                index = scalars.count
                return
            }
            index = found + terminator.count
        }

        private func find(_ needle: [Unicode.Scalar], from start: Int) -> Int? {
            guard !needle.isEmpty, scalars.count >= needle.count else { return nil }
            var position = start
            while position + needle.count <= scalars.count {
                if scalars[position] == needle[0], Array(scalars[position..<position + needle.count]) == needle { return position }
                position += 1
            }
            return nil
        }

        /// Überspringt Leerraum, `[…]` und dann `count` Gruppen `{…}`; `optionalOnly`: nur ein `[…]`.
        private mutating func skipArguments(_ count: Int) {
            var remaining = count
            while index < scalars.count {
                let saved = index
                skipSpaces()
                if index < scalars.count, scalars[index] == "[" {
                    skipGroup(open: "[", close: "]")
                } else if remaining > 0, index < scalars.count, scalars[index] == "{" {
                    skipGroup(open: "{", close: "}")
                    remaining -= 1
                } else {
                    index = saved
                    return
                }
                if remaining == 0, index >= scalars.count || scalars[index] != "[" { return }
            }
        }

        private mutating func skipSpaces() {
            while index < scalars.count, scalars[index] == " " || scalars[index] == "\t" || scalars[index] == "\n" { index += 1 }
        }

        /// Steht an `open`; geht hinter das passende `close` (verschachtelt, `\{` zählt nicht).
        private mutating func skipGroup(open: Unicode.Scalar, close: Unicode.Scalar) {
            var depth = 0
            while index < scalars.count {
                let scalar = scalars[index]
                if scalar == "\\" {
                    index += 2
                    continue
                }
                index += 1
                if scalar == open {
                    depth += 1
                } else if scalar == close {
                    depth -= 1
                    if depth == 0 { return }
                }
            }
        }

        // MARK: Befehle

        private mutating func command() {
            index += 1
            guard index < scalars.count else { return }
            let first = scalars[index]
            guard Self.isASCIILetter(first) else {
                controlSymbol(first)
                return
            }
            let start = index
            while index < scalars.count, Self.isASCIILetter(scalars[index]) { index += 1 }
            let name = String(String.UnicodeScalarView(scalars[start..<index]))
            if index < scalars.count, scalars[index] == "*" { index += 1 }
            named(name)
        }

        private mutating func controlSymbol(_ symbol: Unicode.Scalar) {
            index += 1
            switch symbol {
            case "(": endWord(); skip(until: ["\\", ")"])
            case "[": endWord(); skip(until: ["\\", "]"])
            case "-", "/": break
            case "\\": endWord(); skipOptionalArgument()
            case _ where WordCounter.accentSymbols.contains(symbol): joinAccentArgument()
            default: endWord()
            }
        }

        private mutating func skipOptionalArgument() {
            if index < scalars.count, scalars[index] == "[" { skipGroup(open: "[", close: "]") }
        }

        /// `\"{o}` bzw. `\"o`: Der Buchstabe gehört zum laufenden Wort.
        private mutating func joinAccentArgument() {
            if index + 2 < scalars.count, scalars[index] == "{", Self.isWordScalar(scalars[index + 1]), scalars[index + 2] == "}" {
                startOrContinueWord()
                index += 3
            }
        }

        private mutating func named(_ name: String) {
            if WordCounter.letterCommands.contains(name) {
                startOrContinueWord()
                return
            }
            if WordCounter.accentCommands.contains(name) {
                skipSpaces()
                joinAccentArgument()
                return
            }
            endWord()
            switch name {
            case "begin": beginEnvironment()
            case "end": skipGroupAfterSpaces()
            case "verb": skipVerb()
            case "def": skipDefinition()
            default:
                if let arguments = WordCounter.commandsSkippingArguments[name] {
                    skipArguments(arguments)
                } else if index < scalars.count, scalars[index] == "[" {
                    // \section[Kurz]{Lang}, \caption[Kurz]{Lang}: Die Kurzform zählt nicht doppelt
                    skipGroup(open: "[", close: "]")
                }
            }
        }

        private mutating func skipGroupAfterSpaces() {
            skipSpaces()
            if index < scalars.count, scalars[index] == "{" { skipGroup(open: "{", close: "}") }
        }

        private mutating func beginEnvironment() {
            skipSpaces()
            guard index < scalars.count, scalars[index] == "{" else { return }
            let start = index + 1
            skipGroup(open: "{", close: "}")
            let name = String(String.UnicodeScalarView(scalars[start..<max(start, index - 1)]))
            if LatexEnvironments.skipsContent(name) {
                skip(until: Array("\\end{\(name)}".unicodeScalars))
            } else {
                skipArguments(WordCounter.environmentsWithArgument.contains(name) ? 1 : 0)
            }
        }

        /// `\verb|…|`: bis zum zweiten gleichen Begrenzer
        private mutating func skipVerb() {
            if index < scalars.count, scalars[index] == "*" { index += 1 }
            guard index < scalars.count else { return }
            let delimiter = scalars[index]
            index += 1
            while index < scalars.count, scalars[index] != delimiter, scalars[index] != "\n" { index += 1 }
            if index < scalars.count, scalars[index] == delimiter { index += 1 }
        }

        /// `\def\name#1{…}`: bis hinter die erste Gruppe
        private mutating func skipDefinition() {
            while index < scalars.count, scalars[index] != "{", scalars[index] != "\n" { index += 1 }
            if index < scalars.count, scalars[index] == "{" { skipGroup(open: "{", close: "}") }
        }
    }
}
