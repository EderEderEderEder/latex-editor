import AppKit
import SwiftUI
import UniformTypeIdentifiers

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

// MARK: - Gestaltungsbausteine

/// Gruppe zusammengehöriger Einstellungen auf einer Karte.
private struct SettingsCard<Content: View>: View {
    let title: String?
    let content: Content

    init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.separator.opacity(0.6)))
    }
}

/// Zeile mit festem Beschriftungsbereich links.
private let settingLabelWidth: CGFloat = 112

private struct SettingRow<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .foregroundStyle(.secondary)
                .frame(width: settingLabelWidth, alignment: .trailing)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct SettingsStack<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) { content }
    }
}

private struct CaptionCard: View {
    @Binding var caption: String
    @Binding var labelOverride: String
    @Binding var placement: FloatPlacement
    let automaticLabel: String
    /// Nur wo der Schalter allein die Beschriftung betrifft (Bild); bei Tabellen gilt er auch für die Zellen
    var escapeText: Binding<Bool>?

    var body: some View {
        SettingsCard("Beschriftung") {
            SettingRow("Text") {
                TextField("", text: $caption, prompt: Text("z. B. Ergebnisse der Messung"))
                    .textFieldStyle(.roundedBorder)
            }
            if let escapeText {
                SettingRow("") {
                    Toggle("Sonderzeichen maskieren", isOn: escapeText)
                }
            }
            SettingRow("Label") {
                TextField("", text: $labelOverride, prompt: Text(automaticLabel.isEmpty ? "wird aus dem Text erzeugt" : automaticLabel))
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
            }
            SettingRow("Platzierung") {
                Picker("", selection: $placement) {
                    ForEach(FloatPlacement.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
            }
        }
    }
}

private struct CodeEditorField: View {
    @Binding var text: String
    let minimumHeight: CGFloat

    var body: some View {
        TextEditor(text: $text)
            .font(.system(.body, design: .monospaced))
            .scrollContentBackground(.hidden)
            .padding(6)
            .frame(minHeight: minimumHeight)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
    }
}

// MARK: - Tabelle

private struct TableSettingsView: View {
    private static let cellWidth: CGFloat = 116

    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Aufbau") {
                SettingRow("Größe") {
                    HStack(spacing: 20) {
                        Stepper(value: rows, in: 1...TableSettings.maximumRows) {
                            Text("\(store.table.rows) Zeilen").monospacedDigit()
                        }
                        Stepper(value: columns, in: 1...TableSettings.maximumColumns) {
                            Text("\(store.table.columns) Spalten").monospacedDigit()
                        }
                    }
                }
                SettingRow("Optionen") {
                    HStack(spacing: 20) {
                        Toggle("Kopfzeile", isOn: $store.table.hasHeader)
                        Toggle("Sonderzeichen maskieren", isOn: $store.table.escapeText)
                    }
                }
                SettingRow("Linien") {
                    Picker("", selection: $store.table.rules) {
                        ForEach(TableRules.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
            }
            CaptionCard(
                caption: $store.table.caption, labelOverride: $store.table.labelOverride,
                placement: $store.table.placement, automaticLabel: store.resolvedLabel(for: .table)
            )
            SettingsCard("Inhalt") { grid }
        }
    }

    private var rows: Binding<Int> {
        Binding(get: { store.table.rows }, set: { store.table.resize(rows: $0, columns: store.table.columns) })
    }

    private var columns: Binding<Int> {
        Binding(get: { store.table.columns }, set: { store.table.resize(rows: store.table.rows, columns: $0) })
    }

    private var grid: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button("Aus Zwischenablage (Excel, Numbers)", systemImage: "doc.on.clipboard", action: pasteFromClipboard)
                Button("Zellen leeren", systemImage: "eraser") {
                    store.table.cells = store.table.cells.map { $0.map { _ in "" } }
                }
            }
            .controlSize(.small)
            ScrollView(.horizontal) {
                Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                    GridRow {
                        ForEach(0..<store.table.columns, id: \.self) { column in
                            Picker("", selection: alignment(column)) {
                                ForEach(ColumnAlignment.allCases) { Text($0.title).tag($0) }
                            }
                            .labelsHidden()
                            .controlSize(.small)
                            .frame(width: Self.cellWidth)
                            .help("Ausrichtung der Spalte \(column + 1)")
                        }
                    }
                    ForEach(0..<store.table.rows, id: \.self) { row in
                        GridRow {
                            ForEach(0..<store.table.columns, id: \.self) { column in
                                TextField("", text: cell(row, column))
                                    .textFieldStyle(.roundedBorder)
                                    .fontWeight(row == 0 && store.table.hasHeader ? .semibold : .regular)
                                    .multilineTextAlignment(textAlignment(column))
                                    .frame(width: Self.cellWidth)
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func cell(_ row: Int, _ column: Int) -> Binding<String> {
        Binding(
            get: {
                guard row < store.table.cells.count, column < store.table.cells[row].count else { return "" }
                return store.table.cells[row][column]
            },
            set: {
                guard row < store.table.cells.count, column < store.table.cells[row].count else { return }
                store.table.cells[row][column] = $0
            }
        )
    }

    private func alignment(_ column: Int) -> Binding<ColumnAlignment> {
        Binding(
            get: { column < store.table.alignments.count ? store.table.alignments[column] : .left },
            set: { if column < store.table.alignments.count { store.table.alignments[column] = $0 } }
        )
    }

    private func textAlignment(_ column: Int) -> TextAlignment {
        switch alignment(column).wrappedValue {
        case .left: .leading
        case .center: .center
        case .right: .trailing
        }
    }

    private func pasteFromClipboard() {
        guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else { return }
        store.table.fill(fromTabSeparated: text)
    }
}

// MARK: - Bild

private struct ImageSettingsView: View {
    private static let thumbnailSize: CGFloat = 96

    @Bindable var store: InsertStore
    @State private var isDropTargeted = false
    /// Einmal pro gewählter Datei geladen, nicht bei jeder Eingabe in der Beschriftung
    @State private var thumbnailImage: NSImage?

    var body: some View {
        SettingsStack {
            SettingsCard("Bild") {
                dropArea
                SettingRow("Aus dem Projekt") {
                    Picker("", selection: projectChoice) {
                        Text("—").tag(URL?.none)
                        ForEach(store.projectImages, id: \.self) { url in
                            Text(relativeName(url)).tag(URL?.some(url))
                        }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                SettingRow("Breite") {
                    HStack {
                        Slider(value: width, in: 10...100, step: 5)
                        Text("\(store.image.widthPercent) %")
                            .monospacedDigit()
                            .frame(width: 52, alignment: .trailing)
                    }
                }
            }
            CaptionCard(
                caption: $store.image.caption, labelOverride: $store.image.labelOverride,
                placement: $store.image.placement, automaticLabel: store.resolvedLabel(for: .image),
                escapeText: $store.image.escapeText
            )
        }
    }

    private var dropArea: some View {
        HStack(spacing: 14) {
            thumbnail
            VStack(alignment: .leading, spacing: 4) {
                if let file = store.image.file {
                    Text(file.lastPathComponent).font(.headline)
                    Text(store.isInsideProject(file)
                        ? "Liegt im Projekt und wird nicht kopiert."
                        : "Wird beim Einfügen nach „images/“ kopiert als „\(ImageImport.sanitizedName(file.lastPathComponent))“.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Bild hierher ziehen").font(.headline)
                    Text("PNG, JPG oder PDF – oder unten ein Bild aus dem Projekt wählen.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Button("Datei wählen …", systemImage: "folder", action: chooseFile)
                    .controlSize(.small)
                    .padding(.top, 2)
            }
            Spacer()
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: Self.thumbnailSize + 24)
        .background(isDropTargeted ? Color.accentColor.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(isDropTargeted ? Color.accentColor : Color.secondary.opacity(0.45),
                              style: StrokeStyle(lineWidth: 1.5, dash: [6]))
        )
        .onDrop(of: [.fileURL], isTargeted: $isDropTargeted, perform: handleDrop)
        .task(id: store.image.file) { thumbnailImage = store.image.file.flatMap(NSImage.init(contentsOf:)) }
    }

    @ViewBuilder
    private var thumbnail: some View {
        if store.image.file != nil, let image = thumbnailImage {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: Self.thumbnailSize, height: Self.thumbnailSize)
                .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
        } else {
            Image(systemName: "photo.badge.plus")
                .font(.system(size: 34))
                .foregroundStyle(.secondary)
                .frame(width: Self.thumbnailSize, height: Self.thumbnailSize)
        }
    }

    private var projectChoice: Binding<URL?> {
        Binding(
            get: { store.image.file.flatMap { store.projectImages.contains($0) ? $0 : nil } },
            set: { if let url = $0 { store.image.file = url } }
        )
    }

    private var width: Binding<Double> {
        Binding(get: { Double(store.image.widthPercent) }, set: { store.image.widthPercent = Int($0) })
    }

    private func relativeName(_ url: URL) -> String {
        guard let root = store.projectRoot else { return url.lastPathComponent }
        let prefix = root.standardizedFileURL.path + "/"
        return url.path.hasPrefix(prefix) ? String(url.path.dropFirst(prefix.count)) : url.lastPathComponent
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .pdf]
        panel.allowsMultipleSelection = false
        panel.message = "Bild für das Dokument wählen"
        panel.prompt = "Wählen"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        store.image.file = url
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        _ = provider.loadObject(ofClass: URL.self) { url, _ in
            guard let url else { return }
            Task { @MainActor in
                if ImageImport.isSupported(url) {
                    store.image.file = url
                    store.errorMessage = nil
                } else {
                    store.errorMessage = ImageImportError.unsupportedFormat(url.lastPathComponent).errorDescription
                }
            }
        }
        return true
    }
}

// MARK: - Code, Gleichung, Liste

private struct CodeSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Darstellung") {
                SettingRow("Sprache") {
                    Picker("", selection: $store.code.language) {
                        ForEach(CodeLanguage.all) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                SettingRow("Optionen") {
                    VStack(alignment: .leading, spacing: 6) {
                        Toggle("Zeilennummern", isOn: $store.code.lineNumbers)
                        Toggle("Als Programm-Float mit Beschriftung", isOn: $store.code.asFloat)
                    }
                }
            }
            if store.code.asFloat {
                CaptionCard(
                    caption: $store.code.caption, labelOverride: $store.code.labelOverride,
                    placement: $store.code.placement, automaticLabel: store.resolvedLabel(for: .code)
                )
            }
            SettingsCard("Code") {
                CodeEditorField(text: $store.code.content, minimumHeight: 130)
            }
        }
    }
}

private struct EquationSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Art") {
                SettingRow("Umgebung") {
                    Picker("", selection: $store.equation.kind) {
                        ForEach(EquationKind.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                if store.equation.kind.isNumbered {
                    SettingRow("Label") {
                        TextField("", text: $store.equation.labelOverride, prompt: Text("optional, z. B. eq:einstein"))
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.body, design: .monospaced))
                    }
                }
            }
            SettingsCard("Formel (ohne $ … $)") {
                CodeEditorField(text: $store.equation.content, minimumHeight: 130)
            }
        }
    }
}

private struct ListSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Art") {
                SettingRow("Liste") {
                    Picker("", selection: $store.list.kind) {
                        ForEach(ListKind.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                SettingRow("Punkte") {
                    Stepper(value: count, in: 1...ListSettings.maximumItems) {
                        Text("\(store.list.items.count)").monospacedDigit()
                    }
                }
            }
            SettingsCard("Texte (optional)") {
                ForEach(store.list.items.indices, id: \.self) { index in
                    SettingRow("\(index + 1).") {
                        TextField("", text: $store.list.items[index], prompt: Text("Punkt \(index + 1)"))
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }
        }
    }

    private var count: Binding<Int> {
        Binding(get: { store.list.items.count }, set: { store.list.resize(to: $0) })
    }
}

// MARK: - Verweis, Zitat

private struct ReferenceSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            if store.catalog.labels.isEmpty {
                SettingsCard {
                    Label("Im Projekt gibt es noch keine Labels. Tabellen, Bilder und Codeblöcke legen eines an.",
                          systemImage: "info.circle")
                        .foregroundStyle(.secondary)
                }
            } else {
                SettingsCard("Ziel") {
                    SettingRow("Label") {
                        Picker("", selection: $store.reference.label) {
                            ForEach(store.catalog.labels) { entry in
                                Text("\(entry.label)  (\(entry.file.lastPathComponent):\(entry.line))").tag(entry.label)
                            }
                        }
                        .labelsHidden()
                        .fixedSize()
                    }
                    SettingRow("Darstellung") {
                        Toggle("Mit Vorsatz („Abbildung~…“)", isOn: $store.reference.withPrefix)
                    }
                }
            }
        }
    }
}

private struct CitationSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Angaben") {
                SettingRow("Seite") {
                    TextField("", text: $store.citation.note, prompt: Text("optional, z. B. S.~12"))
                        .textFieldStyle(.roundedBorder)
                }
            }
            if store.catalog.bibEntries.isEmpty {
                SettingsCard {
                    HStack {
                        Label("Die Literaturdatei hat noch keine Einträge.", systemImage: "info.circle")
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Neue Quelle anlegen …", systemImage: InsertionKind.source.symbolName) { store.kind = .source }
                    }
                }
            } else {
                SettingsCard("Einträge (mehrere mit ⌘ oder ⇧ wählen)") {
                    List(store.catalog.bibEntries, selection: keys) { entry in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(entry.key).fontWeight(.semibold)
                            if !entry.title.isEmpty {
                                Text(entry.title).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .tag(entry.key)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .frame(height: 220)
                    .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
                }
            }
        }
    }

    private var keys: Binding<Set<String>> {
        Binding(
            get: { Set(store.citation.keys) },
            set: { selected in
                let order = store.catalog.bibEntries.map(\.key)
                store.citation.keys = order.filter(selected.contains)
            }
        )
    }
}

private struct SourceSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Eingabe") {
                Picker("", selection: $store.source.mode) {
                    ForEach(SourceInputMode.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            }
            if store.source.mode == .form { form } else { bibtex }
            SettingsCard("Im Text") {
                SettingRow("Zitieren") {
                    Toggle("Gleich an der Cursorposition zitieren (\\cite)", isOn: $store.source.citeAfterInsert)
                }
                if store.source.citeAfterInsert {
                    SettingRow("Seite") {
                        TextField("", text: $store.source.note, prompt: Text("optional, z. B. S.~12"))
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        SettingsCard("Art") {
            SettingRow("Typ") {
                Picker("", selection: $store.source.type) {
                    ForEach(SourceType.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
            }
            SettingRow("Sprache") {
                Picker("", selection: $store.source.language) {
                    ForEach(SourceLanguage.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
            }
        }
        SettingsCard("Angaben (* = Pflicht)") {
            SettingRow(store.source.type.requiresAuthor ? "Autor *" : "Autor") {
                TextField("", text: $store.source.authors, prompt: Text("Max Mustermann; Erika Musterfrau"))
                    .textFieldStyle(.roundedBorder)
            }
            ForEach(store.source.type.fields, id: \.name) { field in
                SettingRow(field.isRequired ? field.title + " *" : field.title) {
                    TextField("", text: value(field.name), prompt: Text(field.placeholder))
                        .textFieldStyle(.roundedBorder)
                }
            }
            SettingRow("Schlüssel") {
                TextField("", text: $store.source.keyOverride, prompt: Text(automaticKey))
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    private var bibtex: some View {
        SettingsCard("BibTeX-Eintrag") {
            VStack(alignment: .leading, spacing: 6) {
                CodeEditorField(text: $store.source.bibtex, minimumHeight: 180)
                Text("Z. B. aus Google Scholar („Zitieren“ → BibTeX), vom Verlag oder aus einem Bibliothekskatalog. "
                     + "Der Schlüssel wird bei Bedarf angepasst (eindeutig, ohne Umlaute).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var automaticKey: String {
        if case let .success(draft) = store.sourceDraft { return "automatisch: \(draft.key)" }
        return "automatisch (Nachname + Jahr)"
    }

    private func value(_ name: String) -> Binding<String> {
        Binding(get: { store.source.values[name, default: ""] }, set: { store.source.values[name] = $0 })
    }
}
