import Foundation

/// Eine Bearbeitung: Bereich ersetzen und danach die Auswahl setzen (alles in UTF-16).
struct TextEdit: Equatable, Sendable {
    let range: NSRange
    let text: String
    let selection: NSRange
}

/// Bearbeitungsbefehle des Editors als reine Logik auf Text und Auswahl: Klammern, Kommentar, Einrücken,
/// Zeilen verschieben, Formatierung, Zeilenumbruch mit Einrückung. Der Editor wendet das Ergebnis als
/// einen Undo-Schritt an.
enum TextEditing {
    static let commentPrefix = "% "
    static let indentUnit = "\t"
    /// Ein Ausrücken entfernt einen Tabulator oder bis zu so vielen Leerzeichen
    static let spacesPerIndent = 4
    static let pairs: [String: String] = ["{": "}", "[": "]", "(": ")", "$": "$"]
    private static let closers: Set<String> = ["}", "]", ")", "$"]
    /// Vor diesen Zeichen (oder am Zeilenende) schließt eine Klammer automatisch
    private static let closeBeforeCharacters = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ")]}.,;:"))
    private static let listItem = "\\item"
    /// Inhalt, mit dem eine Umgebung beginnt (Listen mit erstem Punkt)
    static let environmentBodies = ["itemize": "\\item ", "enumerate": "\\item ", "description": "\\item "]
    /// So weit wird nach einem passenden `\end` gesucht, bevor eins ergänzt wird
    private static let endSearchLength = 50_000

    static func isAutoPair(_ text: String) -> Bool {
        pairs.contains { $0.key + $0.value == text }
    }

    // MARK: Klammern

    /// Beim Tippen einer Klammer: Auswahl umschließen, Paar einfügen oder schließende Klammer überspringen.
    /// `nil`: normal tippen.
    static func typed(_ character: String, in text: NSString, selection: NSRange) -> TextEdit? {
        if selection.length > 0, let closer = pairs[character] {
            let inner = text.substring(with: selection)
            return TextEdit(range: selection, text: character + inner + closer,
                            selection: NSRange(location: selection.location + 1, length: selection.length))
        }
        guard selection.length == 0 else { return nil }
        let cursor = selection.location
        let next = cursor < text.length ? text.substring(with: NSRange(location: cursor, length: 1)) : ""
        if closers.contains(character), next == character, !isEscaped(text, at: cursor) {
            return TextEdit(range: NSRange(location: cursor, length: 0), text: "", selection: NSRange(location: cursor + 1, length: 0))
        }
        guard let closer = pairs[character], !isEscaped(text, at: cursor),
              next.isEmpty || next.unicodeScalars.allSatisfy(closeBeforeCharacters.contains) else { return nil }
        if character == "$", isClosingDollar(in: text, at: cursor) { return nil }
        return TextEdit(range: NSRange(location: cursor, length: 0), text: character + closer,
                        selection: NSRange(location: cursor + 1, length: 0))
    }

    /// Rückschritt zwischen einem leeren Paar (`{|}`) löscht beide Zeichen.
    static func deleteBackward(in text: NSString, selection: NSRange) -> TextEdit? {
        guard selection.length == 0, selection.location > 0, selection.location < text.length else { return nil }
        let previous = text.substring(with: NSRange(location: selection.location - 1, length: 1))
        let next = text.substring(with: NSRange(location: selection.location, length: 1))
        guard pairs[previous] == next, !isEscaped(text, at: selection.location - 1) else { return nil }
        return TextEdit(range: NSRange(location: selection.location - 1, length: 2), text: "",
                        selection: NSRange(location: selection.location - 1, length: 0))
    }

    /// Ungerade Anzahl `\` direkt vor `index`
    private static func isEscaped(_ text: NSString, at index: Int) -> Bool {
        var count = 0
        var position = index - 1
        while position >= 0, text.character(at: position) == UInt16(UInt8(ascii: "\\")) {
            count += 1
            position -= 1
        }
        return count % 2 == 1
    }

    /// Steht schon eine ungerade Anzahl `$` in der Zeile davor, schließt dieses `$` die Formel.
    private static func isClosingDollar(in text: NSString, at cursor: Int) -> Bool {
        let lineStart = text.lineRange(for: NSRange(location: cursor, length: 0)).location
        var count = 0
        for index in lineStart..<cursor where text.character(at: index) == UInt16(UInt8(ascii: "$")) && !isEscaped(text, at: index) {
            count += 1
        }
        return count % 2 == 1
    }

    // MARK: Zeilenumbruch

    /// Enter: Einrückung der Zeile übernehmen; nach `\begin{x}` das passende `\end{x}` ergänzen;
    /// in Listen mit `\item` weitermachen, ein leeres `\item` beendet die Liste.
    static func newline(in text: NSString, selection: NSRange) -> TextEdit {
        let lineStart = text.lineRange(for: NSRange(location: selection.location, length: 0)).location
        let prefix = text.substring(with: NSRange(location: lineStart, length: selection.location - lineStart))
        let indent = String(prefix.prefix { $0 == " " || $0 == "\t" })
        let lineEnd = lineEndExcludingNewline(text, from: NSMaxRange(selection))
        let rest = text.substring(with: NSRange(location: NSMaxRange(selection), length: lineEnd - NSMaxRange(selection)))
        let trimmed = prefix.trimmingCharacters(in: .whitespaces)
        if rest.trimmingCharacters(in: .whitespaces).isEmpty, let environment = openedEnvironment(in: trimmed),
           !isClosed(environment, in: text, after: NSMaxRange(selection)) {
            let head = "\n" + indent + indentUnit + (environmentBodies[environment] ?? "")
            return edit(replacing: selection, with: head + "\n" + indent + "\\end{\(environment)}", caretOffset: head)
        }
        if trimmed == listItem, rest.trimmingCharacters(in: .whitespaces).isEmpty, selection.length == 0 {
            // Leerer Punkt: Liste beenden (der Punkt verschwindet, die Einrückung bleibt)
            return TextEdit(range: NSRange(location: lineStart, length: selection.location - lineStart), text: indent,
                            selection: NSRange(location: lineStart + (indent as NSString).length, length: 0))
        }
        let continuation = trimmed.hasPrefix(listItem + " ") || trimmed.hasPrefix(listItem + "[") ? listItem + " " : ""
        let inserted = "\n" + indent + continuation
        return edit(replacing: selection, with: inserted, caretOffset: inserted)
    }

    private static let beginPattern = try! NSRegularExpression(pattern: #"\\begin\{([^}]+)\}(?:\[[^\]]*\]|\{[^}]*\})*$"#)

    /// Endet die Zeile mit `\begin{x}` (und Argumenten), liefert `x`.
    static func openedEnvironment(in line: String) -> String? {
        let text = line as NSString
        guard let match = beginPattern.firstMatch(in: line, range: NSRange(location: 0, length: text.length)) else { return nil }
        return text.substring(with: match.range(at: 1))
    }

    /// Gibt es nach `location` schon das passende `\end{x}` (mit Verschachtelung derselben Umgebung)?
    static func isClosed(_ environment: String, in text: NSString, after location: Int) -> Bool {
        let range = NSRange(location: location, length: min(endSearchLength, text.length - location))
        let pattern = try? NSRegularExpression(pattern: #"\\(begin|end)\{"# + NSRegularExpression.escapedPattern(for: environment) + #"\}"#)
        var depth = 1
        var closed = false
        pattern?.enumerateMatches(in: text as String, range: range) { match, _, stop in
            guard let match else { return }
            depth += text.substring(with: match.range(at: 1)) == "begin" ? 1 : -1
            if depth == 0 {
                closed = true
                stop.pointee = true
            }
        }
        return closed
    }

    // MARK: Zeilen

    /// Ganze Zeilen der Auswahl (inklusive Zeilenumbruch); eine Auswahl, die genau am Zeilenanfang endet,
    /// nimmt diese Zeile nicht mehr mit.
    static func lineBlock(in text: NSString, selection: NSRange) -> NSRange {
        var adjusted = selection
        if adjusted.length > 0, NSMaxRange(adjusted) > 0, NSMaxRange(adjusted) <= text.length,
           text.character(at: NSMaxRange(adjusted) - 1) == UInt16(UInt8(ascii: "\n")) {
            adjusted.length -= 1
        }
        return text.lineRange(for: adjusted)
    }

    /// ⌘/: Alle nicht leeren Zeilen auskommentiert → Kommentar entfernen, sonst `% ` bei der kleinsten Einrückung.
    static func toggleComment(in text: NSString, selection: NSRange) -> TextEdit {
        let block = lineBlock(in: text, selection: selection)
        let lines = text.substring(with: block).components(separatedBy: "\n")
        let content = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        let commented = !content.isEmpty && content.allSatisfy { $0.trimmingCharacters(in: .whitespaces).hasPrefix("%") }
        let column = content.map { $0.prefix { $0 == " " || $0 == "\t" }.count }.min() ?? 0
        let changed = lines.map { line -> String in
            guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return line }
            if commented { return uncommented(line) }
            let index = line.index(line.startIndex, offsetBy: column)
            return String(line[..<index]) + commentPrefix + String(line[index...])
        }
        return blockEdit(block, lines: changed, original: selection, in: text)
    }

    private static func uncommented(_ line: String) -> String {
        guard let percent = line.firstIndex(of: "%") else { return line }
        var rest = line[line.index(after: percent)...]
        if rest.first == " " { rest = rest.dropFirst() }
        return String(line[..<percent]) + rest
    }

    /// ⌘] bzw. Tab mit Auswahl: einen Tabulator vor jede nicht leere Zeile.
    static func indent(in text: NSString, selection: NSRange) -> TextEdit {
        let block = lineBlock(in: text, selection: selection)
        let lines = text.substring(with: block).components(separatedBy: "\n")
        let changed = lines.map { $0.trimmingCharacters(in: .whitespaces).isEmpty ? $0 : indentUnit + $0 }
        return blockEdit(block, lines: changed, original: selection, in: text)
    }

    /// ⌘[ bzw. ⇧Tab: einen Tabulator oder bis zu vier Leerzeichen am Zeilenanfang entfernen.
    static func outdent(in text: NSString, selection: NSRange) -> TextEdit {
        let block = lineBlock(in: text, selection: selection)
        let lines = text.substring(with: block).components(separatedBy: "\n")
        let changed = lines.map { line -> String in
            if line.hasPrefix(indentUnit) { return String(line.dropFirst()) }
            return String(line.dropFirst(min(spacesPerIndent, line.prefix { $0 == " " }.count)))
        }
        return blockEdit(block, lines: changed, original: selection, in: text)
    }

    /// Ersetzt die Zeilen. Mit Auswahl ist danach der ganze Block markiert; ohne bleibt der Cursor an seiner
    /// Stelle in der Zeile (verschoben um das, was vor ihm eingefügt oder entfernt wurde).
    private static func blockEdit(_ block: NSRange, lines: [String], original: NSRange, in text: NSString) -> TextEdit {
        let replacement = lines.joined(separator: "\n")
        guard original.length == 0 else {
            let trailing = replacement.hasSuffix("\n") ? 1 : 0
            return TextEdit(range: block, text: replacement,
                            selection: NSRange(location: block.location, length: (replacement as NSString).length - trailing))
        }
        let oldLine = text.substring(with: NSRange(location: block.location, length: lineLength(text, at: block.location))) as NSString
        let newLine = (lines.first ?? "") as NSString
        let column = original.location - block.location
        var changeColumn = 0
        while changeColumn < min(oldLine.length, newLine.length),
              oldLine.character(at: changeColumn) == newLine.character(at: changeColumn) { changeColumn += 1 }
        let newColumn = column >= changeColumn ? max(changeColumn, column + newLine.length - oldLine.length) : column
        return TextEdit(range: block, text: replacement, selection: NSRange(location: block.location + newColumn, length: 0))
    }

    private static func lineLength(_ text: NSString, at location: Int) -> Int {
        lineEndExcludingNewline(text, from: location) - location
    }

    private static func lineEndExcludingNewline(_ text: NSString, from location: Int) -> Int {
        var end = location
        while end < text.length, text.character(at: end) != UInt16(UInt8(ascii: "\n")) { end += 1 }
        return end
    }

    /// ⌥↑ / ⌥↓: die Zeilen der Auswahl mit der Zeile darüber bzw. darunter tauschen. `nil` am Anfang/Ende.
    static func moveLines(up: Bool, in text: NSString, selection: NSRange) -> TextEdit? {
        let block = lineBlock(in: text, selection: selection)
        if up {
            guard block.location > 0 else { return nil }
            let previous = text.lineRange(for: NSRange(location: block.location - 1, length: 0))
            let edit = swapped(upper: previous, lower: block, in: text)
            return TextEdit(range: edit.range, text: edit.text,
                            selection: NSRange(location: selection.location - previous.length, length: selection.length))
        }
        guard NSMaxRange(block) < text.length else { return nil }
        let next = text.lineRange(for: NSRange(location: NSMaxRange(block), length: 0))
        let edit = swapped(upper: block, lower: next, in: text)
        let nextCore = text.substring(with: next).hasSuffix("\n") ? next.length - 1 : next.length
        return TextEdit(range: edit.range, text: edit.text,
                        selection: NSRange(location: selection.location + nextCore + 1, length: selection.length))
    }

    /// Zwei aufeinanderfolgende Zeilenblöcke tauschen; der Zeilenumbruch am Ende bleibt, wo er war.
    private static func swapped(upper: NSRange, lower: NSRange, in text: NSString) -> (range: NSRange, text: String) {
        let upperText = text.substring(with: upper)
        let lowerText = text.substring(with: lower)
        let upperCore = upperText.hasSuffix("\n") ? String(upperText.dropLast()) : upperText
        let lowerEndsWithNewline = lowerText.hasSuffix("\n")
        let lowerCore = lowerEndsWithNewline ? String(lowerText.dropLast()) : lowerText
        return (NSRange(location: upper.location, length: NSMaxRange(lower) - upper.location),
                lowerCore + "\n" + upperCore + (lowerEndsWithNewline ? "\n" : ""))
    }

    /// ⇧⌥↓: die Zeilen der Auswahl darunter verdoppeln; die Auswahl wandert mit.
    static func duplicateLines(in text: NSString, selection: NSRange) -> TextEdit {
        let block = lineBlock(in: text, selection: selection)
        let blockText = text.substring(with: block)
        let hasNewline = blockText.hasSuffix("\n")
        let inserted = hasNewline ? blockText : "\n" + blockText
        let shift = (blockText as NSString).length + (hasNewline ? 0 : 1)
        return TextEdit(range: NSRange(location: NSMaxRange(block), length: 0), text: inserted,
                        selection: NSRange(location: selection.location + shift, length: selection.length))
    }

    /// ⇧⌘K: die Zeilen der Auswahl löschen.
    static func deleteLines(in text: NSString, selection: NSRange) -> TextEdit {
        var block = lineBlock(in: text, selection: selection)
        // Letzte Zeile ohne Umbruch: den Umbruch davor mitnehmen, sonst bleibt eine leere Zeile.
        if !text.substring(with: block).hasSuffix("\n"), block.location > 0 {
            block = NSRange(location: block.location - 1, length: block.length + 1)
        }
        let caret = min(block.location, max(0, text.length - block.length))
        return TextEdit(range: block, text: "", selection: NSRange(location: caret, length: 0))
    }

    // MARK: Formatierung

    /// ⇧⌘B, ⌘I …: Auswahl in `\befehl{…}` setzen (bzw. wieder herausnehmen, wenn sie schon darin steht).
    /// Ohne Auswahl entsteht `\befehl{}` mit dem Cursor dazwischen.
    static func wrap(_ command: String, in text: NSString, selection: NSRange) -> TextEdit {
        let opening = "\\\(command){"
        let openingLength = (opening as NSString).length
        if selection.location >= openingLength, NSMaxRange(selection) < text.length,
           text.substring(with: NSRange(location: selection.location - openingLength, length: openingLength)) == opening,
           text.substring(with: NSRange(location: NSMaxRange(selection), length: 1)) == "}" {
            let outer = NSRange(location: selection.location - openingLength, length: selection.length + openingLength + 1)
            return TextEdit(range: outer, text: text.substring(with: selection),
                            selection: NSRange(location: outer.location, length: selection.length))
        }
        let inner = text.substring(with: selection)
        return TextEdit(range: selection, text: opening + inner + "}",
                        selection: NSRange(location: selection.location + openingLength, length: selection.length))
    }

    private static func edit(replacing selection: NSRange, with text: String, caretOffset prefix: String) -> TextEdit {
        TextEdit(range: selection, text: text, selection: NSRange(location: selection.location + (prefix as NSString).length, length: 0))
    }
}
