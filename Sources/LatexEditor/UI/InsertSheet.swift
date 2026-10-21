import AppKit
import SwiftUI

/// Einfügen-Fenster: links die Bausteine, rechts Einstellungen in Karten, darunter die Vorschau des LaTeX-Codes.
struct InsertSheet: View {
    private static let sidebarWidth: CGFloat = 230
    private static let previewHeight: CGFloat = 120

    @Bindable var store: InsertStore
    let canInsert: Bool
    let insert: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                KindSidebar(store: store)
                    .frame(width: Self.sidebarWidth)
                Divider()
                VStack(spacing: 0) {
                    header
                    Divider()
                    ScrollView {
                        settings
                            .padding(20)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Divider()
                    CodePreview(text: store.preview, language: store.kind == .source ? .bibtex : .latex)
                        .frame(height: Self.previewHeight)
                }
                .background(Color(nsColor: .windowBackgroundColor))
            }
            Divider()
            footer
        }
        .frame(width: 960, height: 740)
    }

    private var header: some View {
        HStack(spacing: 12) {
            KindBadge(kind: store.kind, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.kind.title).font(.title2.weight(.semibold))
                Text(store.kind.summary).font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private var settings: some View {
        switch store.kind {
        case .table: TableSettingsView(store: store)
        case .image: ImageSettingsView(store: store)
        case .code: CodeSettingsView(store: store)
        case .equation: EquationSettingsView(store: store)
        case .list: ListSettingsView(store: store)
        case .reference: ReferenceSettingsView(store: store)
        case .citation: CitationSettingsView(store: store)
        case .source: SourceSettingsView(store: store)
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if let message = store.errorMessage {
                Label(message, systemImage: "xmark.octagon.fill").foregroundStyle(.red)
            } else if let message = blocker {
                Label(message, systemImage: "info.circle").foregroundStyle(.secondary)
            } else if store.kind == .source, let file = store.bibliographyFile {
                Label("Neuer Eintrag in \(file.lastPathComponent)" + (store.source.citeAfterInsert ? ", Zitat an der Cursorposition" : ""),
                      systemImage: "books.vertical")
                    .foregroundStyle(.secondary)
            } else {
                Label("Wird an der Cursorposition eingefügt.", systemImage: "text.cursor")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Abbrechen") { store.isPresented = false }
                .keyboardShortcut(.cancelAction)
            Button(action: insert) {
                // Eine Quelle landet in der .bib, nicht an der Cursorposition
                Label(store.kind == .source ? "Quelle anlegen" : "Einfügen",
                      systemImage: store.kind == .source ? "books.vertical" : "arrow.down.doc")
                    .padding(.horizontal, 6)
            }
            .keyboardShortcut(.defaultAction)
            .buttonStyle(.borderedProminent)
            .disabled(blocker != nil)
        }
        .font(.callout)
        .controlSize(.large)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private var blocker: String? {
        store.blocker(canInsertIntoEditor: canInsert)
    }
}

// MARK: - Bausteine (Seitenleiste)

private extension InsertionKind {
    var tint: Color {
        switch self {
        case .table: .blue
        case .image: .green
        case .code: .purple
        case .equation: .orange
        case .list: .teal
        case .reference: .indigo
        case .citation: .pink
        case .source: .brown
        }
    }
}

private struct KindBadge: View {
    let kind: InsertionKind
    let size: CGFloat

    var body: some View {
        Image(systemName: kind.symbolName)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                    .fill(LinearGradient(colors: [kind.tint.opacity(0.85), kind.tint], startPoint: .top, endPoint: .bottom))
            )
    }
}

private struct KindSidebar: View {
    @Bindable var store: InsertStore

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Einfügen")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 14)
                .padding(.bottom, 4)
            ForEach(InsertionKind.allCases) { kind in
                Button { store.kind = kind } label: {
                    HStack(spacing: 10) {
                        KindBadge(kind: kind, size: 28)
                        Text(kind.title).fontWeight(store.kind == kind ? .semibold : .regular)
                        Spacer()
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(store.kind == kind ? Color.accentColor.opacity(0.18) : .clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 6)
            }
            Spacer()
        }
        .frame(maxHeight: .infinity)
        .background(.bar)
    }
}

// MARK: - Vorschau

/// Der erzeugte LaTeX-Code (bzw. BibTeX-Eintrag) mit denselben Farben wie im Editor.
private struct CodePreview: View {
    private static let fontSize: CGFloat = 12

    let text: String
    let language: SyntaxLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label(language == .bibtex ? "BibTeX-Eintrag" : "LaTeX-Code", systemImage: "chevron.left.forwardslash.chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Kopieren", systemImage: "doc.on.doc", action: copy)
                    .buttonStyle(.borderless)
                    .controlSize(.small)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            Divider()
            ScrollView(.vertical) {
                Text(highlighted)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    private var highlighted: AttributedString {
        let font = NSFont.monospacedSystemFont(ofSize: Self.fontSize, weight: .regular)
        let storage = NSTextStorage(string: text, attributes: [.font: font, .foregroundColor: NSColor.textColor])
        let source = text as NSString
        let lines = LineIndex(text: source)
        var highlighter = SyntaxHighlighter(language: language)
        let tokens = highlighter.highlightAll(source, lines: lines)
        SyntaxTheme.apply(tokens, in: NSRange(location: 0, length: storage.length), to: storage)
        return (try? AttributedString(storage, including: \.appKit)) ?? AttributedString(text)
    }

    private func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
