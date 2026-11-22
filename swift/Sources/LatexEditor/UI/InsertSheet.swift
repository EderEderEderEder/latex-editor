import AppKit
import SwiftUI

/// Einfügen-Fenster: links die Bausteine (Systemliste), in der Mitte die Einstellungen, rechts die Vorschau an Ort und
/// Stelle – der erzeugte Code zwischen den echten Zeilen um den Cursor, neue Zeilen mit dem grünen Streifen der
/// Git-Marken. Ohne .tex vorne (Quelle) zeigt die Vorschau nur den Eintrag.
struct InsertSheet: View {
    private static let size = NSSize(width: 1100, height: 700)
    private static let sidebarWidth: CGFloat = 200
    private static let previewWidth: CGFloat = 400

    @Bindable var store: InsertStore
    let canInsert: Bool
    let insert: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                KindList(store: store)
                    .frame(width: Self.sidebarWidth)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        settings
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color(nsColor: .windowBackgroundColor))
                Divider()
                InsertionPreview(store: store)
                    .frame(width: Self.previewWidth)
            }
            Divider()
            footer
        }
        .frame(width: Self.size.width, height: Self.size.height)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(store.kind.title).font(.title2.weight(.semibold))
            Text(store.kind.summary).font(.callout).foregroundStyle(.secondary)
        }
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
            } else {
                Label(destination, systemImage: store.kind == .source ? "books.vertical" : "text.cursor")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Abbrechen") { store.isPresented = false }
                .keyboardShortcut(.cancelAction)
            // Eine Quelle landet in der .bib, nicht an der Cursorposition
            Button(store.kind == .source ? "Quelle anlegen" : "Einfügen", action: insert)
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(blocker != nil)
        }
        .font(.callout)
        .controlSize(.large)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    /// Wohin der Code geht, so konkret wie möglich
    private var destination: String {
        if store.kind == .source, let file = store.bibliographyFile {
            return "Neuer Eintrag in \(file.lastPathComponent)" + (store.source.citeAfterInsert ? ", Zitat an der Cursorposition" : "")
        }
        guard let context = store.context else { return "Wird an der Cursorposition eingefügt." }
        return "Einfügen in \(context.fileName), Zeile \(context.cursorLineNumber)"
    }

    private var blocker: String? {
        store.blocker(canInsertIntoEditor: canInsert)
    }
}

// MARK: - Bausteine

private extension InsertionKind {
    static let blocks: [InsertionKind] = [.table, .image, .code, .equation, .list]
    static let references: [InsertionKind] = [.reference, .citation, .source]
}

/// Systemliste in zwei Gruppen; nur die Auswahl trägt die Akzentfarbe (vorher acht verschiedene Kachelfarben ohne Bedeutung)
private struct KindList: View {
    @Bindable var store: InsertStore

    var body: some View {
        List(selection: selection) {
            Section("Blöcke") { rows(InsertionKind.blocks) }
            Section("Verweise und Quellen") { rows(InsertionKind.references) }
        }
        .listStyle(.sidebar)
    }

    private func rows(_ kinds: [InsertionKind]) -> some View {
        ForEach(kinds) { kind in
            Label(kind.title, systemImage: kind.symbolName).tag(kind)
        }
    }

    private var selection: Binding<InsertionKind?> {
        Binding(get: { store.kind }, set: { if let kind = $0 { store.kind = kind } })
    }
}

// MARK: - Vorschau an Ort und Stelle

private struct InsertionPreview: View {
    private static let fontSize: CGFloat = 12
    private static let numberWidth: CGFloat = 34
    private static let barWidth: CGFloat = 3
    private static let barPadding: CGFloat = 6
    /// Umgebende Zeilen treten zurück, damit der neue Code auffällt
    private static let contextOpacity: CGFloat = 0.5

    let store: InsertStore

    var body: some View {
        let lines = store.previewLines
        let rows = Self.highlightedRows(lines, language: store.kind == .source ? .bibtex : .latex)
        let hasContext = store.context != nil && store.kind != .source
        VStack(spacing: 0) {
            HStack {
                Label(title, systemImage: "doc.text").font(.callout.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Button("Kopieren", systemImage: "doc.on.doc", action: copy)
                    .buttonStyle(.borderless)
                    .help("Nur den erzeugten Code kopieren")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(Array(zip(lines.indices, rows)), id: \.0) { index, text in
                            row(lines[index], text: text, dimmed: hasContext && !lines[index].isNew)
                                .id(index)
                        }
                    }
                    .padding(.vertical, 10)
                }
                .onAppear { scrollToNewCode(lines, proxy: proxy) }
                .onChange(of: store.kind) { scrollToNewCode(store.previewLines, proxy: proxy) }
            }
        }
        .background(Color(nsColor: EditorTheme.background))
    }

    private var title: String {
        if store.kind == .source { return store.bibliographyFile.map { "Neuer Eintrag in \($0.lastPathComponent)" } ?? "BibTeX-Eintrag" }
        return store.context.map { "Vorschau in \($0.fileName)" } ?? "LaTeX-Code"
    }

    private func row(_ line: InsertionContext.Line, text: AttributedString, dimmed: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text("\(line.number)")
                .font(.system(size: Self.fontSize - 1).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: Self.numberWidth, alignment: .trailing)
            Text(text)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .opacity(dimmed ? Self.contextOpacity : 1)
                .padding(.leading, Self.barWidth + 2 * Self.barPadding)
                // Als Hintergrund: so hoch wie die Zeile (ein eigenes Rechteck in der Zeile wuchs in der ScrollView)
                .background(alignment: .leading) {
                    if line.isNew {
                        Rectangle().fill(Color(nsColor: .systemGreen)).frame(width: Self.barWidth).padding(.leading, Self.barPadding)
                    }
                }
        }
        .padding(.trailing, 12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(line.isNew ? "Neu, Zeile \(line.number): \(line.text)" : "Zeile \(line.number): \(line.text)")
    }

    private func scrollToNewCode(_ lines: [InsertionContext.Line], proxy: ScrollViewProxy) {
        guard let first = lines.firstIndex(where: \.isNew) else { return }
        proxy.scrollTo(max(0, first - InsertionContext.surroundingLines), anchor: .top)
    }

    /// Zeilen mit den Farben des Editors (gewähltes Schema und Schrift), einmal für den ganzen Ausschnitt gefärbt
    private static func highlightedRows(_ lines: [InsertionContext.Line], language: SyntaxLanguage) -> [AttributedString] {
        let text = lines.map(\.text).joined(separator: "\n")
        let font = EditorSettings.font(size: fontSize)
        let storage = NSTextStorage(string: text, attributes: [.font: font, .foregroundColor: EditorTheme.text])
        let source = text as NSString
        var highlighter = SyntaxHighlighter(language: language)
        let tokens = highlighter.highlightAll(source, lines: LineIndex(text: source))
        SyntaxTheme.apply(tokens, in: NSRange(location: 0, length: storage.length), to: storage)
        var location = 0
        return lines.map { line in
            let length = (line.text as NSString).length
            let slice = storage.attributedSubstring(from: NSRange(location: location, length: length))
            location += length + 1
            // Leere Zeilen behalten die Zeilenhöhe
            guard length > 0 else { return AttributedString(" ") }
            return (try? AttributedString(slice, including: \.appKit)) ?? AttributedString(line.text)
        }
    }

    private func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(store.preview, forType: .string)
    }
}
