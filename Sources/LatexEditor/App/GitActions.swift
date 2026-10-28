import AppKit

/// Git auf App-Ebene: Abläufe, die Editor und Git verbinden (Speichern vor dem Commit, Datei öffnen).
extension AppModel {
    /// Commit-Button (⌘↩): fragt bei ungespeicherten Dateien nach; ist nichts bereitgestellt,
    /// werden nach Rückfrage alle Änderungen im Projekt committet.
    func commitChanges() async {
        guard git.isReady, !git.isBusy else { return }
        guard !git.trimmedCommitMessage.isEmpty else {
            git.errorMessage = "Bitte eine Commit-Nachricht eingeben."
            return
        }
        guard saveBeforeGitOperation("dem Commit") else { return }
        // Gerade gespeicherte Dateien erscheinen erst in einem neuen Status.
        await git.refresh()
        let stagingAll = git.staged.isEmpty
        if stagingAll {
            guard git.hasChanges else {
                git.errorMessage = "Es gibt nichts zu committen."
                return
            }
            guard confirmCommitAll(git.changeCount) else { return }
        }
        await git.commit(stagingAll: stagingAll)
    }

    /// `false`: Vorgang abbrechen. `occasion` z. B. „dem Commit“.
    private func saveBeforeGitOperation(_ occasion: String) -> Bool {
        let dirty = editor.dirtySessions
        guard !dirty.isEmpty else { return true }
        let title = dirty.count == 1
            ? "„\(dirty[0].url.lastPathComponent)“ vor \(occasion) speichern?"
            : "\(dirty.count) Dateien vor \(occasion) speichern?"
        switch promptForUnsavedChanges(title, dirty.map(\.url.lastPathComponent)) {
        case .save: return editor.saveAll()
        case .discard: return true
        case .cancel: return false
        }
    }

    /// Öffnet die Änderungen der Datei als Diff-Tab (Einfachklick: Vorschau-Tab, `keep`: fester Tab).
    func showChange(_ change: GitChange, keep: Bool = false) {
        guard let url = git.url(for: change) else { return }
        git.prepareDiff(for: change)
        editor.openDiff(url, asPreview: !keep)
    }

    /// Öffnet die Datei einer Änderung als festen Tab neben dem Diff.
    func openChangedFile(_ change: GitChange) {
        guard let url = git.url(for: change), FileManager.default.fileExists(atPath: url.path) else { return }
        if FileKind(url: url).isEditable {
            Task { await editor.open(url, asPreview: false) }
        } else {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: Remote und Branches

    func fetchFromRemote() async {
        await git.fetch()
    }

    /// Pull ändert Dateien: vorher speichern (Nachfrage), danach offene Dateien, Baum und Gliederung abgleichen.
    func pullFromRemote() async {
        guard saveBeforeGitOperation("dem Pull") else { return }
        guard await git.pull() else { return }
        await workingTreeDidChange()
    }

    func pushToRemote() async {
        await git.push()
    }

    func switchBranch(to name: String) async {
        guard name != git.branch.head, saveBeforeGitOperation("dem Branch-Wechsel") else { return }
        guard await git.switchBranch(to: name) else { return }
        await workingTreeDidChange()
    }

    func createBranch(named name: String) async {
        await git.createBranch(named: name)
    }

    /// Nach Pull, Branch-Wechsel oder Verwerfen: nicht auf FSEvents warten, damit kein Editor kurz einen alten Stand zeigt.
    private func workingTreeDidChange(discarding urls: [URL] = []) async {
        if !urls.isEmpty { await editor.syncWithDisk(urls, discardingChanges: true) }
        handleDeletedFiles(await editor.syncWithDisk())
        project.reloadTree()
        refreshOutline()
    }

    // MARK: Zurücksetzen

    /// Setzt die Dateien dieser Änderungen auf den Stand des letzten Commits zurück, bereitgestellt oder
    /// nicht, in einem Schritt. Vorher: Rückfrage mit dem, was verloren ginge; Sicherungskopie (auch des
    /// ungespeicherten Editortexts) im Papierkorb. Danach lässt es sich im Änderungen-Tab rückgängig machen.
    func resetToLastCommit(_ changes: [GitChange]) async {
        let plan = GitResetPlan.make(for: changes, hasCommits: git.branch.hasCommits)
        let restoreURLs = plan.restorePaths.compactMap { git.url(forRepositoryPath: $0) }
        let newURLs = plan.newPaths.compactMap { git.url(forRepositoryPath: $0) }
        guard !plan.isEmpty, restoreURLs.count + newURLs.count == plan.allPaths.count, !git.isBusy else { return }
        let snapshot = await makeSnapshot(of: restoreURLs + newURLs)
        let details = await resetDetails(snapshot, newFiles: Set(newURLs))
        let names = snapshot.entries.map(\.url.lastPathComponent)
        let question = names.count == 1
            ? "„\(names[0])“ auf den letzten Commit zurücksetzen?"
            : "\(names.count) Dateien auf den letzten Commit zurücksetzen?"
        guard confirmReset(question, details) else { return }
        let diffTabsToReplace = restoreURLs.filter { editor.tabs.contains(.diff($0)) }
        do {
            try backUp(snapshot, newFiles: Set(newURLs))
            for url in newURLs where FileManager.default.fileExists(atPath: url.path) {
                editor.closeTabs(under: url)
                _ = try moveToTrash(url)
            }
        } catch {
            git.errorMessage = "Zurücksetzen abgebrochen, der Papierkorb ist nicht erreichbar: \(error.localizedDescription)"
            return
        }
        guard await git.resetToHead(plan) else { return }
        git.lastReset = snapshot
        await workingTreeDidChange(discarding: restoreURLs)
        // Der Diff-Tab schließt (keine Änderungen mehr); die Datei bleibt sichtbar, statt zu „verschwinden“.
        for url in diffTabsToReplace where FileManager.default.fileExists(atPath: url.path) {
            await editor.open(url, asPreview: false)
        }
        sidebar.tab = .changes
    }

    /// Alle Änderungen einer Datei zurücksetzen (Dateibaum, Diff-Tab).
    func resetToLastCommit(file url: URL) async {
        await resetToLastCommit(git.changes(for: url))
    }

    /// Stellt den Stand vor dem letzten Zurücksetzen wieder her (Inhalte, auch damals ungespeicherten
    /// Editortext; Bereitstellungen nicht).
    func undoLastReset() async {
        guard let snapshot = git.lastReset else { return }
        do {
            for entry in snapshot.entries {
                if let contents = entry.contents {
                    try FileManager.default.createDirectory(at: entry.url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try contents.write(to: entry.url, options: .atomic)
                } else if FileManager.default.fileExists(atPath: entry.url.path) {
                    try FileManager.default.removeItem(at: entry.url)
                }
            }
        } catch {
            git.errorMessage = "Rückgängig machen fehlgeschlagen: \(error.localizedDescription)"
            return
        }
        git.lastReset = nil
        await workingTreeDidChange(discarding: snapshot.entries.map(\.url))
        for entry in snapshot.entries where entry.wasOpen && FileManager.default.fileExists(atPath: entry.url.path) {
            await editor.open(entry.url, asPreview: false)
        }
        await git.refresh()
    }

    /// Inhalt vor dem Zurücksetzen: ungespeicherter Editortext hat Vorrang vor der Platte (gelesen im Hintergrund).
    private func makeSnapshot(of urls: [URL]) async -> ResetSnapshot {
        var unsaved: [URL: Data] = [:]
        for url in urls {
            if let session = editor.session(for: url), session.isDirty { unsaved[url] = session.currentData() }
        }
        let fromEditor = unsaved
        let onDisk: [URL: Data] = await Task.detached(priority: .userInitiated) {
            var result: [URL: Data] = [:]
            for url in urls where fromEditor[url] == nil { result[url] = try? Data(contentsOf: url) }
            return result
        }.value
        return ResetSnapshot(entries: urls.map { url in
            let contents = unsaved[url] ?? onDisk[url] ?? editor.session(for: url)?.currentData()
            return ResetSnapshot.Entry(url: url, contents: contents, wasOpen: editor.tabs.contains(url))
        })
    }

    /// Eine Zeile pro Datei: was sich gegenüber dem letzten Commit ändert.
    private func resetDetails(_ snapshot: ResetSnapshot, newFiles: Set<URL>) async -> [String] {
        var lines: [String] = []
        for entry in snapshot.entries {
            let name = entry.url.lastPathComponent
            if newFiles.contains(entry.url) {
                lines.append("\(name): neue Datei, kommt in den Papierkorb")
                continue
            }
            guard let contents = entry.contents else {
                lines.append("\(name): wird wiederhergestellt")
                continue
            }
            let head = await git.headContents(of: entry.url) ?? Data()
            let diff = FileDiff.make(old: head, new: contents, isBinaryKind: FileKind(url: entry.url) == .image)
            lines.append("\(name): \(Self.lossDescription(diff))")
        }
        return lines
    }

    static func lossDescription(_ diff: FileDiff) -> String {
        guard diff.content != .binary else { return "Binärdatei, Änderungen gehen verloren" }
        switch diff.addedCount + diff.removedCount {
        case 0: return "keine inhaltliche Änderung"
        case 1: return "1 geänderte Zeile geht verloren"
        case let count: return "\(count) geänderte Zeilen gehen verloren"
        }
    }

    /// Sicherungskopie „name (verworfen …).tex“ im Papierkorb – für geänderte Dateien immer, für neue Dateien
    /// nur, wenn der Editor ungespeicherten Text hat (die Datei selbst kommt ohnehin in den Papierkorb).
    private func backUp(_ snapshot: ResetSnapshot, newFiles: Set<URL>) throws {
        for entry in snapshot.entries {
            guard let contents = entry.contents else { continue }
            if newFiles.contains(entry.url), (try? Data(contentsOf: entry.url)) == contents { continue }
            try moveCopyToTrash(contents, named: Self.discardedName(for: entry.url, at: Date()))
        }
    }

    private func moveCopyToTrash(_ contents: Data, named name: String) throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Verworfen-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let copy = folder.appendingPathComponent(name)
        try contents.write(to: copy)
        _ = try moveToTrash(copy)
    }

    static func discardedName(for url: URL, at date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_AT")
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        let base = url.deletingPathExtension().lastPathComponent
        let fileExtension = url.pathExtension.isEmpty ? "" : "." + url.pathExtension
        return "\(base) (verworfen \(formatter.string(from: date)))\(fileExtension)"
    }

    static func showResetAlert(title: String, details: [String]) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = details.joined(separator: "\n") + "\n\n"
            + "Die Dateien bekommen den Stand des letzten Commits, auch Bereitgestelltes wird zurückgenommen. "
            + "Eine Sicherungskopie (mit ungespeichertem Text) kommt in den Papierkorb, und direkt danach "
            + "lässt sich das Zurücksetzen im Änderungen-Tab rückgängig machen."
        alert.addButton(withTitle: "Zurücksetzen")
        alert.addButton(withTitle: "Abbrechen")
        return alert.runModal() == .alertFirstButtonReturn
    }

    static func showCommitAllAlert(fileCount: Int) -> Bool {
        let alert = NSAlert()
        alert.messageText = "Nichts bereitgestellt"
        alert.informativeText = fileCount == 1
            ? "Die geänderte Datei bereitstellen und committen?"
            : "Alle \(fileCount) geänderten Dateien bereitstellen und committen?"
        alert.addButton(withTitle: "Alle committen")
        alert.addButton(withTitle: "Abbrechen")
        return alert.runModal() == .alertFirstButtonReturn
    }
}
