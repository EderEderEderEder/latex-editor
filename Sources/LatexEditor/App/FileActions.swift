import AppKit
import Observation

/// Eingabe eines Namens für „Neue Datei“, „Neuer Ordner“ oder „Umbenennen“.
struct NamePrompt: Identifiable, Equatable {
    enum Kind: Equatable {
        case newFile
        case newFolder
        case rename
    }

    let id = UUID()
    let kind: Kind
    /// Bei „neu“ der Zielordner, beim Umbenennen das Element selbst
    let target: URL
    let initialName: String

    var title: String {
        switch kind {
        case .newFile: "Neue Datei"
        case .newFolder: "Neuer Ordner"
        case .rename: "Umbenennen"
        }
    }

    var actionTitle: String {
        kind == .rename ? "Umbenennen" : "Anlegen"
    }
}

@MainActor
@Observable
final class FileActionStore {
    var prompt: NamePrompt?
    var errorMessage: String?
    /// Eingabe für „Umbenennen …“ (Label, Quelle, Abkürzung, Befehl, Umgebung)
    var rename: RenamePrompt?
    /// Information zu einem abgeschlossenen Vorgang (z. B. „5 Stellen in 3 Dateien geändert“)
    var notice: String?
    /// Nach Rückgängig und Wiederholen: dieser Eintrag soll im Dateibaum markiert und sichtbar sein
    var revealURL: URL?
    /// Namen des nächsten Rückgängig- und Wiederholen-Schritts für das Menü Ablage; `nil`: nichts zu tun
    private(set) var undoTitle: String?
    private(set) var redoTitle: String?
    /// In Tests statt des Fensters (dort gibt es keines)
    @ObservationIgnored var undoManagerOverride: UndoManager?
    @ObservationIgnored private(set) lazy var fallbackUndoManager = UndoManager()

    func setUndoTitles(undo: String?, redo: String?) {
        if undo != undoTitle { undoTitle = undo }
        if redo != redoTitle { redoTitle = redo }
    }
}

// MARK: - Dateioperationen im Projekt

extension AppModel {
    // MARK: Dialog öffnen

    func beginNewFile(in folder: URL? = nil) {
        guard let root = project.rootURL else { return }
        let target = folder ?? FileOperations.targetFolder(for: project.selectedURL, projectRoot: root)
        fileActions.prompt = NamePrompt(kind: .newFile, target: target, initialName: "")
    }

    func beginNewFolder(in folder: URL? = nil) {
        guard let root = project.rootURL else { return }
        let target = folder ?? FileOperations.targetFolder(for: project.selectedURL, projectRoot: root)
        fileActions.prompt = NamePrompt(kind: .newFolder, target: target, initialName: "")
    }

    func beginRename(_ url: URL) {
        guard let root = project.rootURL, FileOperations.isInside(url, root: root) else { return }
        fileActions.prompt = NamePrompt(kind: .rename, target: url, initialName: url.lastPathComponent)
    }

    // MARK: Bestätigen

    /// Führt die Eingabe aus. Gibt eine Fehlermeldung zurück, damit der Dialog offen bleiben kann.
    func commit(_ prompt: NamePrompt, name: String, chapterScaffold: Bool = false) async -> String? {
        do {
            switch prompt.kind {
            case .newFile: try await createFile(named: name, in: prompt.target, chapterScaffold: chapterScaffold)
            case .newFolder: try createFolder(named: name, in: prompt.target)
            case .rename: try await rename(prompt.target, to: name)
            }
            fileActions.prompt = nil
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: Anlegen

    func createFile(named name: String, in folder: URL, chapterScaffold: Bool) async throws {
        let fileName = try FileOperations.newFileName(from: name)
        let stem = URL(fileURLWithPath: fileName).deletingPathExtension().lastPathComponent
        let isTeX = URL(fileURLWithPath: fileName).pathExtension.lowercased() == "tex"
        let contents = chapterScaffold && isTeX ? "\\chapter{\(stem)}\n\n" : ""
        let url = try FileOperations.createFile(named: fileName, in: folder, contents: contents)
        registerCreationUndo(of: url, name: "Neue Datei")
        project.reloadTree()
        if FileKind(url: url).isEditable { await editor.open(url, asPreview: false) }
    }

    func createFolder(named name: String, in folder: URL) throws {
        let url = try FileOperations.createFolder(named: name, in: folder)
        registerCreationUndo(of: url, name: "Neuer Ordner")
        project.reloadTree()
    }

    func duplicate(_ url: URL) async {
        do {
            let copy = try FileOperations.duplicate(url)
            registerCreationUndo(of: copy, name: "Duplizieren")
            project.reloadTree()
            if FileKind(url: copy).isEditable { await editor.open(copy, asPreview: false) }
        } catch {
            fileActions.errorMessage = error.localizedDescription
        }
    }

    // MARK: Ziehen aus dem Finder

    /// Auf den Baum gezogene Einträge: aus dem Projekt verschieben, von außerhalb kopieren (andere Quelle = Kopie,
    /// HIG `drag-and-drop.md › Best practices`). Kopien lassen sich rückgängig machen (landen im Papierkorb).
    func dropIntoProject(_ urls: [URL], folder: URL) async {
        guard let root = project.rootURL else { return }
        let inside = urls.filter { FileOperations.isInside($0, root: root) }
        let outside = urls.filter { !FileOperations.isInside($0, root: root) && $0.standardizedFileURL != root.standardizedFileURL }
        for url in inside { await move(url, into: folder) }
        guard !outside.isEmpty else { return }
        do {
            let copies = try await Task.detached(priority: .userInitiated) {
                try outside.map { try FileOperations.copyIn($0, into: folder) }
            }.value
            for copy in copies { registerCreationUndo(of: copy, name: "Hinzufügen") }
            project.reloadTree()
            fileActions.revealURL = copies.last
            refreshOutline()
            if copies.count == 1, let copy = copies.first, FileKind(url: copy).isEditable {
                await editor.open(copy, asPreview: true)
            }
        } catch {
            fileActions.errorMessage = "Hinzufügen nicht möglich: \(error.localizedDescription)"
        }
    }

    // MARK: Umbenennen und Verschieben

    func rename(_ url: URL, to rawName: String) async throws {
        guard let root = project.rootURL else { return }
        let source = url.standardizedFileURL
        guard source != root.standardizedFileURL else { throw FileOperationError.isProjectRoot }
        guard FileOperations.isInside(source, root: root) else { throw FileOperationError.outsideProject }
        let name = try FileOperations.renamedFileName(from: rawName, original: source)
        let destination = try FileOperations.destination(for: name, in: source.deletingLastPathComponent(), replacing: source)
        guard destination != source else { return }
        try await relocate(source, to: destination, actionName: "Umbenennen") { try FileOperations.rename(source, toFileName: name) }
    }

    func move(_ url: URL, into folder: URL) async {
        guard let root = project.rootURL else { return }
        do {
            let source = url.standardizedFileURL
            let destination = try FileOperations.validateMove(source, into: folder, projectRoot: root)
            guard destination != source else { return }
            try await relocate(source, to: destination, actionName: "Verschieben") { try FileOperations.move(source, into: folder, projectRoot: root) }
        } catch {
            fileActions.errorMessage = error.localizedDescription
        }
    }

    /// Gemeinsamer Ablauf für Umbenennen und Verschieben: Verweise suchen und ggf. nachfragen, ausführen,
    /// Tabs und Hauptdatei nachziehen, Verweise anpassen, Baum neu laden. `preset` ersetzt die Rückfrage (Rückgängig und
    /// Wiederholen wiederholen die damalige Antwort); `registersUndo: false` bei Rückgängig und Wiederholen selbst.
    private func relocate(
        _ source: URL, to destination: URL, actionName: String, preset: ReferenceUpdateChoice? = nil, registersUndo: Bool = true,
        operation: () throws -> URL
    ) async throws {
        let edits = await referenceEdits(moving: source, to: destination)
        var shouldUpdate = false
        if !edits.isEmpty {
            switch preset ?? confirmReferenceUpdate(edits, source.lastPathComponent) {
            case .update: shouldUpdate = true
            case .skip: break
            case .cancel: return
            }
        }
        let result = try operation()
        editor.relocate(from: source, to: result)
        let mainMoved = project.relocateMainFile(from: source, to: result)
        if shouldUpdate { reportReferenceFailures(await applyReferenceEdits(edits, from: source, to: result), item: result) }
        project.reloadTree()
        if mainMoved {
            pdf.setMainFile(project.mainFileURL)
            synctex.reload(mainFile: project.mainFileURL)
        }
        refreshOutline()
        if registersUndo { registerRelocationUndo(from: source, to: result, updatedReferences: shouldUpdate, name: actionName) }
    }

    /// Umbenennen und Verschieben: zurück an den alten Ort (mit denselben Verweisanpassungen wie damals) und wieder vor
    private func registerRelocationUndo(from source: URL, to result: URL, updatedReferences: Bool, name: String) {
        let choice: ReferenceUpdateChoice = updatedReferences ? .update : .skip
        func perform(_ from: URL, _ to: URL) async {
            do {
                try await relocate(from, to: to, actionName: name, preset: choice, registersUndo: false) {
                    try FileOperations.relocate(from, to: to)
                }
                fileActions.revealURL = to
            } catch {
                fileActions.errorMessage = error.localizedDescription
            }
        }
        registerFileUndo(FileUndoAction(
            name: name,
            undo: { await perform(result, source) },
            redo: { await perform(source, result) }
        ))
    }

    // MARK: Papierkorb

    func trash(_ url: URL) async {
        guard let root = project.rootURL else { return }
        let item = url.standardizedFileURL
        guard item != root.standardizedFileURL else {
            fileActions.errorMessage = FileOperationError.isProjectRoot.localizedDescription
            return
        }
        guard FileOperations.isInside(item, root: root) else {
            fileActions.errorMessage = FileOperationError.outsideProject.localizedDescription
            return
        }
        let dirty = editor.dirtySessions(under: item).map(\.url.lastPathComponent)
        var detail = "Der Eintrag wird in den Papierkorb gelegt und kann dort wiederhergestellt werden."
        if let main = project.mainFileURL, ReferenceUpdater.mapped(main, from: item, to: item) != nil {
            detail += "\n\nAchtung: Das ist die Hauptdatei des Projekts."
        }
        if !dirty.isEmpty {
            detail += "\n\nUngespeicherte Änderungen gehen verloren: " + dirty.joined(separator: ", ")
        }
        guard confirmTrash("„\(item.lastPathComponent)“ in den Papierkorb legen?", detail) else { return }
        let ticket = TrashTicket()
        guard await removeToTrash(item, ticket: ticket) else { return }
        registerTrashUndo(of: item, ticket: ticket)
    }

    // MARK: Verweise

    /// Verweise, die durch das Verschieben ungültig würden. Liest nicht geöffnete Dateien im Hintergrund.
    private func referenceEdits(moving source: URL, to destination: URL) async -> [ReferenceEdit] {
        guard let main = project.mainFileURL, let tree = project.tree else { return [] }
        let files = tree.collectFiles().map(\.url).filter { FileKind(url: $0) == .tex }
        var openTexts: [URL: String] = [:]
        for file in files {
            if let session = editor.session(for: file) { openTexts[file] = session.textStorage.string }
        }
        let openSnapshot = openTexts
        return await Task.detached(priority: .userInitiated) {
            var texts = openSnapshot
            for file in files where texts[file] == nil {
                if let text = ProjectText.string(file) { texts[file] = text }
            }
            let graphics = texts[main.standardizedFileURL].map(ProjectCatalog.graphicsDirectories(in:)) ?? []
            return ReferenceUpdater.edits(moving: source, to: destination, mainFile: main,
                                          graphicsDirectories: graphics, texts: texts)
        }.value
    }

    /// Offene Dateien werden im Editor geändert (und gespeichert, wenn sie vorher unverändert waren), alle anderen
    /// im Hintergrund auf der Platte, in ihrer Kodierung. Die Datei selbst kann dabei mitgezogen worden sein.
    /// Gibt zurück, was nicht geklappt hat („datei.tex: Grund“), statt es still zu übergehen.
    private func applyReferenceEdits(_ edits: [ReferenceEdit], from source: URL, to destination: URL) async -> [String] {
        var failures: [String] = []
        var closedFiles: [(url: URL, edits: [ReferenceEdit])] = []
        for (file, fileEdits) in Dictionary(grouping: edits, by: \.file) {
            let current = ReferenceUpdater.mapped(file, from: source.standardizedFileURL, to: destination.standardizedFileURL) ?? file
            guard let session = editor.session(for: current) else {
                closedFiles.append((current, fileEdits))
                continue
            }
            let wasDirty = session.isDirty
            session.replaceText(with: ReferenceUpdater.apply(fileEdits, to: session.textStorage.string), actionName: "Verweise anpassen")
            do {
                if !wasDirty { try session.save() }
            } catch {
                failures.append("\(current.lastPathComponent): \(error.localizedDescription)")
            }
        }
        let pending = closedFiles
        failures += await Task.detached(priority: .userInitiated) { Self.applyOnDisk(pending) }.value
        return failures.sorted()
    }

    private nonisolated static func applyOnDisk(_ files: [(url: URL, edits: [ReferenceEdit])]) -> [String] {
        files.compactMap { file in
            do {
                let (text, encoding) = try ProjectText.readForEditing(file.url)
                try ReferenceUpdater.apply(file.edits, to: text).write(to: file.url, atomically: true, encoding: encoding)
                return nil
            } catch {
                return "\(file.url.lastPathComponent): \(error.localizedDescription)"
            }
        }
    }

    private func reportReferenceFailures(_ failures: [String], item: URL) {
        guard !failures.isEmpty else { return }
        fileActions.errorMessage = "„\(item.lastPathComponent)“ wurde umbenannt bzw. verschoben, aber diese Verweise konnten nicht "
            + "angepasst werden und zeigen jetzt ins Leere – bitte von Hand ändern:\n\n" + failures.joined(separator: "\n")
    }

    // MARK: Nachfragen

    static func showReferenceUpdateAlert(edits: [ReferenceEdit], itemName: String) -> ReferenceUpdateChoice {
        let files = Set(edits.map(\.file)).count
        let alert = NSAlert()
        alert.messageText = "Verweise auf „\(itemName)“ anpassen?"
        alert.informativeText = "\(edits.count) Verweis\(edits.count == 1 ? "" : "e") in \(files) Datei\(files == 1 ? "" : "en") würden sonst ins Leere zeigen."
        alert.accessoryView = changeList(edits)
        alert.addButton(withTitle: "Verweise anpassen")
        alert.addButton(withTitle: "Nur umbenennen")
        alert.addButton(withTitle: "Abbrechen")
        switch alert.runModal() {
        case .alertFirstButtonReturn: return .update
        case .alertSecondButtonReturn: return .skip
        default: return .cancel
        }
    }

    private static func changeList(_ edits: [ReferenceEdit]) -> NSView {
        let lines = edits.map { "\($0.file.lastPathComponent):\($0.line)   \($0.oldText)  →  \($0.newText)" }
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 460, height: 130))
        textView.string = lines.joined(separator: "\n")
        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 460, height: 130))
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder
        return scrollView
    }

    static func showTrashAlert(title: String, detail: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.alertStyle = .warning
        alert.addButton(withTitle: "In den Papierkorb")
        alert.addButton(withTitle: "Abbrechen")
        return alert.runModal() == .alertFirstButtonReturn
    }
}
