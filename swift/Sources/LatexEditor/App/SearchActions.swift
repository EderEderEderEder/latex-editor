import AppKit

/// Projektweite Suche und Ersetzen auf App-Ebene. Ersetzt wird **nie direkt auf der Platte**: Die Texte landen als
/// ungespeicherte, rückgängig machbare Änderungen in den (dafür geöffneten) Tabs; erst ⌘S schreibt.
extension AppModel {
    /// ⇧⌘F: Ansicht „Suchen“ zeigen, markierten Text (eine Zeile) als Suchbegriff übernehmen.
    func presentProjectSearch() {
        guard project.rootURL != nil else { return }
        let selection = editor.selectedText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !selection.isEmpty, !selection.contains("\n"), selection.count <= Self.maximumPrefilledQueryLength {
            search.query = selection
        }
        sidebar.tab = .search
        search.requestFocus()
    }

    func openHit(_ hit: SearchHit) {
        Task { await editor.open(hit.file, line: hit.line) }
    }

    func replaceAllHits() async {
        await replace(search.result.hits)
    }

    /// Ersetzt die Treffer durch `search.replacement`. Bei mehreren Treffern fragt die App vorher nach.
    func replace(_ hits: [SearchHit]) async {
        guard !hits.isEmpty else { return }
        let byFile = Dictionary(grouping: hits, by: { $0.file.standardizedFileURL })
        if hits.count > 1, !confirmReplace(hits.count, byFile.count, search.replacement) { return }
        let previouslyActive = editor.tabs.active
        var applied = 0
        var changedFiles = 0
        for (url, fileHits) in byFile.sorted(by: { $0.key.path < $1.key.path }) {
            await editor.open(url, asPreview: false)
            guard let session = editor.session(for: url) else { continue }
            let outcome = ProjectSearch.replace(fileHits, with: search.replacement, in: session.textStorage.string)
            guard outcome.applied > 0 else { continue }
            session.replaceText(with: outcome.text, actionName: "Ersetzen")
            applied += outcome.applied
            changedFiles += 1
        }
        if let previouslyActive { editor.activateTab(previouslyActive) }
        search.notice = Self.replacementNotice(applied: applied, files: changedFiles, requested: hits.count)
        search.scheduleSearch(immediately: true)
    }

    static func replacementNotice(applied: Int, files: Int, requested: Int) -> String {
        guard applied > 0 else { return "Nichts ersetzt: Der Text hat sich seit der Suche geändert." }
        var text = applied == 1 ? "1 Ersetzung" : "\(applied) Ersetzungen"
        text += files == 1 ? " in 1 Datei." : " in \(files) Dateien."
        if applied < requested { text += " \(requested - applied) übersprungen (Text hat sich geändert)." }
        return text + " Noch nicht gespeichert: ⌘S speichert, ⌘Z nimmt zurück."
    }

    static func showReplaceAlert(hitCount: Int, fileCount: Int, replacement: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = "\(hitCount) Treffer in \(fileCount) \(fileCount == 1 ? "Datei" : "Dateien") ersetzen?"
        alert.informativeText = replacement.isEmpty
            ? "Die Treffer werden gelöscht. "
            : "Ersetzt durch „\(replacement)“. "
        alert.informativeText += "Die Dateien werden als Tabs geöffnet. Die Änderungen sind noch nicht gespeichert "
            + "und lassen sich mit ⌘Z zurücknehmen."
        alert.addButton(withTitle: "Ersetzen")
        alert.addButton(withTitle: "Abbrechen")
        return alert.runModal() == .alertFirstButtonReturn
    }

    /// Quellen für die Suche: alle Texte und Literaturdateien des Projekts, offene aus dem Editor.
    func searchSources() -> [SearchSource] {
        guard let tree = project.tree else { return [] }
        return tree.collectFiles().map(\.url).filter { FileKind(url: $0).isEditable }.map { url in
            if let session = editor.session(for: url) { return .text(url.standardizedFileURL, session.textStorage.string) }
            return .file(url.standardizedFileURL)
        }
    }
}
