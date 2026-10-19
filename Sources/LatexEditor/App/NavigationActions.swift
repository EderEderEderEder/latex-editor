import AppKit

/// Eingabe für „Label umbenennen“.
struct LabelRenamePrompt: Identifiable, Equatable {
    let id = UUID()
    let oldKey: String
}

/// ⌘-Klick auf Verweise, Zitate und Dateipfade sowie „Label umbenennen“ auf App-Ebene.
extension AppModel {
    /// Springt zum Ziel eines ⌘-Klicks. Gibt es das Ziel nicht (Tippfehler im Schlüssel), piept es.
    func jump(to target: JumpTarget) {
        switch target {
        case let .label(key):
            guard let entry = completionProvider.allLabels().first(where: { $0.label == key }) else { return NSSound.beep() }
            Task { await editor.open(entry.file, line: entry.line) }
        case let .citation(key):
            guard let entry = completionProvider.index.catalog.bibEntries.first(where: { $0.key == key }), let file = entry.file else {
                return NSSound.beep()
            }
            Task { await editor.open(file, line: entry.line) }
        case let .file(path):
            let bases = [project.mainFileURL?.deletingLastPathComponent(), editor.current?.url.deletingLastPathComponent()].compactMap { $0 }
            guard let file = JumpTargetFinder.resolveFile(path, bases: bases) else { return NSSound.beep() }
            Task { await editor.open(file) }
        }
    }

    // MARK: Label umbenennen

    /// Menü (⌥⌘R) bzw. Kontextmenü im Editor. Ohne `key` zählt das Label an der Cursorposition.
    func beginLabelRename(key: String? = nil) {
        guard project.rootURL != nil else { return }
        guard let found = key ?? labelAtCursor() else {
            editor.errorMessage = "Den Cursor in ein \\label{…} oder in einen Verweis wie \\ref{…} setzen, dann umbenennen."
            return
        }
        fileActions.labelRename = LabelRenamePrompt(oldKey: found)
    }

    private func labelAtCursor() -> String? {
        guard let session = editor.current, let location = editor.cursorLocation() else { return nil }
        return JumpTargetFinder.label(at: location, in: session.textStorage.mutableString)
    }

    /// „5 Stellen in 3 Dateien“ für den Dialog; liest die Dateien im Hintergrund.
    func labelRenameSummary(for key: String) async -> String {
        let found = await labelOccurrences(of: key)
        let count = found.values.reduce(0) { $0 + $1 }
        guard count > 0 else { return "Keine Vorkommen gefunden." }
        return "\(count) \(count == 1 ? "Stelle" : "Stellen") in \(found.count) \(found.count == 1 ? "Datei" : "Dateien")"
    }

    private func labelOccurrences(of key: String) async -> [URL: Int] {
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
                let count = LabelRenamer.occurrences(of: key, in: text).count
                if count > 0 { result[url] = count }
            }
            return result
        }.value
    }

    /// Benennt das Label in allen Dateien um. Wie das Ersetzen nur als ungespeicherte, rückgängig machbare Änderung in Tabs.
    func renameLabel(_ old: String, to rawNew: String) async {
        let new = rawNew.trimmingCharacters(in: .whitespacesAndNewlines)
        let existing = Set(completionProvider.allLabels().map(\.label))
        guard LabelRenamer.validate(new, old: old, existing: existing) == nil else { return }
        let files = await labelOccurrences(of: old).keys.sorted { $0.path < $1.path }
        let previouslyActive = editor.tabs.active
        var changed = 0
        var places = 0
        for url in files {
            await editor.open(url, asPreview: false)
            guard let session = editor.session(for: url) else { continue }
            // Frisch aus dem Sitzungstext: Er kann sich seit dem Zählen geändert haben
            let text = session.textStorage.string
            let ranges = LabelRenamer.occurrences(of: old, in: text)
            guard !ranges.isEmpty else { continue }
            session.replaceText(with: LabelRenamer.apply(ranges, newKey: new, to: text), actionName: "Label umbenennen")
            changed += 1
            places += ranges.count
        }
        if let previouslyActive { editor.activateTab(previouslyActive) }
        fileActions.notice = places == 0
            ? "Das Label „\(old)“ wurde nirgends gefunden."
            : "Label „\(old)“ → „\(new)“: \(places) \(places == 1 ? "Stelle" : "Stellen") in \(changed) \(changed == 1 ? "Datei" : "Dateien") "
                + "geändert. Noch nicht gespeichert: ⌘S speichert, ⌘Z nimmt zurück."
    }
}
