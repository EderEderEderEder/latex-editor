import Foundation

/// Was beim Übernehmen eines Vorschlags im Text passiert: welcher Bereich ersetzt wird, durch was,
/// und wo der Cursor danach steht. Reine Logik.
struct CompletionEdit: Equatable, Sendable {
    let range: NSRange
    let text: String
    let selection: NSRange
    /// Danach gleich die nächste Liste zeigen (`\ref{}` → Labels, `width=` → Werte)
    var opensFollowUp = false
}

enum CompletionApplier {
    private static let closeBrace = UInt16(UInt8(ascii: "}"))
    private static let comma = UInt16(UInt8(ascii: ","))
    private static let newline = UInt16(UInt8(ascii: "\n"))
    /// Inhalt, mit dem eine Umgebung aus `\begin{…}` beginnt
    private static let environmentBodies = ["itemize": "\\item ", "enumerate": "\\item ", "description": "\\item "]

    static func edit(for item: CompletionItem, context: CompletionContext, in text: NSString) -> CompletionEdit {
        switch context.kind {
        case .command:
            let offset = item.cursorOffset ?? (item.insertion as NSString).length
            let opensArgument = CompletionContextDetector.argumentCommands[item.text] != nil && item.insertion.hasSuffix("{}")
            return CompletionEdit(range: context.range, text: item.insertion,
                                  selection: NSRange(location: context.range.location + offset, length: 0),
                                  opensFollowUp: opensArgument || item.insertion.hasPrefix(item.text + "["))
        case let .option(target, _):
            return option(item.insertion, target: target, context: context, in: text)
        case .argument(.beginEnvironment):
            return beginEnvironment(item.insertion, context: context, in: text)
        case .argument:
            return argument(item.insertion, context: context, in: text)
        }
    }

    /// Ersetzt das ganze aktuelle Argument (auch den Teil hinter dem Cursor) und schließt die Klammer,
    /// falls sie fehlt. In Listen bleibt ein folgendes Komma stehen.
    private static func argument(_ value: String, context: CompletionContext, in text: NSString) -> CompletionEdit {
        let (range, closer) = argumentRange(from: context.range, in: text)
        let inserted = value + (closer == nil ? "}" : "")
        let end = range.location + (inserted as NSString).length + (closer == closeBrace ? 1 : 0)
        return CompletionEdit(range: range, text: inserted, selection: NSRange(location: end, length: 0))
    }

    /// Wie ein Argument; steht danach nichts mehr in der Zeile, kommt das Gerüst mit `\end{…}` dazu
    /// (eingerückt wie die Zeile, Inhalt mit Tabulator, wie in der HgbThesis).
    private static func beginEnvironment(_ name: String, context: CompletionContext, in text: NSString) -> CompletionEdit {
        let (range, closer) = argumentRange(from: context.range, in: text)
        let afterClosing = NSMaxRange(range) + (closer == closeBrace ? 1 : 0)
        let replaced = NSRange(location: range.location, length: afterClosing - range.location)
        let lineRange = text.lineRange(for: NSRange(location: context.range.location, length: 0))
        let restOfLine = text.substring(with: NSRange(location: afterClosing, length: NSMaxRange(lineRange) - afterClosing))
        let indent = leadingWhitespace(of: text.substring(with: lineRange))
        guard restOfLine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !nextLine(in: text, after: lineRange).trimmingCharacters(in: .whitespaces).hasPrefix("\\end{\(name)}") else {
            let inserted = name + "}"
            return CompletionEdit(range: replaced, text: inserted,
                                  selection: NSRange(location: range.location + (inserted as NSString).length, length: 0))
        }
        let body = environmentBodies[name] ?? ""
        let head = name + "}\n" + indent + "\t" + body
        let inserted = head + "\n" + indent + "\\end{\(name)}"
        return CompletionEdit(range: replaced, text: inserted,
                              selection: NSRange(location: range.location + (head as NSString).length, length: 0))
    }

    /// Ersetzt die ganze Option. `key=` lässt den Cursor hinter `=` (dann folgen die Werte); bei Klammern
    /// mit nur einem Wert (Platzierung, Zitat) wird `]` ergänzt, falls es in der Zeile fehlt.
    private static func option(_ value: String, target: OptionTarget, context: CompletionContext, in text: NSString) -> CompletionEdit {
        let range = optionRange(from: context.range, in: text)
        if value.hasSuffix("=") {
            // Ein vorhandenes `=` (z. B. `width=\textwidth` → `height`) bleibt, statt `height==` zu ergeben.
            let hasEquals = NSMaxRange(range) < text.length && text.character(at: NSMaxRange(range)) == UInt16(UInt8(ascii: "="))
            let inserted = hasEquals ? String(value.dropLast()) : value
            let caret = range.location + (inserted as NSString).length + (hasEquals ? 1 : 0)
            return CompletionEdit(range: range, text: inserted, selection: NSRange(location: caret, length: 0), opensFollowUp: true)
        }
        let lineEnd = NSMaxRange(text.lineRange(for: NSRange(location: NSMaxRange(range), length: 0)))
        let rest = text.substring(with: NSRange(location: NSMaxRange(range), length: lineEnd - NSMaxRange(range)))
        let inserted = value + (target.isSingleValue && !rest.contains("]") ? "]" : "")
        return CompletionEdit(range: range, text: inserted,
                              selection: NSRange(location: range.location + (inserted as NSString).length, length: 0))
    }

    private static func optionRange(from range: NSRange, in text: NSString) -> NSRange {
        let stops: Set<UInt16> = [comma, newline, UInt16(UInt8(ascii: "]")), UInt16(UInt8(ascii: "="))]
        var end = NSMaxRange(range)
        while end < text.length, !stops.contains(text.character(at: end)) { end += 1 }
        return NSRange(location: range.location, length: end - range.location)
    }

    /// Das Argument reicht bis vor `}`, `,` oder Zeilenende; liefert auch das Zeichen dahinter.
    private static func argumentRange(from range: NSRange, in text: NSString) -> (NSRange, UInt16?) {
        var end = NSMaxRange(range)
        while end < text.length {
            let character = text.character(at: end)
            if character == closeBrace || character == comma { return (NSRange(location: range.location, length: end - range.location), character) }
            if character == newline { break }
            end += 1
        }
        return (NSRange(location: range.location, length: end - range.location), nil)
    }

    private static func leadingWhitespace(of line: String) -> String {
        String(line.prefix { $0 == " " || $0 == "\t" })
    }

    private static func nextLine(in text: NSString, after lineRange: NSRange) -> String {
        guard NSMaxRange(lineRange) < text.length else { return "" }
        return text.substring(with: text.lineRange(for: NSRange(location: NSMaxRange(lineRange), length: 0)))
    }
}
