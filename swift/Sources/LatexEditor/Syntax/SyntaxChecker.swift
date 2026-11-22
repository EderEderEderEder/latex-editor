import Foundation

/// Eine Markierung im Text: Bereich, Schwere und Erklärung (Tooltip). Fehler sind rot gestrichelt, Warnungen orange
/// strichpunktiert, Hinweise blau gepunktet: Die Schwere steht auch im Muster, nicht nur in der Farbe.
struct TextMark: Equatable, Sendable {
    enum Severity: Int, Comparable, Sendable {
        case hint
        case warning
        case error

        static func < (lhs: Severity, rhs: Severity) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    let severity: Severity
    let range: NSRange
    let message: String
}

/// Findet offensichtliche Syntaxfehler: nicht geschlossene oder überzählige Klammern `{ }`, `\begin`/`\end`, die nicht
/// zusammenpassen, und Formeln (`$ … $`, `$$ … $$`, `\( … \)`, `\[ … \]`), die nicht enden. Arbeitet auf Text, aus dem
/// Kommentare und Code schon entfernt sind (`LatexMasking.scannable`). Vorsicht vor Fehlalarmen: Die Argumente von
/// Definitionen (`\newcommand`, `\newenvironment` …) dürfen ein einzelnes `\begin` oder `\end` enthalten.
enum SyntaxChecker {
    /// Einstellung „Fehler und Warnungen im Text markieren“ (Schreibhilfen)
    static let enabledKey = "errorsInText"
    static let maximumCount = 200

    /// Befehle, deren Argumente Code enthalten, der erst später gesetzt wird
    private static let definitionCommands: Set<String> = [
        "newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "newcommandx", "renewcommandx",
        "newenvironment", "renewenvironment", "NewDocumentCommand", "RenewDocumentCommand", "ProvideDocumentCommand",
        "DeclareDocumentCommand", "NewDocumentEnvironment", "RenewDocumentEnvironment", "ProvideDocumentEnvironment",
        "NewEnviron", "newtcolorbox", "newtcbtheorem", "def", "gdef", "edef", "xdef",
    ]
    private static let maximumDefinitionArguments = 5
    private static let maximumMarkLength = 24

    private enum Math {
        case none
        case dollar
        case displayDollar
        case parenthesis
        case bracket

        var opener: String {
            switch self {
            case .none: ""
            case .dollar: "$"
            case .displayDollar: "$$"
            case .parenthesis: "\\("
            case .bracket: "\\["
            }
        }
    }

    private struct OpenEnvironment {
        let name: String
        let range: NSRange
    }

    static func marks(masked: NSString) -> [TextMark] {
        var pass = Pass(text: masked)
        pass.run()
        return Array(pass.marks.prefix(maximumCount)).sorted { $0.range.location < $1.range.location }
    }

    private struct Pass {
        let text: NSString
        var marks: [TextMark] = []
        private var braces: [Int] = []
        private var environments: [OpenEnvironment] = []
        private var math = Math.none
        private var mathStart = 0
        private var ignoreEnvironmentsUntil = 0
        private var lines: LineIndex?

        init(text: NSString) {
            self.text = text
        }

        mutating func run() {
            var index = 0
            let length = text.length
            while index < length, marks.count < maximumCount {
                let unit = text.character(at: index)
                switch unit {
                case 0x5C: index = command(at: index)
                case 0x7B: braces.append(index); index += 1
                case 0x7D: closeBrace(at: index); index += 1
                case 0x24: index = dollar(at: index)
                case 0x0A: index = lineBreak(at: index)
                default: index += 1
                }
            }
            finish()
        }

        // MARK: Befehle

        private mutating func command(at start: Int) -> Int {
            let next = start + 1
            guard next < text.length else { return next }
            let unit = text.character(at: next)
            guard Self.isLetter(unit) else {
                switch unit {
                case 0x28: openMath(.parenthesis, at: start)
                case 0x5B: openMath(.bracket, at: start)
                case 0x29: closeMath(.parenthesis, at: start, length: 2)
                case 0x5D: closeMath(.bracket, at: start, length: 2)
                default: break
                }
                return next + 1
            }
            var end = next
            while end < text.length, Self.isLetter(text.character(at: end)) { end += 1 }
            let name = text.substring(with: NSRange(location: next, length: end - next))
            switch name {
            case "begin", "end": return environmentCommand(isBegin: name == "begin", commandStart: start, after: end)
            case _ where definitionCommands.contains(name):
                ignoreEnvironmentsUntil = max(ignoreEnvironmentsUntil, definitionEnd(after: end, isPrimitive: ["def", "gdef", "edef", "xdef"].contains(name)))
                return end
            default: return end
            }
        }

        /// `{name}` hinter `\begin` oder `\end`. Die Klammern sind in sich geschlossen und zählen nicht als Klammerpaar.
        private mutating func environmentCommand(isBegin: Bool, commandStart: Int, after: Int) -> Int {
            var open = after
            while open < text.length, Self.isBlank(text.character(at: open)) { open += 1 }
            guard open < text.length, text.character(at: open) == 0x7B else { return after }
            let nameStart = open + 1
            var close = nameStart
            while close < text.length, text.character(at: close) != 0x7D, text.character(at: close) != 0x0A { close += 1 }
            guard close < text.length, text.character(at: close) == 0x7D else { return after }
            let name = text.substring(with: NSRange(location: nameStart, length: close - nameStart))
            let range = NSRange(location: commandStart, length: close + 1 - commandStart)
            if commandStart >= ignoreEnvironmentsUntil {
                if isBegin { environments.append(OpenEnvironment(name: name, range: range)) } else { endEnvironment(name, range: range) }
            }
            return close + 1
        }

        private mutating func endEnvironment(_ name: String, range: NSRange) {
            guard let match = environments.lastIndex(where: { $0.name == name }) else {
                add(.error, range, "„\\end{\(name)}“ hat kein passendes „\\begin{\(name)}“.")
                return
            }
            for unclosed in environments[(match + 1)...] {
                add(.error, unclosed.range, "„\\begin{\(unclosed.name)}“ wird nicht geschlossen, bevor „\\end{\(name)}“ (Zeile \(line(of: range.location))) folgt.")
            }
            environments.removeSubrange(match...)
        }

        /// Ende der Argumente einer Definition: bis zu fünf `[…]`- oder `{…}`-Gruppen; bei `\def` bis zur ersten Gruppe
        private func definitionEnd(after start: Int, isPrimitive: Bool) -> Int {
            var index = start
            if isPrimitive {
                while index < text.length, text.character(at: index) != 0x7B, text.character(at: index) != 0x0A { index += 1 }
                return index < text.length && text.character(at: index) == 0x7B ? groupEnd(from: index) : index
            }
            for _ in 0..<maximumDefinitionArguments {
                while index < text.length, Self.isBlank(text.character(at: index)) || text.character(at: index) == 0x2A { index += 1 }
                guard index < text.length else { break }
                switch text.character(at: index) {
                case 0x7B: index = groupEnd(from: index)
                case 0x5B:
                    let close = text.range(of: "]", range: NSRange(location: index, length: text.length - index))
                    guard close.location != NSNotFound else { return text.length }
                    index = close.location + 1
                case 0x5C:
                    // `\newcommand\foo{…}`: der Name ohne Klammern
                    index += 1
                    while index < text.length, Self.isLetter(text.character(at: index)) { index += 1 }
                default: return index
                }
            }
            return index
        }

        private func groupEnd(from open: Int) -> Int {
            var depth = 0
            var index = open
            while index < text.length {
                let unit = text.character(at: index)
                if unit == 0x5C { index += 2; continue }
                if unit == 0x7B { depth += 1 } else if unit == 0x7D {
                    depth -= 1
                    if depth == 0 { return index + 1 }
                }
                index += 1
            }
            return text.length
        }

        // MARK: Klammern

        private mutating func closeBrace(at index: Int) {
            if braces.popLast() == nil { add(.error, NSRange(location: index, length: 1), "Schließende Klammer „}“ ohne öffnende.") }
        }

        // MARK: Formeln

        private mutating func dollar(at start: Int) -> Int {
            let isDouble = start + 1 < text.length && text.character(at: start + 1) == 0x24
            switch math {
            case .none:
                openMath(isDouble ? .displayDollar : .dollar, at: start)
            case .dollar:
                math = .none
                return start + 1
            case .displayDollar:
                guard isDouble else { return start + 1 }
                math = .none
            case .parenthesis, .bracket:
                break
            }
            return isDouble ? start + 2 : start + 1
        }

        private mutating func openMath(_ kind: Math, at start: Int) {
            if math != .none, kind != .none { return }
            math = kind
            mathStart = start
        }

        private mutating func closeMath(_ kind: Math, at start: Int, length: Int) {
            guard math == kind else {
                add(.error, NSRange(location: start, length: length), "„\(kind == .parenthesis ? "\\)" : "\\]")“ ohne öffnendes „\(kind.opener)“.")
                return
            }
            math = .none
        }

        /// Eine Formel endet spätestens am Absatz: eine Leerzeile darin ist in LaTeX ein Fehler.
        private mutating func lineBreak(at index: Int) -> Int {
            var cursor = index + 1
            while cursor < text.length, Self.isBlank(text.character(at: cursor)) { cursor += 1 }
            if cursor < text.length, text.character(at: cursor) == 0x0A, math != .none { reportOpenMath() }
            return index + 1
        }

        private mutating func reportOpenMath() {
            add(.error, withFollowingWord(at: mathStart, length: math.opener.count), "Die Formel wird nicht geschlossen: „\(math.opener)“ ohne passendes Ende vor dem Absatz.")
            math = .none
        }

        // MARK: Ende

        private mutating func finish() {
            if math != .none { reportOpenMath() }
            for open in braces {
                add(.error, withFollowingWord(at: open, length: 1), "Öffnende Klammer „{“ wird nicht geschlossen.")
            }
            for open in environments {
                add(.error, open.range, "„\\begin{\(open.name)}“ wird nicht geschlossen.")
            }
        }

        private mutating func add(_ severity: TextMark.Severity, _ range: NSRange, _ message: String) {
            marks.append(TextMark(severity: severity, range: range, message: message))
        }

        /// Ein einzelnes Zeichen ist unterstrichen kaum zu sehen: das folgende Wort gehört mit zur Markierung
        private func withFollowingWord(at start: Int, length: Int) -> NSRange {
            var end = start + length
            while end < text.length, end - start < SyntaxChecker.maximumMarkLength, Self.isLetter(text.character(at: end)) || Self.isDigit(text.character(at: end)) { end += 1 }
            return NSRange(location: start, length: end - start)
        }

        private mutating func line(of location: Int) -> Int {
            if lines == nil { lines = LineIndex(text: text) }
            return (lines?.line(containing: location) ?? 0) + 1
        }

        private static func isLetter(_ unit: unichar) -> Bool {
            (unit >= 0x41 && unit <= 0x5A) || (unit >= 0x61 && unit <= 0x7A) || unit == 0x40
        }

        private static func isDigit(_ unit: unichar) -> Bool {
            unit >= 0x30 && unit <= 0x39
        }

        private static func isBlank(_ unit: unichar) -> Bool {
            unit == 0x20 || unit == 0x09
        }
    }
}
