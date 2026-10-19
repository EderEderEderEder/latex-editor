import Foundation
import Observation

struct JumpRequest: Equatable {
    let id = UUID()
    /// 1-basiert
    let line: Int
}

/// Einfügen von Text an der Cursorposition (Einfügen-Fenster).
struct InsertRequest: Equatable {
    let id = UUID()
    let text: String
    /// Mehrzeiliger Baustein: steht in eigenen Zeilen
    let isBlock: Bool
    /// Markierten Text ersetzen (Code, Gleichung, Liste) statt dahinter einfügen
    let replacesSelection: Bool
}

/// Verwaltet die Tabs: Datei-Tabs haben eine Sitzung mit eigenem Undo-Verlauf, Auswahl und
/// Scrollposition (sie lebt, solange der Tab offen ist); Diff-Tabs zeigen Git-Änderungen einer Datei.
@MainActor
@Observable
final class EditorStore {
    private(set) var current: DocumentSession?
    private(set) var jumpRequest: JumpRequest?
    private(set) var insertRequest: InsertRequest?
    /// Neue ID: Vervollständigung von Hand öffnen (Menü Bearbeiten, ⌃Leertaste)
    private(set) var completionRequest: UUID?
    private(set) var tabs = EditorTabs() {
        didSet { if tabs != oldValue { onTabsChanged?(tabs) } }
    }
    var errorMessage: String?

    @ObservationIgnored private var sessions: [URL: DocumentSession] = [:]
    @ObservationIgnored private var latestRequestedURL: URL?
    /// Liefert den markierten Text der angezeigten Datei (vom Editor-Coordinator gesetzt)
    @ObservationIgnored var selectionProvider: (() -> String)?
    @ObservationIgnored var onDidSave: (() -> Void)?
    /// Entprellt gemeldete Cursorposition (Datei, 1-basierte Zeile), z. B. für den aktuellen Abschnitt.
    @ObservationIgnored var onCursorMoved: ((URL, Int) -> Void)?
    /// Tabs haben sich geändert (zum Merken pro Projekt)
    @ObservationIgnored var onTabsChanged: ((EditorTabs) -> Void)?
    /// Text einer Sitzung hat sich geändert (Tippen, Neuladen) bzw. eine Sitzung wurde geöffnet
    @ObservationIgnored var onSessionTextChanged: ((DocumentSession) -> Void)?

    var dirtySessions: [DocumentSession] { sessions.values.filter(\.isDirty) }
    var hasUnsavedChanges: Bool { sessions.values.contains(where: \.isDirty) }

    func session(for url: URL) -> DocumentSession? {
        sessions[url.standardizedFileURL]
    }

    // MARK: Öffnen

    /// Öffnet eine Datei als Tab. Einfachklicks öffnen einen Vorschau-Tab (`asPreview`), der beim nächsten
    /// Öffnen ersetzt wird; `asPreview: false` legt einen dauerhaften Tab an.
    func open(_ url: URL, line: Int? = nil, asPreview: Bool = true) async {
        let key = url.standardizedFileURL
        latestRequestedURL = key
        if let existing = sessions[key] {
            show(existing, line: line, asPreview: asPreview)
            return
        }
        do {
            let loaded = try await DocumentSession.load(url: key)
            // Eine neuere Anfrage hat die Anzeige übernommen: Diese Sitzung hätte keinen Tab und wird verworfen.
            guard latestRequestedURL == key else { return }
            if let existing = sessions[key] {
                show(existing, line: line, asPreview: asPreview)
                return
            }
            loaded.onBecameDirty = { [weak self] in self?.tabs.promote(.file(key)) }
            loaded.onEdited = { [weak self, weak loaded] in
                guard let self, let loaded else { return }
                self.onSessionTextChanged?(loaded)
            }
            sessions[key] = loaded
            onSessionTextChanged?(loaded)
            show(loaded, line: line, asPreview: asPreview)
        } catch {
            errorMessage = "\(key.lastPathComponent) konnte nicht geöffnet werden: \(error.localizedDescription)"
        }
    }

    /// Stellt gemerkte Tabs wieder her. Nicht vorhandene Dateien werden übersprungen.
    func restoreTabs(_ urls: [URL], active: URL?) async {
        for url in urls where FileManager.default.fileExists(atPath: url.path) {
            await open(url, asPreview: false)
        }
        if let active, tabs.contains(active.standardizedFileURL) { activateTab(active) }
    }

    private func show(_ session: DocumentSession, line: Int?, asPreview: Bool) {
        openTab(.file(session.url), asPreview: asPreview)
        activate(session, line: line)
    }

    /// Öffnet die Git-Änderungen einer Datei als Tab (Einfachklick: Vorschau-Tab).
    func openDiff(_ url: URL, asPreview: Bool = true) {
        let key = url.standardizedFileURL
        // Ein noch ladender Datei-Tab soll die Anzeige danach nicht übernehmen.
        latestRequestedURL = nil
        openTab(.diff(key), asPreview: asPreview)
        if current != nil { current = nil }
    }

    private func openTab(_ tab: EditorTab, asPreview: Bool) {
        // Ein Vorschau-Tab mit ungespeicherten Änderungen darf nie verdrängt werden.
        if let preview = tabs.previewFileURL, sessions[preview]?.isDirty == true { tabs.promote(.file(preview)) }
        let result = tabs.open(tab, asPreview: asPreview)
        if let replaced = result.replaced?.fileURL { sessions[replaced] = nil }
    }

    // MARK: Tabs bedienen

    func activateTab(_ tab: EditorTab) {
        guard tabs.contains(tab) else { return }
        if let url = tab.fileURL {
            guard let session = sessions[url] else { return }
            tabs.activate(tab)
            latestRequestedURL = url
            activate(session, line: nil)
        } else {
            tabs.activate(tab)
            latestRequestedURL = nil
            syncCurrentWithActiveTab()
        }
    }

    func activateTab(_ url: URL) {
        activateTab(.file(url.standardizedFileURL))
    }

    func activateNextTab() {
        tabs.activateNext()
        syncCurrentWithActiveTab()
    }

    func activatePreviousTab() {
        tabs.activatePrevious()
        syncCurrentWithActiveTab()
    }

    /// Hält einen Vorschau-Tab fest (Doppelklick).
    func keepTab(_ tab: EditorTab) {
        tabs.promote(tab)
    }

    func keepTab(_ url: URL) {
        keepTab(.file(url.standardizedFileURL))
    }

    func moveTab(_ tab: EditorTab, onto target: EditorTab) {
        tabs.move(tab, onto: target)
    }

    /// Schließt einen Tab und gibt die Sitzung eines Datei-Tabs frei. Ungespeicherte Änderungen gehen
    /// verloren: vorher beim Nutzer nachfragen (`AppModel`).
    func closeTab(_ tab: EditorTab) {
        guard tabs.contains(tab) else { return }
        tabs.close(tab)
        if let url = tab.fileURL { sessions[url] = nil }
        if latestRequestedURL == tab.fileURL { latestRequestedURL = tabs.activeFileURL }
        syncCurrentWithActiveTab()
    }

    func closeTab(_ url: URL) {
        closeTab(.file(url.standardizedFileURL))
    }

    func closeOtherTabs(keeping tab: EditorTab) {
        guard tabs.contains(tab) else { return }
        for other in tabs.fileURLs where other != tab.fileURL { sessions[other] = nil }
        tabs.close(allExcept: tab)
        latestRequestedURL = tab.fileURL
        syncCurrentWithActiveTab()
    }

    func closeAllTabs() {
        closeAll()
    }

    /// Sitzungen der Tabs, die geschlossen würden und ungespeicherte Änderungen haben.
    func dirtySessions(closing tabs: [EditorTab]) -> [DocumentSession] {
        tabs.compactMap { $0.fileURL.flatMap { sessions[$0.standardizedFileURL] } }.filter(\.isDirty)
    }

    private func syncCurrentWithActiveTab() {
        let session = tabs.activeFileURL.flatMap { sessions[$0] }
        if current !== session { current = session }
    }

    // MARK: Dateien umbenennen, verschieben, löschen

    /// Der Datei bzw. dem Ordner folgen: offene Tabs und ihre Sitzungen ziehen um, Änderungen,
    /// Undo-Verlauf und Auswahl bleiben erhalten. Liefert die Zuordnung alt → neu.
    @discardableResult
    func relocate(from old: URL, to new: URL) -> [URL: URL] {
        let oldKey = old.standardizedFileURL
        let newKey = new.standardizedFileURL
        let mapping = tabs.relocate(from: oldKey, to: newKey)
        for (source, target) in mapping {
            guard let session = sessions.removeValue(forKey: source) else { continue }
            session.relocate(to: target)
            session.onBecameDirty = { [weak self] in self?.tabs.promote(.file(target)) }
            sessions[target] = session
        }
        if let latest = latestRequestedURL, let target = mapping[latest] { latestRequestedURL = target }
        return mapping
    }

    /// Schließt Tabs der Datei bzw. aller Dateien im Ordner, ohne nachzufragen (der Aufrufer hat bestätigt).
    func closeTabs(under url: URL) {
        for tab in tabs.tabs(under: url.standardizedFileURL) { closeTab(tab) }
    }

    /// Sitzungen mit ungespeicherten Änderungen in der Datei bzw. im Ordner.
    func dirtySessions(under url: URL) -> [DocumentSession] {
        dirtySessions(closing: tabs.tabs(under: url.standardizedFileURL))
    }

    // MARK: Einfügen, Speichern

    /// Ob Text eingefügt werden kann: eine .tex-Datei ist angezeigt.
    var canInsert: Bool {
        guard let current else { return false }
        return FileKind(url: current.url) == .tex
    }

    var selectedText: String {
        selectionProvider?() ?? ""
    }

    /// Fügt Text an der Cursorposition ein (ein Undo-Schritt). Gibt `false` zurück, wenn nichts angezeigt wird.
    @discardableResult
    func insert(_ text: String, isBlock: Bool, replacesSelection: Bool) -> Bool {
        guard canInsert else { return false }
        insertRequest = InsertRequest(text: text, isBlock: isBlock, replacesSelection: replacesSelection)
        return true
    }

    func requestCompletion() {
        guard current != nil else { return }
        completionRequest = UUID()
    }

    func reportCursor(file: URL, line: Int) {
        onCursorMoved?(file, line)
    }

    func saveCurrent() {
        guard let current else { return }
        save([current])
    }

    /// Gibt `false` zurück, wenn mindestens eine Datei nicht gespeichert werden konnte.
    @discardableResult
    func saveAll() -> Bool {
        save(dirtySessions)
    }

    @discardableResult
    func save(tabs: [EditorTab]) -> Bool {
        save(dirtySessions(closing: tabs))
    }

    // MARK: Externe Änderungen

    /// Offene Dateien mit der Platte abgleichen (FSEvents, nach Pull, Branch-Wechsel, Verwerfen).
    /// `urls == nil`: alle. Liefert die Dateien, die es auf der Platte nicht mehr gibt.
    @discardableResult
    func syncWithDisk(_ urls: [URL]? = nil, discardingChanges: Bool = false) async -> [URL] {
        let keys = urls.map { $0.map(\.standardizedFileURL) } ?? Array(sessions.keys)
        var missing: [URL] = []
        for key in keys {
            guard let session = sessions[key] else { continue }
            if await session.syncWithDisk(discardingChanges: discardingChanges) == .missing { missing.append(key) }
        }
        return missing
    }

    /// Neue Schriftgröße für alle offenen Dateien (auch die nicht angezeigten)
    func applyEditorFont() {
        for session in sessions.values { session.applyEditorFont() }
    }

    /// Alle offenen Dateien (für die Änderungsmarken)
    var openSessions: [DocumentSession] { Array(sessions.values) }

    // MARK: Gelöschte Dateien, Aufräumen

    /// Reagiert auf eine extern gelöschte Datei. Eine unveränderte Sitzung wird samt Tab geschlossen,
    /// eine mit Änderungen bleibt offen und wird markiert. Gibt `true` zurück, wenn der aktive Tab
    /// geschlossen wurde (der Aufrufer sorgt bei leerer Tab-Leiste für eine neue Anzeige).
    @discardableResult
    func handleDeletedFile(_ url: URL) -> Bool {
        let key = url.standardizedFileURL
        guard let session = sessions[key] else { return false }
        if session.isDirty {
            if !session.isMissingOnDisk { session.isMissingOnDisk = true }
            return false
        }
        let wasActive = tabs.activeFileURL == key
        closeTab(.file(key))
        return wasActive
    }

    func closeAll() {
        tabs.closeAll()
        sessions.removeAll()
        current = nil
        jumpRequest = nil
        insertRequest = nil
        latestRequestedURL = nil
    }

    private func activate(_ session: DocumentSession, line: Int?) {
        if current !== session { current = session }
        if let line { jumpRequest = JumpRequest(line: line) }
    }

    @discardableResult
    private func save(_ targets: [DocumentSession]) -> Bool {
        var allSucceeded = true
        for session in targets {
            do {
                try session.save()
            } catch {
                allSucceeded = false
                errorMessage = "\(session.url.lastPathComponent) konnte nicht gespeichert werden: \(error.localizedDescription)"
            }
        }
        if !targets.isEmpty { onDidSave?() }
        return allSucceeded
    }
}
