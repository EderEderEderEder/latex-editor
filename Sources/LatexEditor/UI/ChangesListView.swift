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
    private static let fontSize: CGFloat = 11

    let kind: GitChangeKind

    var body: some View {
        Text(kind.letter)
            .scaledFont(size: Self.fontSize, weight: .semibold, design: .monospaced)
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
            EmptyStateView(
                "Kein Git-Repository", systemImage: "arrow.triangle.branch",
                description: "Der Projektordner gehört zu keinem Git-Repository."
            )
        case let .unavailable(message):
            EmptyStateView("Git nicht verfügbar", systemImage: "exclamationmark.triangle", description: message)
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
            EmptyStateView("Keine Änderungen", systemImage: "checkmark.circle", description: "Alles ist committet.")
        } else if filtered(git.staged).isEmpty && filtered(git.unstaged).isEmpty {
            NoFilterMatches(filter: filter)
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
                // Das Zurücksetzen aller Dateien steht bewusst nur im Rechtsklickmenü, nicht als Symbol
                // neben „Alle bereitstellen“: ↶ liest man leicht als harmloses „Rückgängig“.
                HStack {
                    Text("\(title) (\(changes.count))")
                        .scaledFont(.subheadline, weight: .semibold)
                    Spacer()
                    Button(actionTitle, systemImage: symbol, action: action)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .disabled(git.isBusy)
                        .help(actionTitle)
                }
                .contentShape(Rectangle())
                .contextMenu {
                    Button(actionTitle, action: action)
                    Divider()
                    Button("Alle auf letzten Commit zurücksetzen …", action: resetAll)
                        .disabled(git.isBusy)
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
        .scaledFont(.callout)
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
                    .help("Stand des Remotes abrufen (ändert keine Dateien)")
            }
        }
        .buttonStyle(.borderless)
        .scaledFont(.caption)
        .disabled(git.isBusy)
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
    }
}

private struct CommitBox: View {
    private static let editorHeight: CGFloat = 54
    private static let cornerRadius: CGFloat = 6

    let model: AppModel
    @Environment(\.interfaceScale) private var scale

    private var git: GitStore { model.git }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            messageEditor
            HStack(spacing: 6) {
                if git.stagedOutsideProject > 0 {
                    Text("+ \(git.stagedOutsideProject) außerhalb")
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                        .help("Bereitgestellte Dateien außerhalb des Projektordners werden mitcommittet.")
                }
                Spacer()
                // Läuft ein Pull/Push, zeigt die Leiste darunter (nur mit Remote) schon den Fortschritt
                if git.isBusy, git.activity == nil || !git.hasRemote { ProgressView().controlSize(.small) }
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
                .scaledFont(.callout)
                .scrollContentBackground(.hidden)
            if git.commitMessage.isEmpty {
                Text("Commit-Nachricht")
                    .scaledFont(.callout)
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 5)
                    .allowsHitTesting(false)
            }
        }
        .frame(height: Self.editorHeight * scale)
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
        // `.sidebar`-Listen ignorieren die vererbte Schrift, deshalb an jeder Zeile
        .scaledFont(.body)
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
            // In Buttons einer `.sidebar`-Liste greift auch die Schrift der Zeile nicht, deshalb direkt am Text
            Text(change.fileName)
                .scaledFont(.body)
                .lineLimit(1)
                .strikethrough(change.kind == .deleted)
            if !change.directory.isEmpty {
                Text(change.directory)
                    .scaledFont(.caption)
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
