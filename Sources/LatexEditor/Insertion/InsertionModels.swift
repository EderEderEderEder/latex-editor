import Foundation

enum InsertionKind: String, CaseIterable, Identifiable, Sendable {
    case table
    case image
    case code
    case equation
    case list
    case reference
    case citation
    case source

    var id: String { rawValue }

    var title: String {
        switch self {
        case .table: "Tabelle"
        case .image: "Bild"
        case .code: "Codeblock"
        case .equation: "Gleichung"
        case .list: "Aufzählung"
        case .reference: "Verweis"
        case .citation: "Zitat"
        case .source: "Quelle"
        }
    }

    var symbolName: String {
        switch self {
        case .table: "tablecells"
        case .image: "photo"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .equation: "function"
        case .list: "list.bullet"
        case .reference: "link"
        case .citation: "quote.opening"
        case .source: "books.vertical"
        }
    }

    /// Kurzbeschreibung für das Einfügen-Fenster
    var summary: String {
        switch self {
        case .table: "Raster mit Kopfzeile, Ausrichtung und Beschriftung"
        case .image: "Bild aus dem Projekt oder von deinem Mac"
        case .code: "Quelltext mit Sprache und Beschriftung"
        case .equation: "Formel, nummeriert oder ohne Nummer"
        case .list: "Aufzählung oder nummerierte Liste"
        case .reference: "Verweis auf Abbildung, Tabelle oder Kapitel"
        case .citation: "Zitat aus der Literaturdatei"
        case .source: "Neue Quelle in der Literaturdatei anlegen, auf Wunsch gleich zitieren"
        }
    }

    /// Block-Bausteine bekommen eigene Zeilen; Verweis und Zitat stehen im Fließtext.
    var isBlock: Bool {
        self != .reference && self != .citation && self != .source
    }

    /// Bausteine, die markierten Text als Inhalt übernehmen (er wird ersetzt).
    var usesSelectionAsContent: Bool {
        self == .code || self == .equation || self == .list
    }

    var labelPrefix: String? {
        switch self {
        case .table: "tab"
        case .image: "fig"
        case .code: "prog"
        case .equation: "eq"
        default: nil
        }
    }
}

enum FloatPlacement: String, CaseIterable, Identifiable, Sendable {
    case standard
    case here
    case top
    case bottom
    case page
    case forceHere

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: "Standard"
        case .here: "Hier, wenn möglich (h)"
        case .top: "Seitenanfang (t)"
        case .bottom: "Seitenende (b)"
        case .page: "Eigene Seite (p)"
        case .forceHere: "Hier erzwingen (H)"
        }
    }

    /// Wert in eckigen Klammern hinter `\begin{table}`; nil bei Standard.
    var option: String? {
        switch self {
        case .standard: nil
        case .here: "h"
        case .top: "t"
        case .bottom: "b"
        case .page: "p"
        case .forceHere: "H"
        }
    }
}

enum ColumnAlignment: String, CaseIterable, Identifiable, Sendable {
    case left
    case center
    case right

    var id: String { rawValue }
    var letter: String { switch self { case .left: "l"; case .center: "c"; case .right: "r" } }
    var title: String { switch self { case .left: "Links"; case .center: "Zentriert"; case .right: "Rechts" } }
}

enum TableRules: String, CaseIterable, Identifiable, Sendable {
    /// `\toprule`, `\midrule`, `\bottomrule` (booktabs, Vorlage)
    case booktabs
    /// `\hline` zwischen allen Zeilen, senkrechte Linien zwischen allen Spalten
    case grid
    case none

    var id: String { rawValue }

    var title: String {
        switch self {
        case .booktabs: "Horizontale Linien (booktabs)"
        case .grid: "Alle Linien"
        case .none: "Keine Linien"
        }
    }
}

struct TableSettings: Equatable, Sendable {
    static let maximumRows = 40
    static let maximumColumns = 12

    var rows = 3
    var columns = 3
    var hasHeader = true
    var alignments = [ColumnAlignment](repeating: .left, count: 3)
    var cells = [[String]](repeating: [String](repeating: "", count: 3), count: 3)
    var rules = TableRules.booktabs
    var caption = ""
    /// Leer = automatisch aus der Beschriftung
    var labelOverride = ""
    var placement = FloatPlacement.standard
    var escapeText = true

    /// Ändert die Größe und behält vorhandene Zellen und Ausrichtungen.
    mutating func resize(rows newRows: Int, columns newColumns: Int) {
        let rowCount = min(max(newRows, 1), Self.maximumRows)
        let columnCount = min(max(newColumns, 1), Self.maximumColumns)
        var newCells = [[String]](repeating: [String](repeating: "", count: columnCount), count: rowCount)
        for row in 0..<min(rowCount, cells.count) {
            for column in 0..<min(columnCount, cells[row].count) { newCells[row][column] = cells[row][column] }
        }
        var newAlignments = alignments
        newAlignments = (0..<columnCount).map { $0 < alignments.count ? alignments[$0] : .left }
        cells = newCells
        alignments = newAlignments
        rows = rowCount
        columns = columnCount
    }

    /// Füllt die Tabelle aus Text mit Tabulatoren (so kopieren Excel und Numbers Zellen).
    mutating func fill(fromTabSeparated text: String) {
        let parsed = TabSeparatedParser.parse(text)
        guard !parsed.isEmpty else { return }
        let columnCount = parsed.map(\.count).max() ?? 1
        // Erst leeren: `resize` behält sonst alte Zellen, die in den neuen Daten nicht vorkommen.
        cells = []
        resize(rows: parsed.count, columns: columnCount)
        for (rowIndex, row) in parsed.prefix(rows).enumerated() {
            for (columnIndex, value) in row.prefix(columns).enumerated() { cells[rowIndex][columnIndex] = value }
        }
    }
}

/// Liest Tabulator-getrennten Text mit optionalen Anführungszeichen (Zellen mit Zeilenumbruch).
enum TabSeparatedParser {
    static func parse(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var isQuoted = false
        var characters = text.replacingOccurrences(of: "\r\n", with: "\n").makeIterator()
        var pending = characters.next()
        while let character = pending {
            pending = characters.next()
            if isQuoted {
                if character == "\"" {
                    if pending == "\"" { field.append("\""); pending = characters.next() } else { isQuoted = false }
                } else {
                    field.append(character)
                }
            } else if character == "\"", field.isEmpty {
                isQuoted = true
            } else if character == "\t" {
                row.append(field)
                field = ""
            } else if character == "\n" {
                row.append(field)
                rows.append(row)
                row = []
                field = ""
            } else {
                field.append(character)
            }
        }
        if !field.isEmpty || !row.isEmpty {
            row.append(field)
            rows.append(row)
        }
        while let last = rows.last, last.allSatisfy(\.isEmpty) { rows.removeLast() }
        return rows
    }
}

struct ImageSettings: Equatable, Sendable {
    /// Gewählte Datei: im Projekt oder extern (wird beim Einfügen nach `images/` kopiert)
    var file: URL?
    var widthPercent = 75
    var caption = ""
    var labelOverride = ""
    var placement = FloatPlacement.standard
    var escapeText = true
}

struct CodeLanguage: Identifiable, Hashable, Sendable {
    let title: String
    /// Umgebung aus `hgblistings.sty`
    let environment: String

    var id: String { environment }

    static let all: [CodeLanguage] = [
        ("Allgemein (ohne Sprache)", "GenericCode"), ("Bash", "BashCode"), ("C", "CCode"), ("C++", "CppCode"),
        ("C#", "CsCode"), ("CSS", "CssCode"), ("Dart", "DartCode"), ("GLSL", "GlslCode"), ("Go", "GoCode"),
        ("HTML", "HtmlCode"), ("Java", "JavaCode"), ("JavaScript", "JsCode"), ("JSON", "JsonCode"),
        ("Kotlin", "KotlinCode"), ("LaTeX", "LaTeXCode"), ("MATLAB", "MatlabCode"), ("Objective-C", "ObjCCode"),
        ("PHP", "PhpCode"), ("Python", "PythonCode"), ("R", "RCode"), ("Rust", "RustCode"), ("Scala", "ScalaCode"),
        ("SQL", "SqlCode"), ("Swift", "SwiftCode"), ("TypeScript", "TsCode"), ("XML", "XmlCode"), ("YAML", "YamlCode")
    ].map { CodeLanguage(title: $0.0, environment: $0.1) }

    static let `default` = all.first { $0.environment == "PythonCode" } ?? all[0]
}

struct CodeSettings: Equatable, Sendable {
    var language = CodeLanguage.default
    var content = ""
    /// In einem `program`-Float mit Beschriftung (sonst nur die Umgebung)
    var asFloat = true
    var caption = ""
    var labelOverride = ""
    var placement = FloatPlacement.standard
    var lineNumbers = true
    var escapeText = true
}

enum EquationKind: String, CaseIterable, Identifiable, Sendable {
    case equation
    case equationStar
    case align
    case alignStar

    var id: String { rawValue }

    var title: String {
        switch self {
        case .equation: "Gleichung (nummeriert)"
        case .equationStar: "Gleichung (ohne Nummer)"
        case .align: "Mehrere Zeilen ausgerichtet (nummeriert)"
        case .alignStar: "Mehrere Zeilen ausgerichtet (ohne Nummer)"
        }
    }

    var environment: String {
        switch self {
        case .equation: "equation"
        case .equationStar: "equation*"
        case .align: "align"
        case .alignStar: "align*"
        }
    }

    var isNumbered: Bool { self == .equation || self == .align }
}

struct EquationSettings: Equatable, Sendable {
    var kind = EquationKind.equation
    var content = ""
    var labelOverride = ""
}

enum ListKind: String, CaseIterable, Identifiable, Sendable {
    case itemize
    case enumerate

    var id: String { rawValue }
    var title: String { self == .itemize ? "Aufzählungspunkte" : "Nummerierte Liste" }
}

struct ListSettings: Equatable, Sendable {
    static let maximumItems = 30
    var kind = ListKind.itemize
    var items = ["", "", ""]

    mutating func resize(to count: Int) {
        let target = min(max(count, 1), Self.maximumItems)
        items = (0..<target).map { $0 < items.count ? items[$0] : "" }
    }
}

struct ReferenceSettings: Equatable, Sendable {
    var label = ""
    /// „Abbildung~“, „Tabelle~“ usw. vor den Verweis setzen
    var withPrefix = true
}

enum SourceInputMode: String, CaseIterable, Identifiable, Sendable {
    case form
    case bibtex

    var id: String { rawValue }
    var title: String { self == .form ? "Formular" : "BibTeX einfügen" }
}

/// Sprache der Quelle (`langid`, steuert Silbentrennung und Begriffe im Literaturverzeichnis)
enum SourceLanguage: String, CaseIterable, Identifiable, Sendable {
    case german = "ngerman"
    case english
    case none = ""

    var id: String { rawValue }
    var title: String {
        switch self {
        case .german: "Deutsch"
        case .english: "Englisch"
        case .none: "Keine Angabe"
        }
    }
}

struct SourceSettings: Equatable, Sendable {
    var mode = SourceInputMode.form
    var type = SourceType.book
    /// „Max Mustermann; Erika Musterfrau“
    var authors = ""
    /// Feldname → Wert (nur die Felder des gewählten Typs zählen)
    var values: [String: String] = [:]
    var language = SourceLanguage.german
    var bibtex = ""
    /// Leer: automatisch (Nachname + Jahr)
    var keyOverride = ""
    var citeAfterInsert = true
    /// Seitenangabe für das Zitat, z. B. „S.~12“
    var note = ""
}

struct CitationSettings: Equatable, Sendable {
    var keys: [String] = []
    /// z. B. „S.~12“
    var note = ""
}
