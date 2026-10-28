import AppKit

/// Ein Schritt, den ⌘Z im Dateibaum zurücknimmt (und ⇧⌘Z wiederholt)
struct FileUndoAction {
    let name: String
    let undo: @MainActor () async -> Void
    let redo: @MainActor () async -> Void
}

/// Wo eine in den Papierkorb gelegte Datei liegt; Rückgängig und Wiederholen reichen sie weiter
@MainActor
final class TrashTicket {
    var url: URL?

    init(_ url: URL? = nil) {
        self.url = url
    }
}

/// „Rückgängig“ für Dateioperationen: Anlegen, Duplizieren, Umbenennen, Verschieben und Papierkorb. Die Schritte liegen
/// im Undo-Manager des Fensters. Hat der Dateibaum den Fokus, gilt ⌘Z ihnen; im Editor bleibt ⌘Z beim Text (dessen Sitzung hat
/// einen eigenen Manager). Gelöschtes kommt aus dem Papierkorb zurück, Angelegtes geht dorthin (nichts ist endgültig weg).
extension AppModel {
    /// Der Manager, in dem die Schritte liegen: das Hauptfenster (ein Dialog davor ändert daran nichts)
    var fileUndoManager: UndoManager {
        fileActions.undoManagerOverride ?? NSApp?.mainWindow?.undoManager ?? NSApp?.keyWindow?.undoManager ?? fileActions.fallbackUndoManager
    }

    func registerFileUndo(_ action: FileUndoAction) {
        register(action, in: fileUndoManager, expectsUndo: true)
    }

    /// Wiederholen legt den Schritt zurück auf den Undo-Stapel und umgekehrt: Der Handler meldet den Gegenschritt an,
    /// bevor er die Arbeit startet (so ordnet der Manager ihn richtig ein).
    private func register(_ action: FileUndoAction, in manager: UndoManager, expectsUndo: Bool) {
        manager.registerUndo(withTarget: fileActions) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.register(action, in: manager, expectsUndo: !expectsUndo)
                Task { @MainActor in
                    if expectsUndo { await action.undo() } else { await action.redo() }
                    self.updateFileUndoTitles()
                }
            }
        }
        manager.setActionName(action.name)
        Task { @MainActor in updateFileUndoTitles() }
    }

    func updateFileUndoTitles() {
        let manager = fileUndoManager
        fileActions.setUndoTitles(undo: manager.canUndo ? manager.undoActionName : nil, redo: manager.canRedo ? manager.redoActionName : nil)
    }

    /// Menü Ablage: der letzte Dateischritt, auch wenn der Fokus im Editor liegt
    func undoFileOperation() {
        let manager = fileUndoManager
        guard manager.canUndo else { return }
        manager.undo()
    }

    func redoFileOperation() {
        let manager = fileUndoManager
        guard manager.canRedo else { return }
        manager.redo()
    }

    // MARK: Papierkorb

    /// Legt in den Papierkorb und räumt Tabs, Baum und Gliederung auf. Gibt an, ob es geklappt hat.
    @discardableResult
    func removeToTrash(_ item: URL, ticket: TrashTicket) async -> Bool {
        guard FileManager.default.fileExists(atPath: item.path) else { return false }
        do {
            ticket.url = try moveToTrash(item)
        } catch {
            fileActions.errorMessage = "„\(item.lastPathComponent)“ konnte nicht in den Papierkorb gelegt werden: \(error.localizedDescription)"
            return false
        }
        editor.closeTabs(under: item)
        project.reloadTree()
        if editor.tabs.isEmpty, let main = project.mainFileURL, FileManager.default.fileExists(atPath: main.path) {
            await editor.open(main, asPreview: false)
        }
        refreshOutline()
        return true
    }

    /// Holt die Datei aus dem Papierkorb an ihren alten Platz zurück und zeigt sie im Baum.
    func restoreFromTrash(_ ticket: TrashTicket, to item: URL) async {
        guard let trashed = ticket.url, FileManager.default.fileExists(atPath: trashed.path) else {
            fileActions.errorMessage = "„\(item.lastPathComponent)“ liegt nicht mehr im Papierkorb. Bitte dort suchen."
            return
        }
        do {
            try FileOperations.relocate(trashed, to: item)
        } catch {
            fileActions.errorMessage = "„\(item.lastPathComponent)“ konnte nicht wiederhergestellt werden: \(error.localizedDescription)"
            return
        }
        project.reloadTree()
        if FileKind(url: item).isEditable { await editor.open(item, asPreview: false) }
        refreshOutline()
        fileActions.revealURL = item
    }

    /// Angelegt (Datei, Ordner, Kopie): Rückgängig legt es in den Papierkorb, Wiederholen holt es zurück
    func registerCreationUndo(of item: URL, name: String) {
        let ticket = TrashTicket()
        registerFileUndo(FileUndoAction(
            name: name,
            undo: { [weak self] in await self?.removeToTrash(item, ticket: ticket) },
            redo: { [weak self] in await self?.restoreFromTrash(ticket, to: item) }
        ))
    }

    /// In den Papierkorb gelegt: Rückgängig holt es zurück, Wiederholen legt es wieder hinein
    func registerTrashUndo(of item: URL, ticket: TrashTicket) {
        guard ticket.url != nil else { return }
        registerFileUndo(FileUndoAction(
            name: "In den Papierkorb legen",
            undo: { [weak self] in await self?.restoreFromTrash(ticket, to: item) },
            redo: { [weak self] in await self?.removeToTrash(item, ticket: ticket) }
        ))
    }
}
