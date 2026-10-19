import Foundation

/// Optionen einer Klasse, eines Pakets oder eines Befehls: Schalter (ohne Wert) und Schlüssel mit
/// möglichen Werten (leer = freier Wert).
struct PackageOptions: Equatable, Sendable {
    var flags: [String] = []
    var keys: [String: [String]] = [:]
    /// Kurzer Hinweis pro Schalter/Schlüssel
    var details: [String: String] = [:]

    var isEmpty: Bool { flags.isEmpty && keys.isEmpty }

    /// Vereinigt beide; Werte und Hinweise von `other` ergänzen fehlende.
    func merged(with other: PackageOptions) -> PackageOptions {
        var result = self
        for flag in other.flags where !result.flags.contains(flag) { result.flags.append(flag) }
        for (key, values) in other.keys {
            let existing = result.keys[key] ?? []
            result.keys[key] = existing + values.filter { !existing.contains($0) }
        }
        result.details.merge(other.details) { mine, _ in mine }
        return result
    }
}

/// Eingebaute Optionen für Befehle, Standardklassen und verbreitete Pakete. Klassen und Pakete im
/// Projekt (z. B. die HgbThesis) liest `OptionScanner` aus ihren Dateien.
enum OptionCatalog {
    static let graphics = PackageOptions(
        flags: ["keepaspectratio", "clip", "draft"],
        keys: [
            "width": ["\\textwidth", "0.8\\textwidth", "0.5\\textwidth", "\\linewidth", "\\columnwidth"],
            "height": ["\\textheight", "0.5\\textheight", "\\linewidth"],
            "scale": ["0.5", "0.75", "1.5"], "angle": ["90", "180", "270"], "trim": [], "page": [], "viewport": [],
        ],
        details: [
            "width": "Breite", "height": "Höhe", "scale": "Skalierung", "angle": "Drehung in Grad",
            "trim": "Ränder abschneiden (links unten rechts oben)", "page": "Seite eines PDFs", "viewport": "Ausschnitt",
            "keepaspectratio": "Seitenverhältnis behalten", "clip": "Abgeschnittenes ausblenden", "draft": "Nur Rahmen",
        ]
    )

    /// Wie im Einfügen-Menü (`FloatPlacement`), plus übliche Kombinationen
    static let floatPlacement = PackageOptions(
        flags: ["H", "htbp", "h", "t", "b", "p", "!htbp", "!ht", "tbp"],
        details: [
            "H": FloatPlacement.forceHere.title, "h": FloatPlacement.here.title, "t": FloatPlacement.top.title,
            "b": FloatPlacement.bottom.title, "p": FloatPlacement.page.title, "htbp": "Überall erlaubt",
            "!htbp": "Überall, Regeln lockern", "!ht": "Hier oder oben, Regeln lockern", "tbp": "Nicht hier",
        ]
    )

    static let boxPosition = PackageOptions(
        flags: ["t", "c", "b"],
        details: ["t": "Oben ausrichten", "c": "Mittig ausrichten", "b": "Unten ausrichten"]
    )

    /// Vor- und Nachsatz bei Zitaten (`\cite[vgl.][S.~12]{…}`)
    static let citation = PackageOptions(
        flags: ["S.~", "vgl.", "Kap.~", "Abschn.~", "f.", "ff."],
        details: ["S.~": "Seite", "vgl.": "Vergleiche (Vorsatz)", "Kap.~": "Kapitel", "Abschn.~": "Abschnitt",
                  "f.": "folgende Seite", "ff.": "folgende Seiten"]
    )

    static let standardClass = PackageOptions(
        flags: ["a4paper", "letterpaper", "10pt", "11pt", "12pt", "oneside", "twoside", "openright", "openany",
                "titlepage", "notitlepage", "onecolumn", "twocolumn", "landscape", "draft", "final", "fleqn", "leqno"],
        details: ["a4paper": "Papier A4", "11pt": "Schriftgröße", "12pt": "Schriftgröße", "twoside": "Doppelseitig",
                  "openright": "Kapitel rechts beginnen", "twocolumn": "Zweispaltig", "draft": "Entwurf (Overfull markiert)"]
    )

    static let standardClasses: Set<String> = ["article", "report", "book", "scrartcl", "scrreprt", "scrbook", ""]

    static let packages: [String: PackageOptions] = [
        "babel": PackageOptions(flags: ["ngerman", "german", "naustrian", "austrian", "english", "american", "british"]),
        "inputenc": PackageOptions(flags: ["utf8"]),
        "fontenc": PackageOptions(flags: ["T1"]),
        "geometry": PackageOptions(
            flags: ["a4paper", "landscape", "includeheadfoot"],
            keys: ["margin": ["2.5cm", "3cm"], "top": [], "bottom": [], "left": [], "right": [], "inner": [], "outer": []]
        ),
        "hyperref": PackageOptions(
            flags: ["hidelinks", "colorlinks", "breaklinks", "bookmarksnumbered"],
            keys: ["linkcolor": ["black", "blue"], "urlcolor": ["black", "blue"], "citecolor": ["black", "blue"],
                   "pdftitle": [], "pdfauthor": []]
        ),
        "xcolor": PackageOptions(flags: ["dvipsnames", "svgnames", "table"]),
        "graphicx": PackageOptions(flags: ["draft", "final"]),
        "amsmath": PackageOptions(flags: ["fleqn", "leqno"]),
        "caption": PackageOptions(keys: ["font": ["small", "footnotesize"], "labelfont": ["bf", "it"], "format": ["hang", "plain"]]),
        "biblatex": PackageOptions(keys: ["style": ["numeric", "authoryear", "alphabetic", "apa"], "backend": ["biber", "bibtex"],
                                          "sorting": ["nyt", "none", "ynt"], "maxbibnames": [], "maxcitenames": []]),
        "csquotes": PackageOptions(keys: ["autostyle": ["true", "false"], "german": ["guillemets", "quotes", "swiss"]]),
        "enumitem": PackageOptions(flags: ["inline", "shortlabels"]),
        "siunitx": PackageOptions(keys: ["locale": ["DE", "US"]]),
    ]
}

/// Liest Optionen aus `.cls`/`.sty`: `\DeclareOption{x}` (Schalter), `\DeclareKeys{x.code = …}` (Schlüssel;
/// veraltete mit `\@WarnDeprecatedOption` werden ausgelassen), Wertlisten aus `\@RegisterClassOption{key}{value}`,
/// Wahrheitswerte für Schlüssel mit `.default:n` und Kommentare der Form `% key=a|b|c`.
/// Speziell für die HgbThesis: `theme=` aus `hgbtheme-*.sty`, `degree=` aus `\hgbDefineDegree{…}`.
enum OptionScanner {
    private static let declareOption = try! NSRegularExpression(pattern: #"\\DeclareOption\{([^}#\\]+)\}"#)
    private static let keyCode = try! NSRegularExpression(pattern: #"^\s*([A-Za-z]+)\.code\s*="#, options: .anchorsMatchLines)
    private static let keyDefault = try! NSRegularExpression(pattern: #"^\s*([A-Za-z]+)\.default:n"#, options: .anchorsMatchLines)
    private static let registered = try! NSRegularExpression(pattern: #"\\@RegisterClassOption\{([A-Za-z]+)\}\{([^}]+)\}"#)
    private static let commentValues = try! NSRegularExpression(pattern: #"%\s*([A-Za-z]+)=([A-Za-z0-9]+(?:\|[A-Za-z0-9]+)+)"#)
    private static let degree = try! NSRegularExpression(pattern: #"\\hgbDefineDegree\{([A-Za-z-]+)\}"#)
    private static let themePrefix = "hgbtheme-"

    /// Name (Dateiname ohne Endung) → Optionen, für alle Klassen- und Paketdateien.
    static func scan(_ files: [URL]) -> [String: PackageOptions] {
        let texts = files.compactMap { file in readText(file).map { (file, $0) } }
        let globalValues = texts.reduce(into: [String: [String]]()) { result, entry in
            result.merge(commentValueLists(in: entry.1)) { old, _ in old }
        }
        let hgbValues = hgbThesisValues(files: files, texts: texts.map(\.1))
        var result: [String: PackageOptions] = [:]
        for (file, text) in texts {
            var options = options(in: text)
            for key in options.keys.keys where options.keys[key]?.isEmpty == true {
                options.keys[key] = hgbValues[key] ?? globalValues[key] ?? []
            }
            guard !options.isEmpty else { continue }
            result[file.deletingPathExtension().lastPathComponent] = options
        }
        return result
    }

    static func options(in text: String) -> PackageOptions {
        var options = PackageOptions()
        options.flags = captures(of: declareOption, in: text).map(\.[0])
        for key in declaredKeys(in: text) where options.keys[key] == nil { options.keys[key] = [] }
        for match in captures(of: keyDefault, in: text) where options.keys[match[0]]?.isEmpty == true {
            options.keys[match[0]] = ["true", "false"]
        }
        for match in captures(of: registered, in: text) where options.keys[match[0]] != nil {
            options.keys[match[0]]?.append(match[1])
        }
        return options
    }

    /// Schlüssel aus `name.code = …`. Veraltet ist ein Schlüssel, wenn seine Definition (bis zum nächsten
    /// Schlüssel, auch über mehrere Zeilen) `\@WarnDeprecatedOption` enthält.
    private static func declaredKeys(in text: String) -> [String] {
        var keys: [String] = []
        var deprecated: Set<String> = []
        var current: String?
        for line in withoutComments(text).split(separator: "\n", omittingEmptySubsequences: false) {
            if let key = captures(of: keyCode, in: String(line)).first?.first {
                current = key
                if !keys.contains(key) { keys.append(key) }
            }
            if line.contains("WarnDeprecatedOption"), let current { deprecated.insert(current) }
        }
        return keys.filter { !deprecated.contains($0) }
    }

    static func commentValueLists(in text: String) -> [String: [String]] {
        var lists: [String: [String]] = [:]
        for match in captures(of: commentValues, in: text) where lists[match[0]] == nil {
            lists[match[0]] = match[1].split(separator: "|").map(String.init)
        }
        return lists
    }

    private static func hgbThesisValues(files: [URL], texts: [String]) -> [String: [String]] {
        var values: [String: [String]] = [:]
        let themes = files.map { $0.deletingPathExtension().lastPathComponent }
            .filter { $0.hasPrefix(themePrefix) }
            .map { String($0.dropFirst(themePrefix.count)) }
            .sorted()
        if !themes.isEmpty { values["theme"] = themes }
        let degrees = texts.flatMap { captures(of: degree, in: $0).map(\.[0]) }
        if !degrees.isEmpty { values["degree"] = degrees }
        return values
    }

    /// Alle Gruppen jedes Treffers; Kommentarzeilen (außer bei Wertlisten in Kommentaren) zählen nicht.
    private static func captures(of expression: NSRegularExpression, in text: String) -> [[String]] {
        let source = expression === commentValues ? text : withoutComments(text)
        let string = source as NSString
        var result: [[String]] = []
        expression.enumerateMatches(in: source, range: NSRange(location: 0, length: string.length)) { match, _, _ in
            guard let match else { return }
            result.append((1..<match.numberOfRanges).map { string.substring(with: match.range(at: $0)) })
        }
        return result
    }

    private static func withoutComments(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false).map { line in
            var escaped = false
            for index in line.indices {
                if line[index] == "%", !escaped { return String(line[..<index]) }
                escaped = line[index] == "\\" && !escaped
            }
            return String(line)
        }.joined(separator: "\n")
    }

    private static func readText(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
    }
}
