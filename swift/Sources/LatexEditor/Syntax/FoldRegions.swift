import Foundation

/// Ein Bereich, den der Editor zuklappen kann: Die Kopfzeile bleibt sichtbar, die Zeilen `startLine + 1 ... endLine` werden ausgeblendet.
struct FoldRegion: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case section
        case environment(String)
        /// Mehrere Kommentarzeilen am Stück
        case comments
    }

    let kind: Kind
    /// 0-basiert
    let startLine: Int
    /// Letzte ausgeblendete Zeile (0-basiert), immer hinter `startLine`
    let endLine: Int

    /// Zeichen, die verschwinden: vom Ende der Kopfzeile bis zum Ende der letzten Zeile (ohne deren Zeilenumbruch).
    /// So bleibt alles auf einer Zeile und der Zeilenumbruch hinter dem Bereich beendet sie.
    func hiddenRange(in lines: LineIndex) -> NSRange {
        let header = lines.contentRange(ofLine: min(startLine, lines.lineCount - 1))
        let last = lines.contentRange(ofLine: min(endLine, lines.lineCount - 1))
        return NSRange(location: NSMaxRange(header), length: max(0, NSMaxRange(last) - NSMaxRange(header)))
    }
}

/// Findet zuklappbare Bereiche in einem .tex-Text: Gliederungsbefehle (bis zur nächsten Überschrift gleicher oder höherer
/// Ebene), `\begin … \end` (verschachtelt) und Kommentarblöcke. Kommentierte Befehle und der Inhalt von Code-Umgebungen
/// (`lstlisting`, `PythonCode` …) zählen nicht; die Code-Umgebung selbst lässt sich zuklappen.
enum FoldScanner {
    private static let expression = try! NSRegularExpression(
        pattern: #"\\(begin|end)\{([A-Za-z0-9*@]+)\}|^[ \t]*\\(part|chapter|section|subsection|subsubsection|appendix|frontmatter|mainmatter|backmatter)(?![A-Za-z])"#,
        options: .anchorsMatchLines
    )

    private static let commentBlockMinimumLines = 2

    /// Nach Startzeile sortiert; pro Kopfzeile nur der größte Bereich.
    static func regions(in text: String) -> [FoldRegion] {
        let string = text as NSString
        let lines = LineIndex(text: string)
        var scan = Scan(text: string, lines: lines)
        expression.enumerateMatches(in: text, range: NSRange(location: 0, length: string.length)) { match, _, _ in
            if let match { scan.consume(match) }
        }
        scan.closeSections(beforeLine: lines.lineCount, levelAtLeast: Int.min)
        scan.addCommentBlocks()
        return normalized(scan.regions)
    }

    private static func normalized(_ regions: [FoldRegion]) -> [FoldRegion] {
        let sorted = regions.sorted { $0.startLine != $1.startLine ? $0.startLine < $1.startLine : $0.endLine > $1.endLine }
        var result: [FoldRegion] = []
        for region in sorted where result.last?.startLine != region.startLine { result.append(region) }
        return result
    }

    private static func level(ofCommand name: String) -> Int {
        switch name {
        case "part": 0
        case "chapter": 1
        case "section": 2
        case "subsection": 3
        case "subsubsection": 4
        default: -1
        }
    }

    private struct Scan {
        let text: NSString
        let lines: LineIndex
        var regions: [FoldRegion] = []
        var sections: [(level: Int, line: Int)] = []
        var environments: [(name: String, line: Int)] = []
        /// Zeilen von Code-Umgebungen (`begin ... end`): dort gibt es weder Überschriften noch Kommentare
        var codeLines: [ClosedRange<Int>] = []
        var skipUntil = 0

        init(text: NSString, lines: LineIndex) {
            self.text = text
            self.lines = lines
        }

        mutating func consume(_ match: NSTextCheckingResult) {
            guard match.range.location >= skipUntil else { return }
            if match.range(at: 1).location != NSNotFound {
                consumeEnvironmentCommand(match)
            } else {
                consumeHeading(match)
            }
        }

        private func isInComment(_ location: Int) -> Bool {
            let lineStart = lines.start(ofLine: lines.line(containing: location))
            return LatexComments.isInComment(text, lineStart: lineStart, location: location)
        }

        private mutating func consumeEnvironmentCommand(_ match: NSTextCheckingResult) {
            let location = match.range.location
            guard !isInComment(location) else { return }
            let isBegin = text.substring(with: match.range(at: 1)) == "begin"
            let name = text.substring(with: match.range(at: 2))
            let line = lines.line(containing: location)
            if isBegin {
                LatexEnvironments.isCode(name) ? consumeCode(name, at: match, line: line) : environments.append((name, line))
            } else {
                closeEnvironment(name, atLine: line)
            }
        }

        private mutating func consumeCode(_ name: String, at match: NSTextCheckingResult, line: Int) {
            let bodyStart = NSMaxRange(match.range)
            let tail = NSRange(location: bodyStart, length: text.length - bodyStart)
            let end = text.range(of: "\\end{\(name)}", options: .literal, range: tail)
            guard end.location != NSNotFound else {
                skipUntil = text.length
                return
            }
            let endLine = lines.line(containing: end.location)
            codeLines.append(line...endLine)
            if endLine > line { regions.append(FoldRegion(kind: .environment(name), startLine: line, endLine: endLine)) }
            skipUntil = NSMaxRange(end)
        }

        private mutating func closeEnvironment(_ name: String, atLine line: Int) {
            if name == "document" { closeSections(beforeLine: line, levelAtLeast: Int.min) }
            guard let index = environments.lastIndex(where: { $0.name == name }) else { return }
            let start = environments[index].line
            environments.removeSubrange(index...)
            if line > start { regions.append(FoldRegion(kind: .environment(name), startLine: start, endLine: line)) }
        }

        private mutating func consumeHeading(_ match: NSTextCheckingResult) {
            let nameRange = match.range(at: 3)
            guard nameRange.location != NSNotFound, !isInComment(nameRange.location - 1) else { return }
            let level = FoldScanner.level(ofCommand: text.substring(with: nameRange))
            let line = lines.line(containing: match.range.location)
            // `\appendix`, `\backmatter` … beenden alle offenen Abschnitte, ohne selbst einen zu öffnen
            closeSections(beforeLine: line, levelAtLeast: level < 0 ? Int.min : level)
            if level >= 0 { sections.append((level, line)) }
        }

        /// Schließt offene Abschnitte ab `level`; sie enden an der letzten nicht leeren Zeile vor `line`.
        mutating func closeSections(beforeLine line: Int, levelAtLeast level: Int) {
            while let open = sections.last, open.level >= level {
                sections.removeLast()
                let end = lastNonBlankLine(before: line, notBefore: open.line)
                if end > open.line { regions.append(FoldRegion(kind: .section, startLine: open.line, endLine: end)) }
            }
        }

        private func lastNonBlankLine(before line: Int, notBefore floor: Int) -> Int {
            var candidate = line - 1
            while candidate > floor, isBlank(candidate) { candidate -= 1 }
            return candidate
        }

        private func isBlank(_ line: Int) -> Bool {
            firstNonSpace(inLine: line) == nil
        }

        /// Erstes Zeichen der Zeile, das kein Leerraum ist
        private func firstNonSpace(inLine line: Int) -> UInt16? {
            let range = lines.contentRange(ofLine: line)
            var position = range.location
            while position < NSMaxRange(range) {
                let character = text.character(at: position)
                if character != 0x20, character != 0x09, character != 0x0D { return character }
                position += 1
            }
            return nil
        }

        // MARK: Kommentarblöcke

        mutating func addCommentBlocks() {
            let percent = UInt16(UInt8(ascii: "%"))
            var blockStart: Int?
            var codeIndex = 0
            for line in 0..<lines.lineCount {
                while codeIndex < codeLines.count, codeLines[codeIndex].upperBound < line { codeIndex += 1 }
                let inCode = codeIndex < codeLines.count && codeLines[codeIndex].contains(line)
                if !inCode, firstNonSpace(inLine: line) == percent {
                    blockStart = blockStart ?? line
                    continue
                }
                closeCommentBlock(from: blockStart, endingBefore: line)
                blockStart = nil
            }
            closeCommentBlock(from: blockStart, endingBefore: lines.lineCount)
        }

        private mutating func closeCommentBlock(from start: Int?, endingBefore line: Int) {
            guard let start, line - start >= FoldScanner.commentBlockMinimumLines else { return }
            regions.append(FoldRegion(kind: .comments, startLine: start, endLine: line - 1))
        }
    }
}
