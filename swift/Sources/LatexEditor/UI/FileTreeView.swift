import AppKit
import SwiftUI

struct FileTreeView: View {
    let model: AppModel
    let filter: String

    private var project: ProjectStore { model.project }
    private var editor: EditorStore { model.editor }
    /// Aufgeklappte Ordner (im Store, damit sie einen Tabwechsel der Seitenleiste überstehen)
    private var expanded: Set<URL> {
        get { model.sidebar.expandedFolders }
        nonmutating set { model.sidebar.expandedFolders = newValue }
    }
    private var expandedBinding: Binding<Set<URL>> {
        Binding(get: { model.sidebar.expandedFolders }, set: { model.sidebar.expandedFolders = $0 })
    }

    /// Eigener Zustand statt einer rein berechneten Bindung: Die Markierung folgt dem Klick sofort,
    /// auch während die Datei noch lädt, und folgt umgekehrt Wechseln über Gliederung oder Fehlerliste.
    @State private var selection: URL?

    var body: some View {
        if let fullTree = project.tree {
            let tree = fullTree.hidingFileTypes(project.hiddenFileExtensions, keeping: editor.current?.url)
            Group {
                if filter.isEmpty, (tree.children ?? []).isEmpty, !(fullTree.children ?? []).isEmpty {
                    AllFileTypesHidden(showAll: project.showAllFileTypes)
                } else if filter.isEmpty {
                    List(selection: $selection) {
                        ForEach(tree.children ?? []) { node in
                            FileNodeRow(model: model, node: node, expanded: expandedBinding)
                        }
                    }
                } else if matches(in: tree).isEmpty {
                    NoFilterMatches(filter: filter, hiddenTypeCount: project.hiddenFileExtensions.count)
                } else {
                    List(matches(in: tree), selection: $selection) { node in
                        FileRow(node: node, label: relativePath(of: node, in: tree), git: model.git)
                    }
                }
            }
            .listStyle(.sidebar)
            .dropDestination(for: URL.self) { urls, _ in dropOntoRoot(urls) }
            .onDeleteCommand { deleteSelection() }
            // Doppelklick/Return über die Liste selbst. Eine Tap-Geste an den Zeilen würde unter macOS
            // die Einfachklick-Auswahl schlucken (Klick im Baum wirkte nicht).
            .contextMenu(forSelectionType: URL.self, menu: contextMenu, primaryAction: openExternally)
            .onChange(of: selection) { _, url in
                project.selectedURL = url
                openSelection(url)
            }
            // Nach „Rückgängig“: zeigen, was sich geändert hat (HIG `undo-and-redo.md`)
            .onChange(of: model.fileActions.revealURL, initial: true) { _, url in
                guard let url else { return }
                model.fileActions.revealURL = nil
                reveal(url)
                if selection != url { selection = url }
            }
            .onChange(of: editor.current?.url, initial: true) { _, url in
                if selection != url { selection = url }
                if let url { reveal(url) }
            }
        } else {
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func openSelection(_ url: URL?) {
        guard let url, FileKind(url: url).isEditable, url != editor.current?.url else { return }
        Task { await editor.open(url) }
    }

    /// Doppelklick und „Öffnen“ im Kontextmenü: Ordner auf-/zuklappen, Textdateien als festen Tab,
    /// Bilder und PDFs extern öffnen.
    private func openExternally(_ urls: Set<URL>) {
        for url in urls {
            if isDirectory(url) {
                if expanded.contains(url) { expanded.remove(url) } else { expanded.insert(url) }
            } else if FileKind(url: url).isEditable {
                Task { await editor.open(url, asPreview: false) }
            } else {
                NSWorkspace.shared.open(url)
            }
        }
    }

    private func isDirectory(_ url: URL) -> Bool {
        FileOperations.isDirectory(url)
    }

    /// Klappt die Ordner über der Datei auf, damit sie im Baum sichtbar ist (z. B. nach „Neue Datei“).
    private func reveal(_ url: URL) {
        guard let root = project.rootURL?.standardizedFileURL else { return }
        var folders: Set<URL> = []
        var folder = url.standardizedFileURL.deletingLastPathComponent()
        while folder.path.hasPrefix(root.path + "/") {
            folders.insert(folder)
            folder = folder.deletingLastPathComponent()
        }
        // Nur schreiben, wenn sich etwas ändert: Jede Zuweisung zeichnet den ganzen Baum neu.
        if !folders.isSubset(of: expanded) { expanded.formUnion(folders) }
    }

    private func deleteSelection() {
        guard let url = selection, url != project.rootURL else { return }
        Task { await model.trash(url) }
    }

    private func dropOntoRoot(_ urls: [URL]) -> Bool {
        guard let root = project.rootURL else { return false }
        Task { await model.dropIntoProject(urls, folder: root) }
        return !urls.isEmpty
    }

    @ViewBuilder
    private func contextMenu(_ urls: Set<URL>) -> some View {
        if let url = urls.first, urls.count == 1 {
            Button(openTitle(for: url)) { openExternally([url]) }
            Divider()
            let folder = isDirectory(url) ? url : url.deletingLastPathComponent()
            Button("Neue Datei …", systemImage: "doc.badge.plus") { model.beginNewFile(in: folder) }
            Button("Neuer Ordner …", systemImage: "folder.badge.plus") { model.beginNewFolder(in: folder) }
            Divider()
            Button("Umbenennen …", systemImage: "pencil") { model.beginRename(url) }
            if !isDirectory(url) {
                Button("Duplizieren", systemImage: "plus.square.on.square") { Task { await model.duplicate(url) } }
            }
            if !isDirectory(url), model.git.marker(for: url) != nil {
                Button("Auf letzten Commit zurücksetzen …", systemImage: "arrow.uturn.backward") {
                    Task { await model.resetToLastCommit(file: url) }
                }
            }
            Divider()
            Button("In den Papierkorb legen", systemImage: "trash") { Task { await model.trash(url) } }
            Button("Im Finder zeigen", systemImage: "magnifyingglass") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
        } else if urls.isEmpty {
            Button("Neue Datei …", systemImage: "doc.badge.plus") { model.beginNewFile(in: project.rootURL) }
            Button("Neuer Ordner …", systemImage: "folder.badge.plus") { model.beginNewFolder(in: project.rootURL) }
        }
    }

    private func openTitle(for url: URL) -> String {
        guard isDirectory(url) else { return "Öffnen" }
        return expanded.contains(url) ? "Zuklappen" : "Aufklappen"
    }

    private func matches(in tree: FileNode) -> [FileNode] {
        tree.collectFiles()
            .filter { $0.url.lastPathComponent.localizedCaseInsensitiveContains(filter) }
            .map { FileNode(url: $0.url, children: nil) }
    }

    private func relativePath(of node: FileNode, in tree: FileNode) -> String {
        let prefix = tree.url.path + "/"
        return node.url.path.hasPrefix(prefix) ? String(node.url.path.dropFirst(prefix.count)) : node.name
    }
}

/// Ordner als DisclosureGroup mit eigenem Aufklapp-Zustand, Dateien als einfache Zeilen.
private struct FileNodeRow: View {
    let model: AppModel
    let node: FileNode
    @Binding var expanded: Set<URL>

    /// Während etwas über diesem Ordner schwebt: Zeile hervorgehoben, damit klar ist, wohin es fällt
    @State private var isDropTarget = false

    private func drop(_ urls: [URL], into folder: URL) -> Bool {
        Task { await model.dropIntoProject(urls, folder: folder) }
        return !urls.isEmpty
    }

    var body: some View {
        if let children = node.children {
            DisclosureGroup(isExpanded: isExpanded) {
                ForEach(children) { child in
                    FileNodeRow(model: model, node: child, expanded: $expanded)
                }
            } label: {
                FileRow(node: node, label: node.name, git: model.git)
                    .background(isDropTarget ? Color.accentColor.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: 5))
                    .draggable(node.url)
                    .dropDestination(for: URL.self) { urls, _ in drop(urls, into: node.url) } isTargeted: { isDropTarget = $0 }
            }
            .tag(node.url)
        } else {
            FileRow(node: node, label: node.name, git: model.git)
                .draggable(node.url)
                .dropDestination(for: URL.self) { urls, _ in drop(urls, into: node.url.deletingLastPathComponent()) }
                .tag(node.url)
        }
    }

    private var isExpanded: Binding<Bool> {
        let url = node.url
        return Binding(
            get: { expanded.contains(url) },
            set: { if $0 { expanded.insert(url) } else { expanded.remove(url) } }
        )
    }
}

private struct FileRow: View {
    private static let folderDotSize: CGFloat = 5

    let node: FileNode
    let label: String
    let git: GitStore
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        Label {
            HStack(spacing: 4) {
                Text(label).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                gitMarker
            }
            // `.sidebar`-Listen ignorieren die vererbte Schrift, deshalb an jeder Zeile
            .scaledFont(.body)
        } icon: {
            Image(systemName: node.isDirectory ? "folder" : FileGlyph.symbol(for: node.url))
                .scaledFont(.body)
                .foregroundStyle(iconColor)
        }
        .help(node.isDirectory || node.kind.isEditable ? node.name : "\(node.name) – Doppelklick öffnet extern")
        .modifier(ImageHoverPreview(url: node.url, isEnabled: node.kind == .image && !node.isDirectory))
    }

    /// Statusbuchstabe für geänderte Dateien, Punkt für Ordner mit Änderungen darin
    @ViewBuilder
    private var gitMarker: some View {
        if node.isDirectory {
            if git.containsChanges(node.url) {
                Circle()
                    .fill(Color.secondary)
                    .frame(width: Self.folderDotSize * scale, height: Self.folderDotSize * scale)
                    .help("Enthält Änderungen")
            }
        } else if let kind = git.marker(for: node.url) {
            GitStatusBadge(kind: kind)
        }
    }

    private var iconColor: Color {
        // Ordner zurückhaltend, damit die Dateien (blau) hervorstehen
        if node.isDirectory { return .secondary }
        switch node.kind {
        case .tex: return .accentColor
        case .bib: return .orange
        case .image: return .green
        case .other: return .secondary
        }
    }
}

/// Maus kurz auf einer Bilddatei: Popover mit dem Bild, den Maßen und der Dateigröße (verschwindet mit der Maus)
private struct ImageHoverPreview: ViewModifier {
    private static let delay = Duration.milliseconds(600)

    let url: URL
    let isEnabled: Bool
    @State private var isShown = false
    @State private var task: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .onHover { inside in
                task?.cancel()
                guard isEnabled else { return }
                guard inside else {
                    isShown = false
                    return
                }
                task = Task {
                    try? await Task.sleep(for: Self.delay)
                    guard !Task.isCancelled else { return }
                    isShown = true
                }
            }
            .popover(isPresented: $isShown, arrowEdge: .trailing) { ImagePreviewView(url: url) }
    }
}

/// Alle Dateien sind durch den Typfilter ausgeblendet: statt einer leeren Liste ein Ausweg
private struct AllFileTypesHidden: View {
    let showAll: () -> Void

    var body: some View {
        EmptyStateView(
            "Alle Dateien ausgeblendet", systemImage: "eye.slash",
            description: "Der Filter unten blendet alle Dateitypen dieses Projekts aus."
        ) {
            Button("Alle Dateitypen zeigen", action: showAll)
        }
    }
}
