import AppKit
import SwiftUI

/// Tab-Leiste über dem Editor. Vorschau-Tabs (kursiv) werden beim Öffnen einer anderen Datei ersetzt,
/// bis sie bearbeitet oder per Doppelklick festgehalten werden.
struct TabBar: View {
    private static let height: CGFloat = 30

    let model: AppModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(model.editor.tabs.items, id: \.self) { tab in
                        TabItem(model: model, tab: tab)
                            .id(tab)
                    }
                    Spacer(minLength: 0)
                }
            }
            .onChange(of: model.editor.tabs.active) { _, active in
                guard let active else { return }
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(active) }
            }
        }
        .frame(height: Self.height)
        .background(.bar)
    }
}

private struct TabItem: View {
    private static let minimumWidth: CGFloat = 90
    private static let maximumWidth: CGFloat = 200

    let model: AppModel
    let tab: EditorTab

    @State private var isHovering = false

    private var url: URL { tab.url }
    private var isDiff: Bool { tab.diffURL != nil }
    private var tabs: EditorTabs { model.editor.tabs }
    private var isActive: Bool { tabs.active == tab }
    private var isPreview: Bool { tabs.preview == tab }
    private var session: DocumentSession? { tab.fileURL.flatMap { model.editor.session(for: $0) } }
    private var isDirty: Bool { session?.isDirty == true }
    private var isMissing: Bool { session?.isMissingOnDisk == true }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: isDiff ? "plus.forwardslash.minus" : FileKind(url: url).symbolName)
                .font(.system(size: 11))
                .foregroundStyle(isActive ? Color.accentColor : .secondary)
            Text(url.lastPathComponent)
                .font(.callout)
                .italic(isPreview)
                .strikethrough(isMissing)
                .lineLimit(1)
                .truncationMode(.middle)
                .foregroundStyle(isActive ? .primary : .secondary)
            closeOrDirtyIndicator
        }
        .padding(.horizontal, 10)
        .frame(minWidth: Self.minimumWidth, maxWidth: Self.maximumWidth)
        .frame(maxHeight: .infinity)
        .background(isActive ? Color(nsColor: .textBackgroundColor) : (isHovering ? Color.primary.opacity(0.06) : .clear))
        .overlay(alignment: .trailing) { Divider() }
        .overlay(alignment: .top) {
            Rectangle().fill(Color.accentColor).frame(height: 2).opacity(isActive ? 1 : 0)
        }
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .onTapGesture { model.editor.activateTab(tab) }
        .simultaneousGesture(TapGesture(count: 2).onEnded { model.editor.keepTab(tab) })
        .contextMenu { contextMenu }
        .help(isDiff ? "Änderungen (Git): \(url.path)" : url.path)
        .draggable(TabDragItem(tab).encoded)
        .dropDestination(for: String.self) { items, _ in
            guard let dragged = items.first.flatMap(TabDragItem.decode) else { return false }
            model.editor.moveTab(dragged, onto: tab)
            return true
        }
        .accessibilityLabel(isDiff ? "Änderungen \(url.lastPathComponent)" : url.lastPathComponent)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    /// Ungespeichert: orangener Punkt, beim Darüberfahren das Schließen-Symbol.
    @ViewBuilder
    private var closeOrDirtyIndicator: some View {
        let showsClose = isHovering || (isActive && !isDirty)
        Button {
            model.closeTab(tab)
        } label: {
            if isDirty && !isHovering {
                Circle().fill(.orange).frame(width: 8, height: 8)
            } else {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .opacity(showsClose || isDirty ? 1 : 0)
            }
        }
        .buttonStyle(.plain)
        .frame(width: 16, height: 16)
        .help(isDirty ? "Schließen (ungespeicherte Änderungen)" : "Tab schließen (⌘W)")
    }

    @ViewBuilder
    private var contextMenu: some View {
        Button("Tab schließen") { model.closeTab(tab) }
        Button("Andere Tabs schließen") { model.closeOtherTabs(keeping: tab) }
            .disabled(tabs.items.count < 2)
        Button("Alle Tabs schließen") { model.closeAllTabs() }
        Divider()
        if isPreview { Button("Tab festhalten") { model.editor.keepTab(tab) } }
        if isDiff {
            Button("Datei öffnen") { Task { await model.editor.open(url, asPreview: false) } }
                .disabled(!FileManager.default.fileExists(atPath: url.path))
        }
        Button("Im Finder zeigen") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }
}

/// Tab beim Umsortieren per Ziehen, als Text („file:“ bzw. „diff:“ vor dem Pfad).
private struct TabDragItem {
    private static let filePrefix = "file:"
    private static let diffPrefix = "diff:"

    let tab: EditorTab

    init(_ tab: EditorTab) {
        self.tab = tab
    }

    var encoded: String {
        (tab.diffURL == nil ? Self.filePrefix : Self.diffPrefix) + tab.url.path
    }

    static func decode(_ text: String) -> EditorTab? {
        if text.hasPrefix(diffPrefix) { return .diff(URL(fileURLWithPath: String(text.dropFirst(diffPrefix.count)))) }
        if text.hasPrefix(filePrefix) { return .file(URL(fileURLWithPath: String(text.dropFirst(filePrefix.count)))) }
        return nil
    }
}
