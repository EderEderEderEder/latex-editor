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
                              completionProvider: model.completionProvider, referenceChecks: model.referenceChecks,
                              jumpHandler: model.jump(to:), renameScopes: { model.renameScopes(at: $1, in: $0) },
                              renameHandler: { model.beginRename($0) },
                              showInPDFHandler: model.showInPDF(file:line:))
                if let diffURL = model.editor.tabs.active?.diffURL {
                    DiffView(git: model.git, url: diffURL)
                        .id(diffURL)
                }
            }
            if let session = model.editor.current {
                Divider()
                EditorStatusBar(editor: model.editor, counts: model.wordCounts, session: session)
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
    let referenceChecks: ReferenceCheckStore
    let jumpHandler: (JumpTarget) -> Void
    let renameScopes: (DocumentSession, Int) -> [RenameScope]
    let renameHandler: (RenameScope) -> Void
    let showInPDFHandler: (URL, Int) -> Void

    @AppStorage(WritingHints.enabledKey) private var showsWritingHints = true

    var body: some View {
        ZStack {
            EditorTextView(
                session: editor.current,
                jump: editor.jumpRequest,
                insertRequest: editor.insertRequest,
                selectionProviderOwner: editor,
                issueMarks: editor.current.flatMap { build.marksByFile[$0.url] } ?? [:],
                issueMessages: editor.current.flatMap { build.messagesByFile[$0.url] } ?? [:],
                changeMarks: editor.current.map { changeMarks.marks(for: $0.url) } ?? ChangeMarks(),
                referenceProblems: editor.current.map { referenceChecks.problems(for: $0.url) } ?? [],
                writingHints: showsWritingHints ? editor.current.map { referenceChecks.hints(for: $0.url) } ?? [] : [],
                completionProvider: completionProvider,
                completionRequest: editor.completionRequest,
                onCursorMoved: editor.reportCursor,
                onJumpToTarget: jumpHandler,
                renameScopes: renameScopes,
                onRename: renameHandler,
                onShowInPDF: showInPDFHandler
            )
            if editor.current == nil, editor.tabs.active?.diffURL == nil {
                EmptyStateView(
                    "Keine Datei geöffnet",
                    systemImage: "doc.text",
                    description: "Eine Datei in der Seitenleiste auswählen."
                )
                .background(.background)
            }
        }
    }
}

private struct PathBar: View {
    private static let height: CGFloat = 26
    private static let dotSize: CGFloat = 8

    let model: AppModel
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        HStack(spacing: 4) {
            if let session = model.editor.current {
                segments(for: session.url)
                if session.isDirty {
                    Circle()
                        .fill(.orange)
                        .frame(width: Self.dotSize * scale, height: Self.dotSize * scale)
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
        .scaledFont(.callout)
        .padding(.horizontal, 10)
        .frame(height: Self.height * scale)
        .background(.bar)
    }

    private func segments(for file: URL) -> some View {
        let chain = model.outline.includeChain(to: file, mainFile: model.project.mainFileURL)
        return ForEach(Array(chain.enumerated()), id: \.offset) { index, url in
            if index > 0 {
                Image(systemName: "chevron.right")
                    .scaledFont(.caption2)
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
