import Foundation

struct BuildIssue: Identifiable, Hashable, Sendable {
    enum Severity: Int, Comparable, Sendable {
        case error
        case warning
        case badBox

        static func < (lhs: Severity, rhs: Severity) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    let id: Int
    let severity: Severity
    let message: String
    let fileURL: URL?
    /// 1-basiert
    let line: Int?
    /// Kontext aus dem Log, z. B. `l.3 Ein \undefiniert`
    var detail: String?
}

/// Liest das LaTeX-Log (mit `-file-line-error` und `max_print_line=10000` erzeugt) und liefert
/// Fehler, Warnungen und Box-Warnungen. Die Datei zu Warnungen ohne Pfad ergibt sich aus dem
/// Dateistapel der `(./datei.tex … )`-Klammern im Log.
///
/// Arbeitet auf UTF-8-Bytes statt auf `Character`: Logs haben schnell 100.000 Zeilen, und
/// Graphem-Verarbeitung war dafür um ein Vielfaches zu langsam (gemessen).
struct LatexLogParser {
    private static let followUpErrors = ["Emergency stop.", "==> Fatal error occurred"]
    private static let errorContextLookahead = 12

    private let bytes: UnsafeBufferPointer<UInt8>
    private let lineRanges: [Range<Int>]
    private let baseDirectory: URL
    private var index = 0
    private var fileStack: [String?] = []
    private var issues: [BuildIssue] = []

    static func parse(_ log: String, baseDirectory: URL) -> [BuildIssue] {
        let measurement = Signposts.begin("LogParse")
        defer { measurement.end() }
        let data = Array(log.utf8)
        return data.withUnsafeBufferPointer { buffer in
            var parser = LatexLogParser(bytes: buffer, baseDirectory: baseDirectory)
            parser.run()
            return parser.finishedIssues()
        }
    }

    private init(bytes: UnsafeBufferPointer<UInt8>, baseDirectory: URL) {
        self.bytes = bytes
        self.baseDirectory = baseDirectory
        lineRanges = Self.lineRanges(in: bytes)
    }

    /// Zeilenumbrüche per `memchr` (C, unabhängig vom Swift-Build-Modus schnell); die Swift-Schleife
    /// läuft dadurch einmal pro Zeile statt einmal pro Byte.
    private static func lineRanges(in bytes: UnsafeBufferPointer<UInt8>) -> [Range<Int>] {
        var ranges: [Range<Int>] = []
        var start = 0
        while let newline = LogLine.firstIndex(of: LogLine.newline, in: bytes, from: start) {
            ranges.append(start..<newline)
            start = newline + 1
        }
        ranges.append(start..<bytes.count)
        return ranges
    }

    private func line(_ number: Int) -> LogLine {
        LogLine(bytes: UnsafeBufferPointer(rebasing: bytes[lineRanges[number]]))
    }

    private mutating func run() {
        while index < lineRanges.count {
            let current = line(index)
            if let error = current.fileLineError() {
                addError(error.message, path: error.path, line: error.line)
            } else if current.hasPrefix(LogLine.errorPrefix) {
                addError(current.text(from: LogLine.errorPrefix.count), path: nil, line: nil)
            } else if let warning = current.warningStart() {
                addWarning(warning)
            } else if current.hasPrefix(LogLine.overfullPrefix) || current.hasPrefix(LogLine.underfullPrefix) {
                addBadBox(current)
            } else {
                trackFiles(in: current)
                index += 1
            }
        }
    }

    // MARK: Fehler

    private mutating func addError(_ message: String, path: String?, line: Int?) {
        let context = consumeErrorContext()
        append(.error, message: message, path: path ?? currentFile, line: line ?? context?.line, detail: context?.text)
    }

    /// Überspringt den Fehlerblock bis einschließlich der `l.<n>`-Zeile und der Folgezeile
    /// (Rest der Quellzeile). Dort steht Nutzertext, dessen Klammern den Dateistapel nicht verfälschen dürfen.
    private mutating func consumeErrorContext() -> (line: Int, text: String)? {
        index += 1
        let end = min(index + Self.errorContextLookahead, lineRanges.count)
        for candidate in index..<end {
            let contextLine = line(candidate)
            guard let number = contextLine.contextLineNumber() else { continue }
            index = min(candidate + 2, lineRanges.count)
            return (number, contextLine.text(from: 0).trimmingCharacters(in: .whitespaces))
        }
        return nil
    }

    // MARK: Warnungen

    private mutating func addWarning(_ start: LogLine.WarningStart) {
        var message = start.message
        index += 1
        while index < lineRanges.count, let continuation = line(index).continuation(prefix: start.continuationPrefix) {
            message += " " + continuation
            index += 1
        }
        let (text, inputLine) = LogLine.splitInputLine(message)
        append(.warning, message: text, path: currentFile, line: inputLine, detail: nil)
    }

    private mutating func addBadBox(_ boxLine: LogLine) {
        append(.badBox, message: boxLine.text(from: 0), path: currentFile, line: boxLine.badBoxLine(), detail: nil)
        index += 1
        // Box-Inhalt bis zur Leerzeile enthält Satztext und wird nicht auf Klammern untersucht.
        while index < lineRanges.count, !line(index).isEmpty { index += 1 }
    }

    // MARK: Dateistapel

    private var currentFile: String? {
        fileStack.last { $0 != nil } ?? nil
    }

    private mutating func trackFiles(in logLine: LogLine) {
        var position = 0
        while let parenthesis = logLine.nextParenthesis(from: position) {
            if logLine.bytes[parenthesis] == LogLine.closeParenthesis {
                if !fileStack.isEmpty { fileStack.removeLast() }
                position = parenthesis + 1
                continue
            }
            let tokenEnd = logLine.tokenEnd(from: parenthesis + 1)
            let token = parenthesis + 1..<tokenEnd
            fileStack.append(logLine.looksLikeFile(token) ? logLine.text(token) : nil)
            position = tokenEnd
        }
    }

    // MARK: Ergebnis

    private mutating func append(_ severity: BuildIssue.Severity, message: String, path: String?, line: Int?, detail: String?) {
        issues.append(BuildIssue(
            id: issues.count,
            severity: severity,
            message: message.trimmingCharacters(in: .whitespaces),
            fileURL: path.map(resolve),
            line: line,
            detail: detail
        ))
    }

    private func resolve(_ path: String) -> URL {
        let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : baseDirectory.appendingPathComponent(path)
        return url.standardizedFileURL
    }

    /// Folgefehler („Emergency stop“, „Fatal error occurred“) nur behalten, wenn es keine eigentliche Ursache gibt.
    private func finishedIssues() -> [BuildIssue] {
        let isFollowUp = { (issue: BuildIssue) in
            issue.severity == .error && Self.followUpErrors.contains { issue.message.hasPrefix($0) }
        }
        let hasRealError = issues.contains { $0.severity == .error && !isFollowUp($0) }
        return hasRealError ? issues.filter { !isFollowUp($0) } : issues
    }
}

/// Eine Log-Zeile als UTF-8-Bytes (ohne Zeilenumbruch) mit den Erkennungsregeln.
struct LogLine {
    struct WarningStart {
        let message: String
        /// Fortsetzungszeilen beginnen mit diesem Präfix, z. B. `(hyperref)`.
        let continuationPrefix: [UInt8]
    }

    static let newline = UInt8(ascii: "\n")
    static let openParenthesis = UInt8(ascii: "(")
    static let closeParenthesis = UInt8(ascii: ")")
    static let errorPrefix = Array("! ".utf8)
    static let overfullPrefix = Array("Overfull \\".utf8)
    static let underfullPrefix = Array("Underfull \\".utf8)

    private static let colon = UInt8(ascii: ":")
    private static let space = UInt8(ascii: " ")
    private static let slash = UInt8(ascii: "/")
    private static let dot = UInt8(ascii: ".")
    private static let latexWarning = Array("LaTeX Warning: ".utf8)
    private static let fontWarning = Array("LaTeX Font Warning: ".utf8)
    private static let pdfTeXWarning = Array("pdfTeX warning".utf8)
    private static let warningMarker = Array(" Warning: ".utf8)
    private static let warningOwners = [Array("Package ".utf8), Array("Class ".utf8)]
    private static let linesMarker = Array(" at lines ".utf8)
    private static let detectedMarker = Array(" detected at line ".utf8)
    private static let contextPrefix = Array("l.".utf8)
    private static let inputLineMarker = " on input line "
    private static let fileExtensionMaxLength = 8

    let bytes: UnsafeBufferPointer<UInt8>

    var isEmpty: Bool { bytes.isEmpty }

    func hasPrefix(_ prefix: [UInt8]) -> Bool {
        hasPattern(prefix, at: 0)
    }

    func text(from start: Int) -> String {
        text(min(start, bytes.count)..<bytes.count)
    }

    func text(_ range: Range<Int>) -> String {
        String(decoding: UnsafeBufferPointer(rebasing: bytes[range]), as: UTF8.self)
    }

    /// `./chapters/kapitel.tex:3: Undefined control sequence.`
    func fileLineError() -> (path: String, line: Int, message: String)? {
        guard let first = bytes.first, first == Self.dot || first == Self.slash || isLetter(first) else { return nil }
        var position = 0
        while let colon = firstIndex(of: Self.colon, from: position) {
            let digitsEnd = digitRunEnd(from: colon + 1)
            if digitsEnd > colon + 1, hasPattern([Self.colon, Self.space], at: digitsEnd), hasFileExtension(0..<colon),
               let number = Int(text(colon + 1..<digitsEnd)) {
                return (text(0..<colon), number, text(from: digitsEnd + 2))
            }
            position = colon + 1
        }
        return nil
    }

    func warningStart() -> WarningStart? {
        if hasPrefix(Self.latexWarning) {
            return WarningStart(message: text(from: Self.latexWarning.count), continuationPrefix: Array("(LaTeX)".utf8))
        }
        if hasPrefix(Self.fontWarning) {
            return WarningStart(message: text(from: Self.fontWarning.count), continuationPrefix: Array("(Font)".utf8))
        }
        if hasPrefix(Self.pdfTeXWarning) {
            return WarningStart(message: text(from: 0), continuationPrefix: Array("(pdfTeX)".utf8))
        }
        for owner in Self.warningOwners where hasPrefix(owner) {
            guard let marker = range(of: Self.warningMarker, from: owner.count) else { continue }
            let name = owner.count..<marker.lowerBound
            guard !name.isEmpty, firstIndex(of: Self.space, from: name.lowerBound).map({ $0 >= name.upperBound }) ?? true else { continue }
            return WarningStart(message: text(from: marker.upperBound), continuationPrefix: Array("(\(text(name)))".utf8))
        }
        return nil
    }

    /// Fortsetzungszeile einer mehrzeiligen Warnung ohne Präfix, sonst nil.
    func continuation(prefix: [UInt8]) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return text(from: prefix.count).trimmingCharacters(in: .whitespaces)
    }

    /// `… in paragraph at lines 10--11` → 10, `… detected at line 12` → 12.
    func badBoxLine() -> Int? {
        for marker in [Self.linesMarker, Self.detectedMarker] {
            guard let range = range(of: marker, from: 0) else { continue }
            return Int(text(range.upperBound..<digitRunEnd(from: range.upperBound)))
        }
        return nil
    }

    /// `l.3 Ein \undefiniert` → 3
    func contextLineNumber() -> Int? {
        guard hasPrefix(Self.contextPrefix) else { return nil }
        let start = Self.contextPrefix.count
        return Int(text(start..<digitRunEnd(from: start)))
    }

    /// Ende eines Tokens nach `(`: bis Leerzeichen oder Klammer.
    func tokenEnd(from start: Int) -> Int {
        var position = start
        while position < bytes.count {
            let byte = bytes[position]
            if byte == Self.space || byte == Self.openParenthesis || byte == Self.closeParenthesis { break }
            position += 1
        }
        return position
    }

    /// `./main.tex`, `/usr/…/article.cls` – kein `(Font)`, `(hyperref)` oder Satztext.
    func looksLikeFile(_ range: Range<Int>) -> Bool {
        firstIndex(of: Self.slash, from: range.lowerBound).map { $0 < range.upperBound } ?? false
            && hasFileExtension(range)
    }

    /// Trennt „… on input line 7.“ ab und liefert die Zeile.
    static func splitInputLine(_ message: String) -> (text: String, line: Int?) {
        guard let marker = message.range(of: inputLineMarker, options: .backwards) else { return (message, nil) }
        let digits = message[marker.upperBound...].prefix { $0.isASCII && $0.isNumber }
        guard let line = Int(digits) else { return (message, nil) }
        return (String(message[..<marker.lowerBound]), line)
    }

    // MARK: Byte-Hilfen

    private func hasFileExtension(_ range: Range<Int>) -> Bool {
        var position = range.upperBound - 1
        var extensionLength = 0
        while position > range.lowerBound {
            let byte = bytes[position]
            if byte == Self.dot { return extensionLength > 0 && extensionLength <= Self.fileExtensionMaxLength }
            guard isLetter(byte) || isDigit(byte) else { return false }
            extensionLength += 1
            position -= 1
        }
        return false
    }

    private func hasPattern(_ pattern: [UInt8], at start: Int) -> Bool {
        guard start + pattern.count <= bytes.count else { return false }
        for offset in 0..<pattern.count where bytes[start + offset] != pattern[offset] { return false }
        return true
    }

    private func range(of pattern: [UInt8], from start: Int) -> Range<Int>? {
        guard let first = pattern.first else { return nil }
        var position = start
        while let candidate = firstIndex(of: first, from: position) {
            if hasPattern(pattern, at: candidate) { return candidate..<(candidate + pattern.count) }
            position = candidate + 1
        }
        return nil
    }

    /// Nächste `(` oder `)` ab `start`.
    func nextParenthesis(from start: Int) -> Int? {
        let open = Self.firstIndex(of: Self.openParenthesis, in: bytes, from: start)
        let close = Self.firstIndex(of: Self.closeParenthesis, in: bytes, from: start)
        switch (open, close) {
        case let (open?, close?): return min(open, close)
        case let (open?, nil): return open
        case let (nil, close?): return close
        case (nil, nil): return nil
        }
    }

    private func firstIndex(of byte: UInt8, from start: Int) -> Int? {
        Self.firstIndex(of: byte, in: bytes, from: start)
    }

    /// `memchr` statt einer Swift-Schleife: im Debug-Build um Größenordnungen schneller.
    static func firstIndex(of byte: UInt8, in buffer: UnsafeBufferPointer<UInt8>, from start: Int) -> Int? {
        guard let base = buffer.baseAddress, start < buffer.count else { return nil }
        guard let found = memchr(base + start, Int32(byte), buffer.count - start) else { return nil }
        return base.distance(to: found.assumingMemoryBound(to: UInt8.self))
    }

    private func digitRunEnd(from start: Int) -> Int {
        var position = start
        while position < bytes.count, isDigit(bytes[position]) { position += 1 }
        return position
    }

    private func isDigit(_ byte: UInt8) -> Bool { byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9") }

    private func isLetter(_ byte: UInt8) -> Bool {
        (byte >= UInt8(ascii: "a") && byte <= UInt8(ascii: "z")) || (byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z"))
    }
}

/// Warnungen und Fehler aus der Biber-Logdatei (`main.blg`).
enum BiberLogParser {
    private static let markers: [(String, BuildIssue.Severity)] = [("> ERROR - ", .error), ("> WARN - ", .warning)]

    static func parse(_ log: String, firstID: Int) -> [BuildIssue] {
        var issues: [BuildIssue] = []
        for line in log.split(separator: "\n") {
            for (marker, severity) in markers {
                guard let range = line.range(of: marker) else { continue }
                let message = "Biber: " + line[range.upperBound...]
                issues.append(BuildIssue(id: firstID + issues.count, severity: severity, message: message, fileURL: nil, line: nil))
                break
            }
        }
        return issues
    }
}
