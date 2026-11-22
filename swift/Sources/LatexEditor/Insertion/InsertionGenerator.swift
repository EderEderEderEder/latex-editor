import Foundation

/// Erzeugt den LaTeX-Code der Bausteine im Stil der HgbThesis-Vorlage (Tabulatoren, Beschriftung vor
/// dem Label, `booktabs`, Code in `program` mit Sprachumgebung – `lstlisting` ist dort gesperrt).
enum InsertionGenerator {
    /// Wie im Editor eingestellt (Standard: Tabulator wie in der HgbThesis)
    private static var indent: String { TextEditing.indentUnit }
    private static let rowEnd = " \\\\"
    private static let referencePrefixes: [String: String] = [
        "fig": "Abbildung", "tab": "Tabelle", "prog": "Programm", "sec": "Abschnitt", "chap": "Kapitel", "eq": "Gleichung"
    ]
    private static let placeholderEquation = "a = b"

    // MARK: Tabelle

    static func table(_ settings: TableSettings, label: String) -> String {
        var lines = ["\\begin{table}" + optionText(settings.placement.option)]
        lines += captionLines(caption: settings.caption, label: label, escape: settings.escapeText)
        lines.append(indent + "\\centering")
        lines.append(indent + "\\begin{tabular}{\(columnSpecification(settings))}")
        lines += tableRows(settings)
        lines.append(indent + "\\end{tabular}")
        lines.append("\\end{table}")
        return lines.joined(separator: "\n") + "\n"
    }

    private static func columnSpecification(_ settings: TableSettings) -> String {
        let letters = settings.alignments.prefix(settings.columns).map(\.letter)
        switch settings.rules {
        case .grid: return "|" + letters.joined(separator: "|") + "|"
        case .booktabs, .none: return "@{}" + letters.joined() + "@{}"
        }
    }

    private static func tableRows(_ settings: TableSettings) -> [String] {
        let cells = settings.cells.prefix(settings.rows).map { row in
            (0..<settings.columns).map { column -> String in
                let value = column < row.count ? row[column] : ""
                return settings.escapeText ? LatexEscaping.escape(value) : value
            }
        }
        let widths = (0..<settings.columns).map { column in cells.map { $0[column].count }.max() ?? 0 }
        let lines = cells.map { row in
            indent + indent + row.enumerated().map { $1.padding(toLength: max(widths[$0], $1.count), withPad: " ", startingAt: 0) }
                .joined(separator: " & ").trimmingCharacters(in: .whitespaces) + rowEnd
        }
        return rules(around: lines, settings: settings)
    }

    private static func rules(around rows: [String], settings: TableSettings) -> [String] {
        let rule = { (command: String) in indent + indent + command }
        switch settings.rules {
        case .booktabs:
            var result = [rule("\\toprule")]
            for (index, row) in rows.enumerated() {
                result.append(row)
                if index == 0, settings.hasHeader, rows.count > 1 { result.append(rule("\\midrule")) }
            }
            return result + [rule("\\bottomrule")]
        case .grid:
            return [rule("\\hline")] + rows.flatMap { [$0, rule("\\hline")] }
        case .none:
            return rows
        }
    }

    // MARK: Bild

    static func image(_ settings: ImageSettings, reference: String, label: String) -> String {
        var lines = ["\\begin{figure}" + optionText(settings.placement.option)]
        lines.append(indent + "\\centering")
        lines.append(indent + "\\includegraphics[width=\(widthText(percent: settings.widthPercent))]{\(reference)}")
        lines += captionLines(caption: settings.caption, label: label, escape: settings.escapeText)
        lines.append("\\end{figure}")
        return lines.joined(separator: "\n") + "\n"
    }

    /// 75 → `.75\textwidth`, 100 → `\textwidth`
    static func widthText(percent: Int) -> String {
        let clamped = min(max(percent, 1), 100)
        if clamped == 100 { return "\\textwidth" }
        let hundredths = String(format: "%02d", clamped)
        let trimmed = hundredths.hasSuffix("0") ? String(hundredths.dropLast()) : hundredths
        return ".\(trimmed)\\textwidth"
    }

    // MARK: Code

    static func code(_ settings: CodeSettings, label: String) -> String {
        let environment = settings.language.environment
        let options = settings.lineNumbers ? "" : "[numbers=none]"
        var lines: [String] = []
        if settings.asFloat {
            lines.append("\\begin{program}" + optionText(settings.placement.option))
            lines += captionLines(caption: settings.caption, label: label, escape: settings.escapeText)
        }
        lines.append("\\begin{\(environment)}\(options)")
        lines.append(settings.content.trimmingCharacters(in: .newlines))
        lines.append("\\end{\(environment)}")
        if settings.asFloat { lines.append("\\end{program}") }
        return lines.joined(separator: "\n") + "\n"
    }

    // MARK: Gleichung, Liste

    static func equation(_ settings: EquationSettings, label: String) -> String {
        let environment = settings.kind.environment
        let content = settings.content.trimmingCharacters(in: .whitespacesAndNewlines)
        var lines = ["\\begin{\(environment)}"]
        for line in (content.isEmpty ? placeholderEquation : content).split(separator: "\n", omittingEmptySubsequences: false) {
            lines.append(indent + line.trimmingCharacters(in: .whitespaces))
        }
        if settings.kind.isNumbered, !label.isEmpty { lines.append(indent + "\\label{\(label)}") }
        lines.append("\\end{\(environment)}")
        return lines.joined(separator: "\n") + "\n"
    }

    static func list(_ settings: ListSettings) -> String {
        let environment = settings.kind.rawValue
        var lines = ["\\begin{\(environment)}"]
        for item in settings.items {
            let text = item.trimmingCharacters(in: .whitespaces)
            lines.append(indent + "\\item" + (text.isEmpty ? "" : " " + text))
        }
        lines.append("\\end{\(environment)}")
        return lines.joined(separator: "\n") + "\n"
    }

    // MARK: Verweis, Zitat

    static func reference(_ settings: ReferenceSettings) -> String {
        guard !settings.label.isEmpty else { return "\\ref{}" }
        let command = "\\ref{\(settings.label)}"
        guard settings.withPrefix,
              let prefix = settings.label.split(separator: ":").first.flatMap({ referencePrefixes[String($0)] }) else {
            return command
        }
        return "\(prefix)~\(command)"
    }

    static func citation(_ settings: CitationSettings) -> String {
        let note = settings.note.trimmingCharacters(in: .whitespaces)
        return "\\cite" + (note.isEmpty ? "" : "[\(note)]") + "{\(settings.keys.joined(separator: ","))}"
    }

    // MARK: Hilfen

    private static func optionText(_ option: String?) -> String {
        option.map { "[\($0)]" } ?? ""
    }

    /// `\caption` zuerst, dann `\label`; beides entfällt, wenn nichts angegeben ist.
    private static func captionLines(caption: String, label: String, escape: Bool) -> [String] {
        let text = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        var lines: [String] = []
        if !text.isEmpty { lines.append(indent + "\\caption{\(escape ? LatexEscaping.escape(text) : text)}") }
        if !text.isEmpty, !label.isEmpty { lines.append(indent + "\\label{\(label)}") }
        return lines
    }
}
