import AppKit

/// Tabs schließen und Nachfragen zu ungespeicherten Änderungen auf App-Ebene.
extension AppModel {
    // MARK: Tabs schließen

    func closeTab(_ tab: EditorTab) {
        guard confirmClosing([tab]) else { return }
        editor.closeTab(tab)
    }

    func closeTab(_ url: URL) {
        closeTab(.file(url.standardizedFileURL))
    }

    func closeActiveTab() {
        guard let tab = editor.tabs.active else { return }
        closeTab(tab)
    }

    func closeOtherTabs(keeping tab: EditorTab) {
        let others = editor.tabs.items.filter { $0 != tab }
        guard confirmClosing(others) else { return }
        editor.closeOtherTabs(keeping: tab)
    }

    func closeAllTabs() {
        guard confirmClosing(editor.tabs.items) else { return }
        editor.closeAllTabs()
    }

    /// Fragt nach, wenn einer der Tabs ungespeicherte Änderungen hat. `false` bedeutet: nicht schließen.
    func confirmClosing(_ tabs: [EditorTab]) -> Bool {
        let dirty = editor.dirtySessions(closing: tabs)
        guard !dirty.isEmpty else { return true }
        let title = dirty.count == 1
            ? "„\(dirty[0].url.lastPathComponent)“ hat ungespeicherte Änderungen"
            : "\(dirty.count) Dateien haben ungespeicherte Änderungen"
        switch promptForUnsavedChanges(title, dirty.map(\.url.lastPathComponent)) {
        case .save: return editor.save(tabs: tabs)
        case .discard:
            // Bewusst verworfen: keine Wiederherstellung anbieten
            for session in dirty { recovery.remove(for: session.url) }
            return true
        case .cancel: return false
        }
    }

    // MARK: Ungespeicherte Änderungen

    /// Fragt bei ungespeicherten Änderungen nach. `false` bedeutet: Vorgang abbrechen.
    func confirmUnsavedChanges() -> Bool {
        let dirty = editor.dirtySessions
        guard !dirty.isEmpty else { return true }
        switch promptForUnsavedChanges("Ungespeicherte Änderungen", dirty.map(\.url.lastPathComponent)) {
        case .save: return editor.saveAll()
        case .discard:
            for session in dirty { recovery.remove(for: session.url) }
            return true
        case .cancel: return false
        }
    }

    static func showUnsavedChangesAlert(title: String, names: [String]) -> UnsavedChoice {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = "Geändert: " + names.joined(separator: ", ")
        alert.addButton(withTitle: "Speichern")
        alert.addButton(withTitle: "Nicht speichern")
        alert.addButton(withTitle: "Abbrechen")
        switch alert.runModal() {
        case .alertFirstButtonReturn: return .save
        case .alertSecondButtonReturn: return .discard
        default: return .cancel
        }
    }
}
