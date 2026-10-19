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
    /// Eingabe für „Label umbenennen“
    var labelRename: LabelRenamePrompt?
    /// Information zu einem abgeschlossenen Vorgang (z. B. „5 Stellen in 3 Dateien geändert“)
    var notice: String?
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
        project.reloadTree()
        if FileKind(url: url).isEditable { await editor.open(url, asPreview: false) }
    }

    func createFolder(named name: String, in folder: URL) throws {
        try FileOperations.createFolder(named: name, in: folder)
        project.reloadTree()
    }

    func duplicate(_ url: URL) async {
        do {
            let copy = try FileOperations.duplicate(url)
            project.reloadTree()
            if FileKind(url: copy).isEditable { await editor.open(copy, asPreview: false) }
        } catch {
            fileActions.errorMessage = error.localizedDescription
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
        try await relocate(source, to: destination) { try FileOperations.rename(source, toFileName: name) }
    }

    func move(_ url: URL, into folder: URL) async {
        guard let root = project.rootURL else { return }
        do {
            let source = url.standardizedFileURL
            let destination = try FileOperations.validateMove(source, into: folder, projectRoot: root)
            guard destination != source else { return }
            try await relocate(source, to: destination) { try FileOperations.move(source, into: folder, projectRoot: root) }
        } catch {
            fileActions.errorMessage = error.localizedDescription
        }
    }

    /// Gemeinsamer Ablauf für Umbenennen und Verschieben: Verweise suchen und ggf. nachfragen, ausführen,
    /// Tabs und Hauptdatei nachziehen, Verweise anpassen, Baum neu laden.
    private func relocate(_ source: URL, to destination: URL, operation: () throws -> URL) async throws {
        let edits = await referenceEdits(moving: source, to: destination)
        var shouldUpdate = false
        if !edits.isEmpty {
            switch confirmReferenceUpdate(edits, source.lastPathComponent) {
            case .update: shouldUpdate = true
            case .skip: break
            case .cancel: return
            }
        }
        let result = try operation()
        editor.relocate(from: source, to: result)
        let mainMoved = project.relocateMainFile(from: source, to: result)
        if shouldUpdate { applyReferenceEdits(edits, from: source, to: result) }
        project.reloadTree()
        if mainMoved {
            pdf.setMainFile(project.mainFileURL)
            synctex.reload(mainFile: project.mainFileURL)
        }
        refreshOutline()
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
        do {
            try moveToTrash(item)
        } catch {
            fileActions.errorMessage = "„\(item.lastPathComponent)“ konnte nicht in den Papierkorb gelegt werden: \(error.localizedDescription)"
            return
        }
        editor.closeTabs(under: item)
        project.reloadTree()
        if editor.tabs.isEmpty, let main = project.mainFileURL, FileManager.default.fileExists(atPath: main.path) {
            await editor.open(main, asPreview: false)
        }
        refreshOutline()
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
                if let data = try? Data(contentsOf: file) {
                    texts[file] = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
                }
            }
            let graphics = texts[main.standardizedFileURL].map(ProjectCatalog.graphicsDirectories(in:)) ?? []
            return ReferenceUpdater.edits(moving: source, to: destination, mainFile: main,
                                          graphicsDirectories: graphics, texts: texts)
        }.value
    }

    /// Offene Dateien werden im Editor geändert (und gespeichert, wenn sie vorher unverändert waren),
    /// alle anderen auf der Platte. Die Datei selbst kann dabei mitgezogen worden sein.
    private func applyReferenceEdits(_ edits: [ReferenceEdit], from source: URL, to destination: URL) {
        let grouped = Dictionary(grouping: edits, by: \.file)
        for (file, fileEdits) in grouped {
            let current = ReferenceUpdater.mapped(file, from: source.standardizedFileURL, to: destination.standardizedFileURL) ?? file
            if let session = editor.session(for: current) {
                let wasDirty = session.isDirty
                session.replaceText(with: ReferenceUpdater.apply(fileEdits, to: session.textStorage.string),
                                    actionName: "Verweise anpassen")
                if !wasDirty { try? session.save() }
            } else if let text = try? String(contentsOf: current, encoding: .utf8) {
                try? ReferenceUpdater.apply(fileEdits, to: text).write(to: current, atomically: true, encoding: .utf8)
            }
        }
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
