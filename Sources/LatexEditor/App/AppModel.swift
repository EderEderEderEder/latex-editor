import AppKit

/// Antwort auf die Nachfrage bei ungespeicherten Änderungen.
enum UnsavedChoice {
    case save
    case discard
    case cancel
}

/// Antwort auf die Frage, ob Verweise auf eine umbenannte oder verschobene Datei angepasst werden sollen.
enum ReferenceUpdateChoice {
    case update
    case skip
    case cancel
}

/// Verbindet die einzelnen Stores. Die Stores sind getrennt beobachtbar,
/// damit Änderungen nur die betroffenen Views neu zeichnen.
@MainActor
final class AppModel {
    /// Die App nutzt genau diese Instanz. Eine eigene (`AppModel()`) baut sich vollständig auf und in `deinit` wieder ab
    /// (Beobachter, Dateiüberwachung) – so können künftige Tests ohne das gemeinsame Modell und ohne `AppModelSuite` laufen.
    static let shared = AppModel()

    let project = ProjectStore()
    let editor = EditorStore()
    let outline = OutlineStore()
    let pdf = PDFPreviewStore()
    let build = BuildStore()
    let sidebar = SidebarStore()
    let recentProjects = RecentProjectsStore()
    let synctex = SyncTeXStore()
    let insertion = InsertStore()
    let fileActions = FileActionStore()
    let git = GitStore()
    let changeMarks = ChangeMarkStore()
    let completionProvider = CompletionProvider()
    let recovery = RecoveryStore()
    let palette = PaletteStore()
    let wordCounts = WordCountStore()
    let search = SearchStore()
    let referenceChecks = ReferenceCheckStore()

    private static let lastProjectKey = "lastProjectPath"
    /// Einstellung „Beim Verlassen der App speichern“ (Menü Ablage, Standard aus)
    static let saveOnDeactivateKey = "saveOnDeactivate"
    /// Längere Auswahl wird nicht als Suchbegriff übernommen
    static let maximumPrefilledQueryLength = 200

    /// `nonisolated(unsafe)`: nur auf dem Main-Thread gesetzt, in `deinit` gestoppt (gibt den Watcher frei)
    nonisolated(unsafe) private var watcher: FSEventsWatcher?
    /// Überwacht `.git`, wenn es außerhalb des Projektordners liegt (Projekt ist Unterordner eines Repositorys)
    nonisolated(unsafe) private var gitWatcher: FSEventsWatcher?
    nonisolated(unsafe) private var observers: [NSObjectProtocol] = []
    /// Verhindert, dass das Speichern vor einem Build über „Beim Speichern kompilieren“ einen zweiten Build anstößt.
    private var isSavingForBuild = false
    /// Während eines Projektwechsels sollen die Tabs des alten Projekts nicht überschrieben werden.
    private var isSwitchingProject = false
    /// Nachfragen und Papierkorb der Dateioperationen (in Tests ersetzbar, weil `NSAlert` modal blockiert
    /// und der echte Papierkorb des Nutzers nicht gefüllt werden soll).
    var confirmReferenceUpdate: @MainActor (_ edits: [ReferenceEdit], _ itemName: String) -> ReferenceUpdateChoice =
        AppModel.showReferenceUpdateAlert
    var confirmTrash: @MainActor (_ title: String, _ detail: String) -> Bool = AppModel.showTrashAlert
    var moveToTrash: @MainActor (URL) throws -> Void = { try FileManager.default.trashItem(at: $0, resultingItemURL: nil) }
    /// Nachfrage bei ungespeicherten Änderungen (in Tests ersetzbar, weil `NSAlert` modal blockiert).
    var promptForUnsavedChanges: @MainActor (_ title: String, _ names: [String]) -> UnsavedChoice = AppModel.showUnsavedChangesAlert
    /// Nachfrage, ob ohne Bereitgestelltes alle Änderungen committet werden sollen (in Tests ersetzbar)
    var confirmCommitAll: @MainActor (_ fileCount: Int) -> Bool = AppModel.showCommitAllAlert
    /// Nachfrage vor dem Zurücksetzen auf den letzten Commit (in Tests ersetzbar)
    var confirmReset: @MainActor (_ title: String, _ details: [String]) -> Bool = AppModel.showResetAlert
    /// Nachfrage vor dem Ersetzen mehrerer Treffer (in Tests ersetzbar)
    var confirmReplace: @MainActor (_ hitCount: Int, _ fileCount: Int, _ replacement: String) -> Bool = AppModel.showReplaceAlert
    /// Nachfrage vor dem Löschen der Hilfsdateien (in Tests ersetzbar)
    var confirmCleanup: @MainActor () -> Bool = AppModel.showCleanupAlert
    /// Nachfrage, ob gesicherte ungespeicherte Texte wiederhergestellt werden sollen (in Tests ersetzbar)
    var confirmRecovery: @MainActor (_ backups: [RecoveryBackup]) -> Bool = AppModel.showRecoveryAlert
    /// Zuletzt gemeldete Cursorposition (für ⌘J „Im PDF zeigen“)
    private var lastCursor: (file: URL, line: Int)?

    init() {
        editor.onDidSave = { [weak self] in self?.didSave() }
        editor.onCursorMoved = { [weak self] file, line in self?.cursorMoved(file: file, line: line) }
        editor.onTabsChanged = { [weak self] tabs in self?.tabsChanged(tabs) }
        // Ohne Änderungen (z. B. nach dem Commit) schließt der Diff-Tab.
        git.onDiffObsolete = { [weak self] url in self?.editor.closeTab(.diff(url)) }
        editor.onSessionTextChanged = { [weak self] session in
            self?.changeMarks.schedule(session)
            self?.recovery.schedule(session)
            self?.wordCounts.schedule(session)
            self?.referenceChecks.schedule(session)
        }
        // Hauptdatei und was sie einbindet; ohne Include-Struktur nur die Hauptdatei
        wordCounts.projectFiles = { [weak self] in
            guard let self, let main = project.mainFileURL else { return [] }
            return [main] + outline.includingFile.keys.filter { FileKind(url: $0) == .tex && $0 != main }
        }
        outline.onChanged = { [weak self] in self?.wordCounts.refreshProject() }
        search.sources = { [weak self] in self?.searchSources() ?? [] }
        referenceChecks.knownLabels = { [weak self] in self?.completionProvider.knownLabels() }
        referenceChecks.knownCitations = { [weak self] in self?.completionProvider.knownCitations() }
        completionProvider.onIndexChanged = { [weak self] in
            guard let self else { return }
            referenceChecks.indexChanged(completionProvider.index, isLoaded: completionProvider.hasIndex,
                                         openSessions: editor.openSessions)
        }
        completionProvider.unsavedDocuments = { [weak self] in
            self?.editor.dirtySessions.map { (url: $0.url, text: $0.textStorage.string) } ?? []
        }
        changeMarks.loadBase = { [weak self] url in await self?.git.headContents(of: url) }
        recovery.onWriteFailure = { [weak self] message in self?.fileActions.errorMessage = message }
        observeAppAndFont()
        git.onStatusApplied = { [weak self] in
            guard let self else { return }
            changeMarks.headChanged(to: git.branch.commit, openSessions: editor.openSessions)
        }
        // Während latexmk läuft, wird das PDF mehrfach geschrieben; neu geladen wird einmal danach.
        build.onFinished = { [weak self] in self?.reloadBuildOutputs() }
        pdf.onCommandClick = { [weak self] page, point in self?.showInEditor(page: page, point: point) }
    }

    /// Zoom (Schriftgröße) für alle offenen Dateien; Speichern beim Wechsel in eine andere App (falls eingestellt).
    private func observeAppAndFont() {
        InterfaceZoom.migrateLegacySetting()
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: EditorAppearance.fontDidChange, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.editor.applyEditorFont() }
        })
        observers.append(center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard UserDefaults.standard.bool(forKey: AppModel.saveOnDeactivateKey) else { return }
                self?.editor.saveAll()
            }
        })
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        watcher?.stop()
        gitWatcher?.stop()
    }

    // MARK: SyncTeX

    /// ⌘J: springt im PDF zur Cursorstelle und markiert sie kurz.
    func showCursorInPDF() {
        guard let current = editor.current else { return }
        let line = lastCursor.flatMap { $0.file == current.url ? $0.line : nil } ?? 1
        revealInPDF(file: current.url, line: line, mode: .explicit)
    }

    /// ⌘-Klick im Editor auf eine Stelle ohne Sprungziel
    func showInPDF(file: URL, line: Int) {
        revealInPDF(file: file, line: line, mode: .explicit)
    }

    private func cursorMoved(file: URL, line: Int) {
        lastCursor = (file, line)
        outline.updateCursor(file: file, line: line)
        guard synctex.followCursor else { return }
        revealInPDF(file: file, line: line, mode: .follow)
    }

    private func revealInPDF(file: URL, line: Int, mode: PDFPreviewStore.RevealMode) {
        guard let box = synctex.forward(file: file, line: line) else { return }
        pdf.reveal(box, mode: mode)
    }

    /// ⌘-Klick ins PDF: öffnet die Quelltextstelle, aber nur für .tex-Dateien des Projekts.
    func showInEditor(page: Int, point: CGPoint) {
        guard let location = synctex.backward(page: page, point: point),
              let file = projectFile(matching: location.file) else { return }
        Task { await editor.open(file, line: location.line) }
    }

    /// Die Projektdatei zu einem SyncTeX-Pfad. Vergleich über normalisierte Pfade, damit z. B.
    /// `/private/var/…` und `/var/…` nicht zwei Editor-Sitzungen für dieselbe Datei ergeben.
    private func projectFile(matching url: URL) -> URL? {
        let key = SyncTeXIndex.normalizedPath(url)
        return project.tree?.collectFiles()
            .map(\.url)
            .first { FileKind(url: $0).isEditable && SyncTeXIndex.normalizedPath($0) == key }
    }

    func reloadBuildOutputs() {
        pdf.refresh()
        synctex.reload(mainFile: project.mainFileURL)
    }

    // MARK: Kompilieren

    /// Speichert alle Dateien und kompiliert die Hauptdatei (⌘B).
    func compile() {
        guard let main = project.mainFileURL else { return }
        isSavingForBuild = true
        editor.saveAll()
        isSavingForBuild = false
        build.requestBuild(LatexBuildRequest(mainFile: main))
    }

    /// Projektindex der Vervollständigung (Labels, Literatur, Bilder, Makros) im Hintergrund neu lesen.
    func reloadCompletionIndex(immediately: Bool = false) async {
        guard let root = project.rootURL else { return }
        let files = project.tree?.collectFiles().map(\.url) ?? []
        if immediately {
            await completionProvider.reload(files: files, projectRoot: root, mainFile: project.mainFileURL)
        } else {
            completionProvider.scheduleReload(files: files, projectRoot: root, mainFile: project.mainFileURL)
        }
    }

    private func didSave() {
        for session in editor.openSessions where !session.isDirty { recovery.remove(for: session.url) }
        refreshSearchResults()
        Task { await reloadCompletionIndex() }
        refreshOutline()
        guard build.compileOnSave, !isSavingForBuild, let main = project.mainFileURL else { return }
        build.requestBuild(LatexBuildRequest(mainFile: main))
    }

    // MARK: Projekt öffnen

    func chooseProject() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Öffnen"
        panel.message = "LaTeX-Projektordner wählen"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard confirmUnsavedChanges() else { return }
        Task { await openProject(url) }
    }

    /// Projekt aus „Zuletzt geöffnet“. Existiert der Ordner nicht mehr, wird er aus der Liste entfernt.
    func openRecent(_ path: String) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else {
            recentProjects.remove(path)
            editor.errorMessage = "Der Ordner existiert nicht mehr: \(path)"
            return
        }
        guard confirmUnsavedChanges() else { return }
        Task { await openProject(URL(fileURLWithPath: path, isDirectory: true)) }
    }

    func restoreLastProject() async {
        guard project.rootURL == nil,
              let path = UserDefaults.standard.string(forKey: Self.lastProjectKey) else { return }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else { return }
        await openProject(URL(fileURLWithPath: path, isDirectory: true))
    }

    func openProject(_ url: URL) async {
        isSwitchingProject = true
        defer { isSwitchingProject = false }
        watcher?.stop()
        watcher = nil
        gitWatcher?.stop()
        gitWatcher = nil
        editor.closeAll()
        build.reset()
        synctex.reset()
        git.reset()
        changeMarks.reset()
        wordCounts.reset()
        search.reset()
        referenceChecks.reset()
        completionProvider.reset()
        lastCursor = nil

        await project.open(root: url)
        guard let root = project.rootURL else { return }
        UserDefaults.standard.set(root.path, forKey: Self.lastProjectKey)
        recentProjects.add(root)
        sidebar.load(project: root)

        pdf.setMainFile(project.mainFileURL)
        synctex.reload(mainFile: project.mainFileURL)
        outline.refresh(mainFile: project.mainFileURL)
        wordCounts.refreshProject()
        await reloadCompletionIndex(immediately: true)
        await restoreTabs(in: root)
        await offerRecovery(in: root)
        startWatching(root: root)
        await openRepository(in: root)
        isSwitchingProject = false
        persist(editor.tabs)
    }

    /// Stellt die zuletzt offenen Tabs wieder her; ohne gemerkte Tabs öffnet die Hauptdatei.
    private func restoreTabs(in root: URL) async {
        if let snapshot = TabMemory.load(for: root), !snapshot.paths.isEmpty {
            let inside = { (url: URL) in url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") }
            let urls = snapshot.paths.map { URL(fileURLWithPath: $0) }.filter(inside)
            await editor.restoreTabs(urls, active: snapshot.active.map { URL(fileURLWithPath: $0) })
        }
        if editor.tabs.isEmpty, let main = project.mainFileURL { await editor.open(main, asPreview: false) }
    }

    private func tabsChanged(_ tabs: EditorTabs) {
        persist(tabs)
        changeMarks.retain(Set(tabs.fileURLs))
        wordCounts.retain(Set(tabs.fileURLs))
        referenceChecks.retain(Set(tabs.fileURLs))
        git.updateDiffTabs(open: Set(tabs.items.compactMap(\.diffURL)), active: tabs.active?.diffURL)
    }

    private func persist(_ tabs: EditorTabs) {
        guard !isSwitchingProject, let root = project.rootURL else { return }
        TabMemory.save(tabs, for: root)
    }

    // MARK: Wiederherstellung nach Absturz

    /// Gibt es gesicherte, ungespeicherte Texte (die App wurde nicht sauber beendet), werden sie nach
    /// Rückfrage als ungespeicherte Änderungen in ihren Tabs wiederhergestellt; sonst gelöscht.
    private func offerRecovery(in root: URL) async {
        let backups = await recovery.backups(under: root)
        guard !backups.isEmpty else { return }
        guard confirmRecovery(backups) else {
            for backup in backups { recovery.remove(for: backup.url) }
            return
        }
        for backup in backups {
            if !FileManager.default.fileExists(atPath: backup.path) {
                try? FileManager.default.createDirectory(at: backup.url.deletingLastPathComponent(), withIntermediateDirectories: true)
                FileManager.default.createFile(atPath: backup.path, contents: nil)
            }
            await editor.open(backup.url, asPreview: false)
            guard let session = editor.session(for: backup.url) else { continue }
            session.textStorage.replaceCharacters(in: NSRange(location: 0, length: session.textStorage.length),
                                                  with: NSAttributedString(string: backup.text, attributes: EditorAppearance.textAttributes))
        }
    }

    static func showRecoveryAlert(backups: [RecoveryBackup]) -> Bool {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_AT")
        formatter.dateFormat = "dd.MM. HH:mm"
        let alert = NSAlert()
        alert.messageText = "Ungespeicherte Änderungen wiederherstellen?"
        alert.informativeText = "Die App wurde nicht sauber beendet. Gesichert wurden:\n\n"
            + backups.map { "\($0.url.lastPathComponent) (Stand \(formatter.string(from: $0.savedAt)))" }.joined(separator: "\n")
            + "\n\nWiederhergestellte Texte sind noch nicht gespeichert (⌘S)."
        alert.addButton(withTitle: "Wiederherstellen")
        alert.addButton(withTitle: "Verwerfen")
        return alert.runModal() == .alertFirstButtonReturn
    }

    // MARK: Dateisystem-Ereignisse

    private func startWatching(root: URL) {
        watcher = FSEventsWatcher(path: root.path) { events in
            Task { @MainActor [weak self] in self?.handle(events, root: root) }
        }
    }

    /// Git-Status laden. Liegt `.git` außerhalb des Projektordners, wird es zusätzlich überwacht.
    private func openRepository(in root: URL) async {
        await git.open(project: root)
        if git.availability == .notRepository, sidebar.tab == .changes { sidebar.tab = .files }
        guard let repository = git.repository, repository.projectPrefix != nil else { return }
        gitWatcher = FSEventsWatcher(path: repository.gitDirectory.path) { events in
            Task { @MainActor [weak self] in self?.refreshGitIfNeeded(for: events) }
        }
    }
}
