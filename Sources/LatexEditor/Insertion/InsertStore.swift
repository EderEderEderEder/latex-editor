import Foundation
import Observation

/// Zustand des Einfügen-Fensters: gewählter Baustein, Einstellungen je Baustein, Projektkatalog und Vorschau.
@MainActor
@Observable
final class InsertStore {
    static let citeNeedsTeXMessage = "Zum Zitieren muss eine .tex-Datei vorne sein. Ohne „Gleich zitieren“ wird nur die Quelle angelegt."
    static let needsTeXMessage = "Zum Einfügen muss eine .tex-Datei geöffnet sein."
    private static let lastKindKey = "insertionKind"
    private static let missingLabelFallback = ["tab": "tabelle", "fig": "bild", "prog": "code", "eq": "gleichung"]

    var isPresented = false
    var kind: InsertionKind {
        didSet { if kind != oldValue { defaults.set(kind.rawValue, forKey: Self.lastKindKey) } }
    }
    var table = TableSettings()
    var image = ImageSettings()
    var code = CodeSettings()
    var equation = EquationSettings()
    var list = ListSettings()
    var reference = ReferenceSettings()
    var citation = CitationSettings()
    var source = SourceSettings()
    var errorMessage: String?

    private(set) var catalog = ProjectCatalog.empty
    private(set) var projectRoot: URL?
    /// Bilder im Projekt (für die Auswahl)
    private(set) var projectImages: [URL] = []
    /// Literaturdatei, in die neue Quellen kommen (aus der Hauptdatei, sonst die erste im Projekt)
    private(set) var bibliographyFile: URL?

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var catalogTask: Task<Void, Never>?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        kind = defaults.string(forKey: Self.lastKindKey).flatMap(InsertionKind.init(rawValue:)) ?? .table
    }

    // MARK: Öffnen

    /// Öffnet das Fenster. Markierter Text wird bei Code, Gleichung und Liste als Inhalt übernommen.
    func present(kind newKind: InsertionKind, selectedText: String, root: URL?, files: [URL], mainFile: URL?) {
        kind = newKind
        projectRoot = root
        projectImages = files.filter { FileKind(url: $0) == .image && ImageImport.isSupported($0) }
        let text = selectedText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { adoptSelection(text) }
        errorMessage = nil
        isPresented = true
        reloadCatalog(files: files, mainFile: mainFile)
    }

    private func adoptSelection(_ text: String) {
        code.content = text
        equation.content = text
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map { $0.trimmingCharacters(in: .whitespaces) }
        if !lines.isEmpty { list.items = Array(lines.prefix(ListSettings.maximumItems)) }
    }

    /// Wartet, bis der Projektkatalog geladen ist (nötig für eindeutige Labels und den Bildpfad).
    func waitForCatalog() async {
        await catalogTask?.value
    }

    private func reloadCatalog(files: [URL], mainFile: URL?) {
        catalogTask?.cancel()
        catalogTask = Task {
            let (scanned, bibliography) = await Task.detached(priority: .userInitiated) {
                let mainText = mainFile.flatMap { try? String(contentsOf: $0, encoding: .utf8) }
                return (ProjectCatalog.scan(files: files, mainFile: mainFile),
                        BibliographyFile.target(mainFile: mainFile, mainText: mainText, projectFiles: files))
            }.value
            guard !Task.isCancelled else { return }
            catalog = scanned
            bibliographyFile = bibliography
            if reference.label.isEmpty { reference.label = scanned.labels.first?.label ?? "" }
        }
    }

    // MARK: Ergebnis

    /// Label für den aktuellen Baustein: eigener Wert oder automatisch aus der Beschriftung.
    func resolvedLabel(for kind: InsertionKind) -> String {
        guard let prefix = kind.labelPrefix else { return "" }
        let (caption, override): (String, String) = switch kind {
        case .table: (table.caption, table.labelOverride)
        case .image: (image.caption, image.labelOverride)
        case .code: (code.caption, code.labelOverride)
        case .equation: ("", equation.labelOverride)
        default: ("", "")
        }
        let custom = override.trimmingCharacters(in: .whitespaces)
        if !custom.isEmpty { return custom }
        // Automatisch nur aus einer Beschriftung; ohne Beschriftung gibt es kein Label.
        guard !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        return LabelNaming.label(prefix: prefix, caption: caption, fallback: Self.missingLabelFallback[prefix] ?? "x",
                                 existing: catalog.labelNames)
    }

    /// Was `\includegraphics` für die gewählte Datei erhält (vor dem Kopieren geschätzt).
    var imageReference: String {
        guard let file = image.file else { return "bild.png" }
        guard let projectRoot else { return file.lastPathComponent }
        let target = isInsideProject(file) ? file : projectRoot.appendingPathComponent(ImageImport.directoryName)
            .appendingPathComponent(ImageImport.sanitizedName(file.lastPathComponent))
        return GraphicsReference.path(for: target, projectRoot: projectRoot, graphicsDirectories: catalog.graphicsDirectories)
    }

    func isInsideProject(_ url: URL) -> Bool {
        guard let projectRoot else { return false }
        return url.standardizedFileURL.path.hasPrefix(projectRoot.standardizedFileURL.path + "/")
    }

    /// Vorschau des Codes mit den aktuellen Einstellungen. Bei „Quelle“ der neue Eintrag der Literaturdatei.
    var preview: String {
        guard kind == .source else { return generate(imageReference: imageReference) }
        switch sourceDraft {
        case let .success(draft):
            let cite = source.citeAfterInsert ? "\n% Im Text: " + InsertionGenerator.citation(sourceCitation(for: draft)) : ""
            return draft.entry + cite
        case let .failure(problem): return "% " + problem.message
        }
    }

    // MARK: Quelle

    var sourceDraft: Result<SourceDraft, SourceProblem> {
        SourceBuilder.draft(from: source, existingKeys: Set(catalog.bibEntries.map(\.key)))
    }

    func sourceCitation(for draft: SourceDraft) -> CitationSettings {
        CitationSettings(keys: [draft.key], note: source.note)
    }

    func generate(imageReference reference: String) -> String {
        switch kind {
        case .table: InsertionGenerator.table(table, label: resolvedLabel(for: .table))
        case .image: InsertionGenerator.image(image, reference: reference, label: resolvedLabel(for: .image))
        case .code: InsertionGenerator.code(code, label: resolvedLabel(for: .code))
        case .equation: InsertionGenerator.equation(equation, label: resolvedLabel(for: .equation))
        case .list: InsertionGenerator.list(list)
        case .reference: InsertionGenerator.reference(self.reference)
        case .citation: InsertionGenerator.citation(citation)
        case .source:
            if case let .success(draft) = sourceDraft, source.citeAfterInsert {
                InsertionGenerator.citation(sourceCitation(for: draft))
            } else {
                ""
            }
        }
    }

    /// Ob der Baustein mit den aktuellen Einstellungen eingefügt werden kann (Hinweistext sonst).
    var validationMessage: String? {
        switch kind {
        case .image where image.file == nil: "Bitte ein Bild wählen."
        case .reference where reference.label.isEmpty: "Im Projekt wurden keine Labels gefunden."
        case .citation where citation.keys.isEmpty: "Bitte mindestens einen Literatureintrag wählen."
        case .source where bibliographyFile == nil: "Keine Literaturdatei (.bib) im Projekt gefunden."
        case .source: if case let .failure(problem) = sourceDraft { problem.message } else { nil }
        default: nil
        }
    }

    /// Warum der Baustein gerade nicht eingefügt werden kann, `nil` wenn es geht. Eine neue Quelle braucht
    /// keine .tex-Datei (sie kommt in die .bib), nur das gleichzeitige Zitieren.
    func blocker(canInsertIntoEditor: Bool) -> String? {
        if let validationMessage { return validationMessage }
        guard !canInsertIntoEditor else { return nil }
        guard kind == .source else { return Self.needsTeXMessage }
        return source.citeAfterInsert ? Self.citeNeedsTeXMessage : nil
    }

    // MARK: Einfügen vorbereiten

    /// Bei Bildern außerhalb des Projekts: kopiert nach `images/` und liefert den Pfad für `\includegraphics`.
    func prepareImageReference() throws -> String {
        guard let file = image.file, let projectRoot else { return imageReference }
        guard ImageImport.isSupported(file) else { throw ImageImportError.unsupportedFormat(file.lastPathComponent) }
        guard !isInsideProject(file) else {
            return GraphicsReference.path(for: file, projectRoot: projectRoot, graphicsDirectories: catalog.graphicsDirectories)
        }
        let imported = try ImageImport.importImage(
            from: file, into: projectRoot.appendingPathComponent(ImageImport.directoryName)
        )
        return GraphicsReference.path(for: imported, projectRoot: projectRoot, graphicsDirectories: catalog.graphicsDirectories)
    }
}
