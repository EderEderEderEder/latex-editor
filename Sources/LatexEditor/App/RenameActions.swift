import AppKit

/// Eingabe für „Umbenennen …“
struct RenamePrompt: Identifiable, Equatable {
    let id = UUID()
    let scope: RenameScope
}

/// „Umbenennen …“ (⌥⌘R, Rechtsklick) für Labels, Quellen, Abkürzungen, eigene Befehle und Umgebungen. Wie das
/// Ersetzen nur als ungespeicherte, rückgängig machbare Änderung in Tabs, nie direkt auf der Platte.
extension AppModel {
    // MARK: Dialog öffnen

    /// Menü ohne `scope`: was unter dem Cursor steht; Kontextmenü mit der gewählten Möglichkeit.
    func beginRename(_ scope: RenameScope? = nil) {
        guard project.rootURL != nil else { return }
        guard let found = scope ?? renameScopesAtCursor().first else {
            editor.errorMessage = "Den Cursor in ein Label, einen Literaturschlüssel, eine Abkürzung, einen eigenen Befehl "
                + "oder ein \\begin{…}/\\end{…} setzen, dann umbenennen."
            return
        }
        fileActions.rename = RenamePrompt(scope: found)
    }

    private func renameScopesAtCursor() -> [RenameScope] {
        guard let session = editor.current, let location = editor.cursorLocation() else { return [] }
        return renameScopes(at: location, in: session)
    }

    /// Was an der Stelle umbenannt werden kann. Befehle und Umgebungen projektweit nur, wenn sie in den .tex-Dateien
    /// des Projekts definiert sind (nie `\section` oder Befehle der Vorlage).
    func renameScopes(at location: Int, in session: DocumentSession) -> [RenameScope] {
        let index = completionProvider.index
        let text = session.textStorage.mutableString
        let isBibliography = FileKind(url: session.url) == .bib
        return Renamer.candidates(at: location, in: text, isBibliography: isBibliography).compactMap { candidate in
            switch candidate {
            case let .pair(pair):
                return .pair(session.url, pair)
            case let .project(subject):
                switch subject.kind {
                case .command: return index.projectCommands.contains(subject.name) ? .project(subject) : nil
                case .environment: return index.projectEnvironments.contains(subject.name) ? .project(subject) : nil
                case .label, .citation, .acronym: return .project(subject)
                }
            }
        }
    }

    // MARK: Prüfen und Zählen

    /// Schon vergebene Namen dieser Art. Ein Umgebungspaar darf jeden Namen bekommen (`itemize` → `enumerate`).
    func existingNames(for scope: RenameScope) -> Set<String> {
        guard case let .project(subject) = scope else { return [] }
        let index = completionProvider.index
        switch subject.kind {
        case .label: return Set(completionProvider.allLabels().map(\.label))
        case .citation: return Set(index.catalog.bibEntries.map(\.key))
        case .acronym: return index.acronyms
        case .command: return Set(index.userCommands).union(CommandCatalog.commands.map(\.text))
        case .environment: return Set(index.environments).union(CommandCatalog.environments)
        }
    }

    func renameProblem(_ newName: String, for scope: RenameScope) -> String? {
        Renamer.validate(newName, kind: scope.kind, old: scope.oldName, existing: existingNames(for: scope))
    }

    /// „5 Stellen in 3 Dateien“ bzw. die Zeilen des Paars, für den Dialog; liest die Dateien im Hintergrund.
    func renameSummary(for scope: RenameScope) async -> String {
        switch scope {
        case let .pair(url, pair):
            guard let lines = editor.session(for: url)?.lineIndex else { return "" }
            let begin = lines.clampedLine(containing: pair.begin.location) + 1
            let end = lines.clampedLine(containing: pair.end.location) + 1
            return "\\begin in Zeile \(begin), \\end in Zeile \(end)"
        case let .project(subject):
            let found = await occurrenceCounts(of: subject)
            let count = found.values.reduce(0, +)
            return count == 0 ? "Keine Vorkommen gefunden." : Self.placesText(count, files: found.count)
        }
    }

    private static func placesText(_ count: Int, files: Int) -> String {
        "\(count) \(count == 1 ? "Stelle" : "Stellen") in \(files) \(files == 1 ? "Datei" : "Dateien")"
    }

    /// Offene Dateien mit ihrem ungespeicherten Text, andere von der Platte (.tex und .bib)
    private func occurrenceCounts(of subject: RenameSubject) async -> [URL: Int] {
        let sources = searchSources()
        return await Task.detached(priority: .userInitiated) {
            var result: [URL: Int] = [:]
            for source in sources {
                let (url, text): (URL, String)
                switch source {
                case let .text(sourceURL, sourceText): (url, text) = (sourceURL, sourceText)
                case let .file(sourceURL):
                    guard let data = try? Data(contentsOf: sourceURL), let sourceText = String(data: data, encoding: .utf8) else { continue }
                    (url, text) = (sourceURL, sourceText)
                }
                let count = Renamer.occurrences(of: subject, in: text, isBibliography: FileKind(url: url) == .bib).count
                if count > 0 { result[url] = count }
            }
            return result
        }.value
    }

    // MARK: Ausführen

    func rename(_ scope: RenameScope, to rawName: String) async {
        guard renameProblem(rawName, for: scope) == nil else { return }
        let newName = Renamer.normalized(rawName, kind: scope.kind)
        switch scope {
        case let .pair(url, pair): renamePair(pair, in: url, to: newName)
        case let .project(subject): await renameInProject(subject, to: newName)
        }
    }

    /// Nur `\begin` und das passende `\end`; das Paar wird frisch bestimmt, weil sich der Text seit dem Dialog geändert haben kann.
    private func renamePair(_ pair: EnvironmentPair, in url: URL, to newName: String) {
        guard let session = editor.session(for: url) else { return }
        let text = session.textStorage.mutableString
        guard let current = EnvironmentNames.pair(at: pair.begin.location, in: text), current.name == pair.name else {
            fileActions.notice = "Die Umgebung „\(pair.name)“ steht nicht mehr an dieser Stelle. Bitte erneut umbenennen."
            return
        }
        session.replaceText(with: Renamer.apply([current.begin, current.end], newName: newName, to: text as String),
                            actionName: "Umgebung umbenennen")
    }

    private func renameInProject(_ subject: RenameSubject, to newName: String) async {
        let files = await occurrenceCounts(of: subject).keys.sorted { $0.path < $1.path }
        let previouslyActive = editor.tabs.active
        var changed = 0
        var places = 0
        for url in files {
            await editor.open(url, asPreview: false)
            guard let session = editor.session(for: url) else { continue }
            // Frisch aus dem Sitzungstext: Er kann sich seit dem Zählen geändert haben
            let text = session.textStorage.string
            let ranges = Renamer.occurrences(of: subject, in: text, isBibliography: FileKind(url: url) == .bib)
            guard !ranges.isEmpty else { continue }
            session.replaceText(with: Renamer.apply(ranges, newName: newName, to: text), actionName: "\(subject.kindName) umbenennen")
            changed += 1
            places += ranges.count
        }
        if let previouslyActive { editor.activateTab(previouslyActive) }
        let shown = RenameSubject(kind: subject.kind, name: newName).displayName.replacingOccurrences(of: subject.kindName + " ", with: "")
        fileActions.notice = places == 0
            ? "\(subject.displayName) wurde nirgends gefunden."
            : "\(subject.displayName) → \(shown): \(Self.placesText(places, files: changed)) geändert. "
                + "Noch nicht gespeichert: ⌘S speichert, ⌘Z nimmt zurück."
    }
}
