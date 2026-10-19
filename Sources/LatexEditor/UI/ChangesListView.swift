import AppKit
import SwiftUI

extension GitChangeKind {
    var color: Color {
        switch self {
        case .modified, .typeChanged: .orange
        case .added, .untracked: .green
        case .deleted: .red
        case .renamed, .copied: .blue
        case .conflicted: .purple
        }
    }
}

/// Statusbuchstabe (M, A, D, R, U, !) in der Farbe der Änderung.
struct GitStatusBadge: View {
    let kind: GitChangeKind

    var body: some View {
        Text(kind.letter)
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(kind.color)
            .help(kind.title)
    }
}

/// Seitenleisten-Tab „Änderungen“: Commit-Nachricht und Button oben, darunter bereitgestellte und
/// nicht bereitgestellte Dateien. Ein Klick auf eine Datei zeigt ihren Diff im Editorbereich.
struct ChangesListView: View {
    let model: AppModel
    let filter: String

    private var git: GitStore { model.git }

    var body: some View {
        switch git.availability {
        case .unknown:
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .notRepository:
            ContentUnavailableView(
                "Kein Git-Repository", systemImage: "arrow.triangle.branch",
                description: Text("Der Projektordner gehört zu keinem Git-Repository.")
            )
        case let .unavailable(message):
            ContentUnavailableView("Git nicht verfügbar", systemImage: "exclamationmark.triangle", description: Text(message))
        case .ready:
            VStack(spacing: 0) {
                if let reset = git.lastReset { ResetNotice(model: model, snapshot: reset) }
                CommitBox(model: model)
                if git.hasRemote { SyncBar(model: model) }
                Divider()
                changes
                    .frame(maxHeight: .infinity)
            }
        }
    }

    @ViewBuilder
    private var changes: some View {
        if !git.hasChanges {
            ContentUnavailableView("Keine Änderungen", systemImage: "checkmark.circle", description: Text("Alles ist committet."))
        } else {
            List {
                section(title: "Bereitgestellt", changes: filtered(git.staged), actionTitle: "Alle zurücknehmen",
                        symbol: "minus", resetAll: { Task { await model.resetToLastCommit(git.staged) } }) {
                    Task { await git.unstageAll() }
                }
                section(title: "Nicht bereitgestellt", changes: filtered(git.unstaged), actionTitle: "Alle bereitstellen",
                        symbol: "plus", resetAll: { Task { await model.resetToLastCommit(git.unstaged) } }) {
                    Task { await git.stageAll() }
                }
            }
            .listStyle(.sidebar)
        }
    }

    @ViewBuilder
    private func section(title: String, changes: [GitChange], actionTitle: String, symbol: String,
                         resetAll: @escaping () -> Void, action: @escaping () -> Void) -> some View {
        if !changes.isEmpty {
            Section {
                ForEach(changes) { change in
                    ChangeRow(model: model, change: change)
                }
            } header: {
                HStack {
                    Text("\(title) (\(changes.count))")
                    Spacer()
                    Button("Alle auf letzten Commit zurücksetzen …", systemImage: "arrow.uturn.backward", action: resetAll)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .disabled(git.isBusy)
                        .help("Diese Dateien auf den Stand des letzten Commits zurücksetzen …")
                    Button(actionTitle, systemImage: symbol, action: action)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .disabled(git.isBusy)
                        .help(actionTitle)
                }
            }
        }
    }

    private func filtered(_ changes: [GitChange]) -> [GitChange] {
        guard !filter.isEmpty else { return changes }
        return changes.filter { $0.path.localizedCaseInsensitiveContains(filter) }
    }
}

/// Nach dem Zurücksetzen: Hinweis mit „Rückgängig“, bis zum nächsten Zurücksetzen oder Schließen.
private struct ResetNotice: View {
    let model: AppModel
    let snapshot: ResetSnapshot

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.uturn.backward.circle.fill").foregroundStyle(.orange)
            Text(snapshot.title).lineLimit(2)
            Spacer(minLength: 4)
            Button("Rückgängig") { Task { await model.undoLastReset() } }
                .help("Stand von vorher wiederherstellen (Inhalte, auch damals ungespeicherten Text; Bereitstellungen nicht)")
            Button("Hinweis schließen", systemImage: "xmark") { model.git.lastReset = nil }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
        }
        .font(.callout)
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange.opacity(0.12)))
        .padding([.horizontal, .top], 10)
    }
}

/// Pull und Push mit Zahlen, Abrufen; nur bei eingerichtetem Remote.
private struct SyncBar: View {
    let model: AppModel

    private var git: GitStore { model.git }

    var body: some View {
        HStack(spacing: 10) {
            Button(git.branch.behind > 0 ? "Pull (\(git.branch.behind))" : "Pull", systemImage: "arrow.down") {
                Task { await model.pullFromRemote() }
            }
            .disabled(git.branch.upstream == nil)
            .help("Neue Commits vom Remote holen (nur ohne Zusammenführen)")
            Button(git.branch.ahead > 0 ? "Push (\(git.branch.ahead))" : "Push", systemImage: "arrow.up") {
                Task { await model.pushToRemote() }
            }
            .disabled(git.branch.head == nil)
            .help("Commits zum Remote senden")
            Spacer()
            if let activity = git.activity {
                ProgressView().controlSize(.small)
                Text(activity).foregroundStyle(.secondary)
            } else {
                Button("Abrufen", systemImage: "arrow.triangle.2.circlepath") { Task { await model.fetchFromRemote() } }
                    .labelStyle(.iconOnly)
                    .help("Stand des Remotes abrufen (ändert keine Dateien)")
            }
        }
        .buttonStyle(.borderless)
        .font(.caption)
        .disabled(git.isBusy)
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
    }
}

private struct CommitBox: View {
    private static let editorHeight: CGFloat = 54
    private static let cornerRadius: CGFloat = 6

    let model: AppModel

    private var git: GitStore { model.git }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            messageEditor
            HStack(spacing: 6) {
                if git.stagedOutsideProject > 0 {
                    Text("+ \(git.stagedOutsideProject) außerhalb")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .help("Bereitgestellte Dateien außerhalb des Projektordners werden mitcommittet.")
                }
                Spacer()
                if git.isBusy { ProgressView().controlSize(.small) }
                Button(git.staged.isEmpty ? "Alle committen" : "Commit") {
                    Task { await model.commitChanges() }
                }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!git.canCommit)
                .help(git.staged.isEmpty ? "Alle Änderungen bereitstellen und committen (⌘↩)" : "Bereitgestellte Änderungen committen (⌘↩)")
            }
        }
        .padding(10)
    }

    private var messageEditor: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: messageBinding)
                .font(.callout)
                .scrollContentBackground(.hidden)
            if git.commitMessage.isEmpty {
                Text("Commit-Nachricht")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 5)
                    .allowsHitTesting(false)
            }
        }
        .frame(height: Self.editorHeight)
        .padding(4)
        .background(RoundedRectangle(cornerRadius: Self.cornerRadius).fill(Color(nsColor: .textBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: Self.cornerRadius).strokeBorder(.separator))
    }

    private var messageBinding: Binding<String> {
        Binding(get: { git.commitMessage }, set: { git.commitMessage = $0 })
    }
}

/// Eine geänderte Datei. Zeilen sind Buttons (keine Tap-Gesten an List-Zeilen, siehe CLAUDE.md).
private struct ChangeRow: View {
    private static let cornerRadius: CGFloat = 4

    let model: AppModel
    let change: GitChange

    @State private var isHovering = false

    private var git: GitStore { model.git }
    /// Dieser Diff ist im aktiven Tab zu sehen (gleiche Datei, gleiche Seite).
    private var isShown: Bool {
        guard let url = git.url(for: change), model.editor.tabs.active == .diff(url) else { return false }
        return git.diffs[url]?.showsStaged == change.isStaged
    }

    var body: some View {
        HStack(spacing: 6) {
            Button { model.showChange(change) } label: { label }
                .buttonStyle(.plain)
                // Doppelklick hält den Tab fest wie im Dateibaum (keine List-Auswahl, die geschluckt würde)
                .simultaneousGesture(TapGesture(count: 2).onEnded { model.showChange(change, keep: true) })
            if isHovering {
                resetButton
                stageButton
            }
            GitStatusBadge(kind: change.kind)
        }
        .padding(.horizontal, 4)
        .background(RoundedRectangle(cornerRadius: Self.cornerRadius).fill(isShown ? Color.accentColor.opacity(0.18) : .clear))
        .onHover { isHovering = $0 }
        .contextMenu { contextMenu }
        .help(help)
    }

    private var label: some View {
        HStack(spacing: 6) {
            Image(systemName: FileKind(url: URL(fileURLWithPath: change.path)).symbolName)
                .foregroundStyle(.secondary)
            Text(change.fileName)
                .lineLimit(1)
                .strikethrough(change.kind == .deleted)
            if !change.directory.isEmpty {
                Text(change.directory)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 4)
        }
        .contentShape(Rectangle())
    }

    private var resetButton: some View {
        Button("Auf letzten Commit zurücksetzen …", systemImage: "arrow.uturn.backward") {
            Task { await model.resetToLastCommit(file: git.url(for: change) ?? URL(fileURLWithPath: change.path)) }
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .disabled(git.isBusy || change.kind == .conflicted)
        .help("Datei auf den Stand des letzten Commits zurücksetzen …")
    }

    private var stageButton: some View {
        Button(change.isStaged ? "Zurücknehmen" : "Bereitstellen", systemImage: change.isStaged ? "minus" : "plus") {
            Task { await toggleStaging() }
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .disabled(git.isBusy)
        .help(change.isStaged ? "Zurücknehmen" : "Bereitstellen")
    }

    @ViewBuilder
    private var contextMenu: some View {
        Button("Änderungen anzeigen") { model.showChange(change, keep: true) }
        Button("Datei öffnen") { model.openChangedFile(change) }
            .disabled(change.kind == .deleted)
        Divider()
        Button(change.isStaged ? "Zurücknehmen" : "Bereitstellen") { Task { await toggleStaging() } }
        Button("Auf letzten Commit zurücksetzen …") {
            Task { await model.resetToLastCommit(file: git.url(for: change) ?? URL(fileURLWithPath: change.path)) }
        }
        .disabled(change.kind == .conflicted)
        Divider()
        Button("Im Finder zeigen") {
            guard let url = git.url(for: change) else { return }
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
        .disabled(change.kind == .deleted)
    }

    private func toggleStaging() async {
        if change.isStaged { await git.unstage([change]) } else { await git.stage([change]) }
    }

    private var help: String {
        guard let original = change.originalPath else { return "\(change.path) – \(change.kind.title)" }
        return "\(original) → \(change.path)"
    }
}
