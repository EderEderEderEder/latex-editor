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
                              showInPDFHandler: model.showInPDF(file:line:),
                              topLineHandler: { model.outline.updateViewport(file: $0, topLine: $1) },
                              usageLoader: { await model.usages(of: $0) },
                              imageResolver: { model.resolveGraphics($0, from: $1) },
                              openUsageHandler: { entry in Task { await model.editor.open(entry.file, line: entry.line) } })
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
    let topLineHandler: (URL, Int) -> Void
    let usageLoader: (RenameSubject) async -> [UsageEntry]
    let imageResolver: (String, URL) -> URL?
    let openUsageHandler: (UsageEntry) -> Void

    @AppStorage(WritingHints.enabledKey) private var showsWritingHints = true
    @AppStorage(SyntaxChecker.enabledKey) private var showsErrorsInText = true

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
                diagnostics: showsErrorsInText ? editor.current.map { referenceChecks.diagnostics(for: $0.url) } ?? [] : [],
                underlinesBuildIssues: showsErrorsInText,
                completionProvider: completionProvider,
                completionRequest: editor.completionRequest,
                onCursorMoved: editor.reportCursor,
                onTopLineChanged: topLineHandler,
                onJumpToTarget: jumpHandler,
                renameScopes: renameScopes,
                onRename: renameHandler,
                usageLoader: usageLoader,
                onOpenUsage: openUsageHandler,
                imageResolver: imageResolver,
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

/// Der Abschnitt an der obersten sichtbaren Zeile, von außen nach innen („Einleitung › Motivation“), rechts in der
/// Pfadleiste: Beim Scrollen bleibt der Titel des Abschnitts stehen, auch wenn seine Überschrift schon oben hinausgewandert
/// ist. Bewusst keine Auflage auf dem Text und keine eigene Zeile: Nichts verdeckt die oberste Zeile, nichts springt.
private struct SectionCrumbs: View {
    let model: AppModel

    var body: some View {
        let chain = model.outline.sectionChain
        HStack(spacing: 4) {
            ForEach(Array(chain.enumerated()), id: \.element.id) { index, entry in
                if index > 0 {
                    Image(systemName: "chevron.right").scaledFont(.caption2).foregroundStyle(.tertiary)
                }
                Button(entry.title) { Task { await model.editor.open(entry.fileURL, line: entry.line) } }
                    .buttonStyle(.plain)
                    .foregroundStyle(index == chain.count - 1 ? .primary : .secondary)
                    .fontWeight(index == chain.count - 1 ? .medium : .regular)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help("Zur Überschrift „\(entry.title)“ springen")
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .trailing)
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Aktueller Abschnitt")
    }
}

private struct PathBar: View {
    private static let sectionGap: CGFloat = 8
    private static let height: CGFloat = 26
    private static let dotSize: CGFloat = 8

    let model: AppModel
    @AppStorage(EditorSettings.Key.showsStickyHeading) private var showsSection = true
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
            Spacer(minLength: Self.sectionGap)
                // Als Auflage: Die Abschnittsanzeige hängt vom Scrollen ab und darf die Breite nie beeinflussen. Sonst
                // ändert sie die Editorbreite, der Umbruch ändert die oberste Zeile, die wieder den Abschnitt – eine Schleife.
                .overlay(alignment: .trailing) {
                    if showsSection, model.editor.current != nil { SectionCrumbs(model: model) }
                }
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
