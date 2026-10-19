import Foundation

/// Was die Vervollständigung aus dem Projekt kennt. Wird im Hintergrund gelesen (beim Öffnen, nach dem
/// Speichern und bei Dateiänderungen), nie pro Tastendruck.
struct CompletionIndex: Equatable, Sendable {
    var catalog = ProjectCatalog.empty
    /// Für `\includegraphics`: Pfade relativ zu `\graphicspath` bzw. zum Projekt
    var graphicsReferences: [String] = []
    /// Für `\input`/`\include`: relativ zur Hauptdatei, ohne `.tex`
    var inputPaths: [String] = []
    /// Eigene Befehle aus `.tex`, `.cls` und `.sty` des Projekts (ohne `\`)
    var userCommands: [String] = []
    /// Im Projekt definierte oder benutzte Umgebungen
    var environments: [String] = []
    /// Optionen der Klassen und Pakete im Projekt (Dateiname ohne Endung → Optionen)
    var packageOptions: [String: PackageOptions] = [:]
    /// Labels, die irgendwo mit `\ref` & Co. verwendet werden, und zitierte Schlüssel (für „ungenutzt“-Hinweise)
    var usedLabels: Set<String> = []
    var usedCitations: Set<String> = []
    /// `\nocite{*}` irgendwo: Alle Quellen gelten als benutzt
    var citesEverything = false

    static let empty = CompletionIndex()

    /// `files`: Dateien des Projektbaums; `styleFiles`: `.cls`/`.sty` im Projekt (stehen nicht im Baum).
    static func build(files: [URL], styleFiles: [URL], projectRoot: URL, mainFile: URL?) -> CompletionIndex {
        let measurement = Signposts.begin("CompletionIndex")
        defer { measurement.end() }
        var index = CompletionIndex()
        index.catalog = ProjectCatalog.scan(files: files, mainFile: mainFile)
        index.graphicsReferences = files.filter { FileKind(url: $0) == .image }
            .map { GraphicsReference.path(for: $0, projectRoot: projectRoot, graphicsDirectories: index.catalog.graphicsDirectories) }
            .sorted()
        let base = (mainFile?.deletingLastPathComponent() ?? projectRoot).standardizedFileURL.path + "/"
        index.inputPaths = files.filter { FileKind(url: $0) == .tex && $0.standardizedFileURL != mainFile?.standardizedFileURL }
            .map { $0.standardizedFileURL.path }
            .filter { $0.hasPrefix(base) }
            .map { String($0.dropFirst(base.count).dropLast(".tex".count)) }
            .sorted()
        var commands: Set<String> = []
        var environments: Set<String> = []
        for file in files.filter({ FileKind(url: $0) == .tex }) + styleFiles {
            guard let text = readText(file) else { continue }
            commands.formUnion(definedCommands(in: text))
            environments.formUnion(definedEnvironments(in: text))
            guard FileKind(url: file) == .tex else { continue }
            for occurrence in LatexReferences.scan(text) {
                switch occurrence.kind {
                case .labelUse: index.usedLabels.insert(occurrence.key)
                case .citation: index.usedCitations.insert(occurrence.key)
                case .labelDefinition: break
                }
            }
            if LatexReferences.citesEverything(text) { index.citesEverything = true }
        }
        index.userCommands = commands.sorted()
        index.environments = environments.sorted()
        index.packageOptions = OptionScanner.scan(styleFiles)
        return index
    }

    // MARK: Makros und Umgebungen

    private static let commandDefinition = try! NSRegularExpression(
        pattern: #"\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|DeclareMathOperator|def)\*?\s*\{?\\([A-Za-z]+)(?![A-Za-z@])"#
    )
    private static let environmentDefinition = try! NSRegularExpression(
        pattern: #"\\(?:newenvironment|renewenvironment|NewDocumentEnvironment|lstnewenvironment|newtheorem|begin)\*?\s*\{([A-Za-z]+\*?)\}"#
    )

    /// Namen ohne `@` (interne Makros von Klassen und Paketen); Kommentare werden ignoriert.
    static func definedCommands(in text: String) -> Set<String> {
        matches(of: commandDefinition, in: text)
    }

    static func definedEnvironments(in text: String) -> Set<String> {
        matches(of: environmentDefinition, in: text)
    }

    private static func matches(of expression: NSRegularExpression, in text: String) -> Set<String> {
        let code = withoutComments(text) as NSString
        var names: Set<String> = []
        expression.enumerateMatches(in: code as String, range: NSRange(location: 0, length: code.length)) { match, _, _ in
            guard let match, match.numberOfRanges > 1 else { return }
            names.insert(code.substring(with: match.range(at: 1)))
        }
        return names
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

    /// `.cls`/`.sty` im Projekt (Vorlagen wie die HgbThesis), ohne versteckte Ordner.
    static func styleFiles(in root: URL) -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return [] }
        return enumerator.compactMap { $0 as? URL }.filter { ["cls", "sty"].contains($0.pathExtension.lowercased()) }
    }

    private static func readText(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
    }
}
