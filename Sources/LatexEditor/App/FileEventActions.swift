import AppKit

/// Dateisystem-Ereignisse (FSEvents) auf App-Ebene verteilen: Baum, Gliederung, Index, offene Dateien, PDF, Git.
extension AppModel {
    func refreshGitIfNeeded(for events: [FileEvent]) {
        // Nicht `contains`: jedes Ereignis zählt, weil `registerChange` sich geänderte Refs merkt.
        let relevant = events.reduce(false) { found, event in git.registerChange(atPath: event.path) || found }
        if relevant { git.scheduleRefresh() }
    }

    func handle(_ events: [FileEvent], root: URL) {
        refreshGitIfNeeded(for: events)
        var needsTreeReload = false
        var needsOutlineRefresh = false
        var needsPDFRefresh = false
        var deletedFiles: [URL] = []
        var changedFiles: [URL] = []
        var needsCompletionReload = false

        for event in events {
            guard !Self.isHidden(path: event.path, root: root) else { continue }
            let url = URL(fileURLWithPath: event.path)
            if pdf.isPDFCandidate(path: url.standardizedFileURL.path) { needsPDFRefresh = true }
            if project.isTreeChange(event) { needsTreeReload = true }
            if FileKind(url: url) == .tex { needsOutlineRefresh = true }
            if FileKind(url: url) == .bib { needsCompletionReload = true }
            guard FileKind(url: url).isEditable else { continue }
            if !FileManager.default.fileExists(atPath: url.path) {
                if event.isStructuralChange { deletedFiles.append(url) }
            } else if editor.session(for: url) != nil {
                changedFiles.append(url)
            }
        }
        handleDeletedFiles(deletedFiles)
        // Eigene Speichervorgänge erkennt die Sitzung am Inhalt und lädt dann nicht neu.
        if !changedFiles.isEmpty { Task { await editor.syncWithDisk(changedFiles) } }
        if needsTreeReload { project.reloadTree() }
        if needsOutlineRefresh || needsTreeReload {
            refreshOutline()
            wordCounts.refreshProject()
        }
        if needsOutlineRefresh || needsCompletionReload || needsTreeReload { refreshSearchResults() }
        if needsOutlineRefresh || needsTreeReload || needsCompletionReload { Task { await reloadCompletionIndex() } }
        if needsPDFRefresh, !build.isRunning { reloadBuildOutputs() }
    }

    /// Gelöschte Dateien schließen ihren Tab. Bleibt kein Tab übrig, öffnet die Hauptdatei (falls vorhanden).
    func handleDeletedFiles(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        for url in urls { editor.handleDeletedFile(url) }
        guard editor.tabs.isEmpty, let main = project.mainFileURL,
              FileManager.default.fileExists(atPath: main.path) else { return }
        Task { await editor.open(main, asPreview: false) }
    }

    /// Die Trefferliste soll nach Speichern und Dateiänderungen nicht veraltet stehen bleiben.
    func refreshSearchResults() {
        if !search.query.isEmpty { search.scheduleSearch() }
    }

    func refreshOutline() {
        outline.refresh(mainFile: project.mainFileURL)
    }

    static func isHidden(path: String, root: URL) -> Bool {
        guard path.hasPrefix(root.path) else { return false }
        return path.dropFirst(root.path.count).split(separator: "/").contains { $0.hasPrefix(".") }
    }
}
