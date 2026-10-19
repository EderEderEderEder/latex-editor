import Foundation

/// Liefert die Vorschläge zu einem Kontext. Der Projektindex wird im Hintergrund gelesen; Labels aus
/// geänderten, noch nicht gespeicherten Dateien kommen beim Öffnen der Liste dazu.
@MainActor
final class CompletionProvider {
    static let reloadDelay = Duration.milliseconds(500)

    private(set) var index = CompletionIndex.empty
    /// Der Index wurde mindestens einmal gelesen (sonst wären alle Labels „unbekannt“)
    private(set) var hasIndex = false
    /// Nach jedem neuen Index (Prüfung auf unbekannte Verweise, Hinweise)
    var onIndexChanged: (() -> Void)?
    /// Offene Dateien mit ungespeicherten Änderungen (Datei, aktueller Text)
    var unsavedDocuments: () -> [(url: URL, text: String)] = { [] }

    private var commandItems = CommandCatalog.commands
    private var environmentNames = CommandCatalog.environments
    private var reloadTask: Task<Void, Never>?
    private var generation = 0

    /// Index neu lesen; mehrere Aufrufe kurz hintereinander werden zusammengefasst.
    func scheduleReload(files: [URL], projectRoot: URL, mainFile: URL?) {
        reloadTask?.cancel()
        let currentGeneration = generation
        reloadTask = Task { [weak self] in
            try? await Task.sleep(for: Self.reloadDelay)
            guard !Task.isCancelled else { return }
            await self?.reload(files: files, projectRoot: projectRoot, mainFile: mainFile, generation: currentGeneration)
        }
    }

    /// Sofort lesen (beim Öffnen eines Projekts und in Tests).
    func reload(files: [URL], projectRoot: URL, mainFile: URL?) async {
        reloadTask?.cancel()
        await reload(files: files, projectRoot: projectRoot, mainFile: mainFile, generation: generation)
    }


    private func reload(files: [URL], projectRoot: URL, mainFile: URL?, generation expected: Int) async {
        let built = await Task.detached(priority: .utility) {
            CompletionIndex.build(files: files, styleFiles: CompletionIndex.styleFiles(in: projectRoot),
                                  projectRoot: projectRoot, mainFile: mainFile)
        }.value
        guard expected == generation else { return }
        apply(built, isLoaded: true)
    }

    func reset() {
        generation += 1
        reloadTask?.cancel()
        apply(.empty, isLoaded: false)
    }

    private func apply(_ newIndex: CompletionIndex, isLoaded: Bool) {
        index = newIndex
        hasIndex = isLoaded
        defer { onIndexChanged?() }
        let known = Set(CommandCatalog.commands.map(\.text))
        commandItems = CommandCatalog.commands + newIndex.userCommands.filter { !known.contains($0) }
            .map { CompletionItem.command($0, detail: "aus dem Projekt") }
        var seen: Set<String> = []
        environmentNames = (CommandCatalog.environments + newIndex.environments).filter { seen.insert($0).inserted }
    }

    // MARK: Vorschläge

    func items(for context: CompletionContext, document: NSString, cursor: Int) -> [CompletionItem] {
        switch context.kind {
        case .command: commandItems
        case .argument(.label): labelItems()
        case .argument(.citation):
            index.catalog.bibEntries.map { entry in
                CompletionItem(kind: .citation, text: entry.key, detail: entry.summary,
                               searchableExtra: [entry.allAuthors, entry.title, entry.year].joined(separator: " "))
            }
        case .argument(.graphics): index.graphicsReferences.map { CompletionItem(kind: .image, text: $0) }
        case .argument(.input): index.inputPaths.map { CompletionItem(kind: .file, text: $0) }
        case .argument(.beginEnvironment): environmentNames.map { CompletionItem(kind: .environment, text: $0) }
        case .argument(.endEnvironment):
            OpenEnvironments.stack(in: document, upTo: cursor).reversed().map { CompletionItem(kind: .environment, text: $0, detail: "offen") }
        case let .option(target, key):
            optionItems(for: options(for: target), key: key)
        }
    }

    // MARK: Optionen

    func options(for target: OptionTarget) -> PackageOptions {
        switch target {
        case .graphics: OptionCatalog.graphics
        case .floatPlacement: OptionCatalog.floatPlacement
        case .boxPosition: OptionCatalog.boxPosition
        case .citation: OptionCatalog.citation
        case let .documentClass(name):
            (index.packageOptions[name] ?? PackageOptions())
                .merged(with: OptionCatalog.standardClasses.contains(name) ? OptionCatalog.standardClass : PackageOptions())
        case let .package(name):
            (index.packageOptions[name] ?? PackageOptions()).merged(with: OptionCatalog.packages[name] ?? PackageOptions())
        }
    }

    /// Ohne `key`: Schlüssel (als `key=`) und Schalter; mit `key`: dessen Werte.
    private func optionItems(for options: PackageOptions, key: String?) -> [CompletionItem] {
        if let key {
            return (options.keys[key] ?? []).map { CompletionItem(kind: .option, text: $0, detail: key) }
        }
        let keys = options.keys.keys.sorted().map { name in
            CompletionItem(kind: .option, text: name + "=", detail: options.details[name] ?? valueSummary(options.keys[name] ?? []))
        }
        let flags = options.flags.map { CompletionItem(kind: .option, text: $0, detail: options.details[$0] ?? "") }
        return keys + flags
    }

    private func valueSummary(_ values: [String]) -> String {
        let shown = values.prefix(3).joined(separator: ", ")
        return values.count > 3 ? shown + ", …" : shown
    }

    /// Labels von der Platte, für ungespeicherte Dateien aus dem Editortext.
    func allLabels() -> [LabelEntry] {
        let unsaved = unsavedDocuments()
        let unsavedFiles = Set(unsaved.map { $0.url.standardizedFileURL })
        var labels = index.catalog.labels.filter { !unsavedFiles.contains($0.file.standardizedFileURL) }
        for document in unsaved { labels += ProjectCatalog.labels(in: document.text, file: document.url) }
        labels.sort { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
        return labels
    }

    private func labelItems() -> [CompletionItem] {
        allLabels().map { CompletionItem(kind: .label, text: $0.label, detail: "\($0.file.lastPathComponent):\($0.line)") }
    }

    /// Bekannte Labels für die Prüfung; `nil`, solange der Index nicht gelesen ist
    func knownLabels() -> Set<String>? {
        hasIndex ? Set(allLabels().map(\.label)) : nil
    }

    /// Bekannte Literaturschlüssel; `nil` ohne Index oder ohne Einträge (z. B. Literaturdatei außerhalb des Projekts)
    func knownCitations() -> Set<String>? {
        guard hasIndex, !index.catalog.bibEntries.isEmpty else { return nil }
        return Set(index.catalog.bibEntries.map(\.key))
    }
}

/// Offene Umgebungen vor dem Cursor (für `\end{`), außen zuerst. Kommentare zählen nicht.
enum OpenEnvironments {
    /// Weiter zurück wird nicht gesucht (eine Umgebung über Hunderttausende Zeichen ist kein Fall für `\end{`)
    static let maximumLookBehind = 200_000
    private static let expression = try! NSRegularExpression(pattern: #"\\(begin|end)\s*\{([^}]*)\}"#)

    static func stack(in text: NSString, upTo cursor: Int) -> [String] {
        let start = max(0, cursor - maximumLookBehind)
        let range = NSRange(location: start, length: cursor - start)
        var stack: [String] = []
        expression.enumerateMatches(in: text as String, range: range) { match, _, _ in
            guard let match, !isCommented(text, at: match.range.location) else { return }
            let name = text.substring(with: match.range(at: 2))
            if text.substring(with: match.range(at: 1)) == "begin" {
                stack.append(name)
            } else if let index = stack.lastIndex(of: name) {
                stack.removeSubrange(index...)
            }
        }
        return stack
    }

    private static func isCommented(_ text: NSString, at location: Int) -> Bool {
        let lineStart = text.lineRange(for: NSRange(location: location, length: 0)).location
        var escaped = false
        for index in lineStart..<location {
            let character = text.character(at: index)
            if character == UInt16(UInt8(ascii: "%")), !escaped { return true }
            escaped = character == UInt16(UInt8(ascii: "\\")) && !escaped
        }
        return false
    }
}
