import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Tabelle

struct TableSettingsView: View {
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

struct ImageSettingsView: View {
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
