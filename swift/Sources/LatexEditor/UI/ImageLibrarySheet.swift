import AppKit
import SwiftUI

/// Miniaturen im Speicher, damit das Raster beim Scrollen und erneuten Öffnen nicht neu lädt
@MainActor
enum ImageThumbnailCache {
    private static let cache = NSCache<NSString, NSImage>()

    static func image(for url: URL) -> NSImage? {
        cache.object(forKey: key(for: url))
    }

    static func store(_ image: NSImage, for url: URL) {
        cache.setObject(image, forKey: key(for: url))
    }

    /// Mit Änderungsdatum: Eine überschriebene Datei bekommt eine neue Miniatur
    private static func key(for url: URL) -> NSString {
        let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0
        return "\(url.path)#\(modified)" as NSString
    }
}

/// Bildbibliothek: alle Bilder des Projekts als Raster. Doppelklick oder „Einfügen …“ öffnet das Einfügen-Fenster mit dem
/// gewählten Bild (Breite, Beschriftung und Label stellt man dort ein).
struct ImageLibrarySheet: View {
    private static let size = NSSize(width: 760, height: 560)
    private static let cellWidth: CGFloat = 150

    let model: AppModel
    @State private var query = ""
    @State private var selection: URL?
    @FocusState private var isSearchFocused: Bool

    private var images: [URL] {
        let all = model.projectImages()
        guard !query.isEmpty else { return all }
        return all.filter { relativePath($0).localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .onAppear { isSearchFocused = true }
        .onExitCommand { model.palette.active = nil }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Bilder durchsuchen", text: $query)
                .textFieldStyle(.plain)
                .font(.title3)
                .focused($isSearchFocused)
                .onSubmit(insertSelection)
        }
        .padding(12)
    }

    @ViewBuilder
    private var content: some View {
        let shown = images
        if shown.isEmpty {
            EmptyStateView(
                query.isEmpty ? "Keine Bilder im Projekt" : "Kein passendes Bild",
                systemImage: "photo.on.rectangle",
                description: query.isEmpty ? "PNG, JPG und PDF aus dem Projektordner erscheinen hier. Dateien lassen sich auf den Dateibaum ziehen." : nil
            )
        } else {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: Self.cellWidth), spacing: 12)], spacing: 12) {
                    ForEach(shown, id: \.self) { url in
                        ImageLibraryCell(url: url, caption: relativePath(url), isSelected: url == selection)
                            .onTapGesture(count: 2) { insert(url) }
                            .onTapGesture { selection = url }
                    }
                }
                .padding(14)
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Text(countText).foregroundStyle(.secondary)
            Spacer()
            Button("Im Finder zeigen", systemImage: "folder") {
                if let selection { NSWorkspace.shared.activateFileViewerSelecting([selection]) }
            }
            .disabled(selection == nil)
            Button("Schließen") { model.palette.active = nil }
                .keyboardShortcut(.cancelAction)
            Button("Einfügen …", action: insertSelection)
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(selection == nil || !model.canPresentInsert(.image))
                .help(model.canPresentInsert(.image) ? "Das Bild mit Breite und Beschriftung einfügen" : "Dafür eine .tex-Datei im Editor öffnen")
        }
        .font(.callout)
        .controlSize(.large)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var countText: String {
        let count = images.count
        return count == 1 ? "1 Bild" : "\(count) Bilder"
    }

    private func relativePath(_ url: URL) -> String {
        guard let root = model.project.rootURL?.standardizedFileURL.path else { return url.lastPathComponent }
        let path = url.standardizedFileURL.path
        return path.hasPrefix(root + "/") ? String(path.dropFirst(root.count + 1)) : url.lastPathComponent
    }

    private func insertSelection() {
        if let selection { insert(selection) }
    }

    private func insert(_ url: URL) {
        guard model.canPresentInsert(.image) else { return }
        model.palette.active = nil
        model.presentInsertImage(url)
    }
}

private struct ImageLibraryCell: View {
    private static let thumbnailHeight: CGFloat = 110

    let url: URL
    let caption: String
    let isSelected: Bool

    @State private var thumbnail: NSImage?
    @State private var info: String?

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(.quaternary.opacity(0.5))
                if let thumbnail {
                    Image(nsImage: thumbnail).resizable().scaledToFit().padding(4)
                } else {
                    ProgressView().controlSize(.small)
                }
            }
            .frame(height: Self.thumbnailHeight)
            Text(url.lastPathComponent).font(.callout).lineLimit(1).truncationMode(.middle)
            Text(info ?? " ").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(6)
        .background(isSelected ? Color.accentColor.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 8))
        .overlay { if isSelected { RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor, lineWidth: 1.5) } }
        .contentShape(Rectangle())
        .help(caption)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(caption), \(info ?? "")")
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
        .task(id: url) { await load() }
    }

    private func load() async {
        let target = url
        if let cached = ImageThumbnailCache.image(for: target) {
            thumbnail = cached
        }
        let loaded = await Task.detached(priority: .utility) { ImagePreviewLoader.load(target, maxPixels: ImagePreviewLoader.thumbnailPixels) }.value
        guard target == url, let loaded else { return }
        ImageThumbnailCache.store(loaded.image, for: target)
        thumbnail = loaded.image
        info = "\(loaded.sizeText) · \(loaded.byteText)"
    }
}
