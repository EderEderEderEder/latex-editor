import SwiftUI

struct EditorPane: View {
    let model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            TabBar(model: model)
            Divider()
            if let diffURL = model.editor.tabs.active?.diffURL {
                DiffHeader(model: model, url: diffURL)
            } else {
                PathBar(model: model)
            }
            Divider()
            ZStack {
                // Der Editor bleibt bestehen; bei einem Diff-Tab hat er keine Sitzung (nicht editierbar),
                // Auswahl und Scrollposition der Dateien liegen in ihren Sitzungen.
                EditorContent(editor: model.editor, build: model.build, changeMarks: model.changeMarks,
                              completionProvider: model.completionProvider)
                if let diffURL = model.editor.tabs.active?.diffURL {
                    DiffView(git: model.git, url: diffURL)
                        .id(diffURL)
                }
            }
        }
    }
}

/// Eigene View, damit nur der Wechsel der Datei den Editor neu bewertet, nicht das Tippen.
private struct EditorContent: View {
    let editor: EditorStore
    let build: BuildStore
    let changeMarks: ChangeMarkStore
    let completionProvider: CompletionProvider

    var body: some View {
        ZStack {
            EditorTextView(
                session: editor.current,
                jump: editor.jumpRequest,
                insertRequest: editor.insertRequest,
                selectionProviderOwner: editor,
                issueMarks: editor.current.flatMap { build.marksByFile[$0.url] } ?? [:],
                changeMarks: editor.current.map { changeMarks.marks(for: $0.url) } ?? ChangeMarks(),
                completionProvider: completionProvider,
                completionRequest: editor.completionRequest,
                onCursorMoved: editor.reportCursor
            )
            if editor.current == nil, editor.tabs.active?.diffURL == nil {
                ContentUnavailableView(
                    "Keine Datei geöffnet",
                    systemImage: "doc.text",
                    description: Text("Eine Datei in der Seitenleiste auswählen.")
                )
                .background(.background)
            }
        }
    }
}

private struct PathBar: View {
    let model: AppModel

    var body: some View {
        HStack(spacing: 4) {
            if let session = model.editor.current {
                segments(for: session.url)
                if session.isDirty {
                    Circle()
                        .fill(.orange)
                        .frame(width: 8, height: 8)
                        .help("Ungespeicherte Änderungen (⌘S)")
                }
                if session.hasExternalChange {
                    ExternalChangeNotice(session: session)
                }
                if session.isMissingOnDisk {
                    Label("Gelöscht", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .help("Die Datei wurde außerhalb des Editors gelöscht. ⌘S legt sie neu an.")
                }
            } else {
                Text("—").foregroundStyle(.secondary)
            }
            Spacer()
        }
        .font(.callout)
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(.bar)
    }

    private func segments(for file: URL) -> some View {
        let chain = model.outline.includeChain(to: file, mainFile: model.project.mainFileURL)
        return ForEach(Array(chain.enumerated()), id: \.offset) { index, url in
            if index > 0 {
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button(url.lastPathComponent) {
                Task { await model.editor.open(url) }
            }
            .buttonStyle(.plain)
            .fontWeight(url == file ? .semibold : .regular)
        }
    }
}

/// Datei wurde auf der Platte geändert, während hier ungespeicherte Änderungen bestehen.
private struct ExternalChangeNotice: View {
    let session: DocumentSession

    var body: some View {
        HStack(spacing: 6) {
            Label("Auf der Platte geändert", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(.orange)
                .help("Die Datei wurde außerhalb des Editors geändert (z. B. durch Pull oder Branch-Wechsel), hier gibt es ungespeicherte Änderungen.")
            Button("Neu laden") { Task { await session.syncWithDisk(discardingChanges: true) } }
                .help("Version auf der Platte übernehmen, ungespeicherte Änderungen verwerfen")
            Button("Meine behalten") { Task { await session.keepLocalVersion() } }
                .help("Eigene Version behalten; ⌘S überschreibt dann die Datei auf der Platte")
        }
        .buttonStyle(.borderless)
        .lineLimit(1)
    }
}
