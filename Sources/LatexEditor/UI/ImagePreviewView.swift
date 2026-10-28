import AppKit
import SwiftUI

/// Vorschau einer Bilddatei (Popover im Dateibaum und im Text, Zelle der Bibliothek ohne Text): Bild, Name, Maße, Größe.
struct ImagePreviewView: View {
    private static let width: CGFloat = 340
    private static let imageHeight: CGFloat = 240

    let url: URL
    /// Pfad relativ zum Projekt, wenn bekannt
    var relativePath: String?

    @State private var info: ImagePreviewInfo?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            picture
            VStack(alignment: .leading, spacing: 2) {
                Text(url.lastPathComponent).font(.headline).lineLimit(1).truncationMode(.middle)
                Text(details).font(.callout).foregroundStyle(.secondary)
                if let relativePath, relativePath != url.lastPathComponent {
                    Text(relativePath).font(.caption).foregroundStyle(.tertiary).lineLimit(1).truncationMode(.head)
                }
            }
        }
        .padding(12)
        .frame(width: Self.width)
        .task(id: url) { await load() }
    }

    @ViewBuilder
    private var picture: some View {
        ZStack {
            // Karo-Grund: Transparenz bleibt sichtbar, ohne dass das Bild auf Weiß verschwindet
            RoundedRectangle(cornerRadius: 6).fill(.quaternary.opacity(0.5))
            if let info {
                Image(nsImage: info.image).resizable().scaledToFit().padding(4)
                    .accessibilityLabel("Vorschau von \(url.lastPathComponent)")
            } else if failed {
                Label("Keine Vorschau möglich", systemImage: "photo.badge.exclamationmark").foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .frame(height: Self.imageHeight)
    }

    private var details: String {
        guard let info else { return failed ? "Das Format lässt sich nicht lesen." : "Lädt …" }
        return "\(info.isVector ? "Vektor" : "Bild") · \(info.sizeText) · \(info.byteText)"
    }

    private func load() async {
        info = nil
        failed = false
        let target = url
        let loaded = await Task.detached(priority: .userInitiated) { ImagePreviewLoader.load(target) }.value
        guard target == url else { return }
        info = loaded
        failed = loaded == nil
    }
}

/// Zeigt `ImagePreviewView` als Popover an einer Stelle im Text (nur eines zugleich).
@MainActor
final class ImagePopoverPresenter: NSObject, NSPopoverDelegate {
    private var popover: NSPopover?
    private(set) var shownURL: URL?

    func present(_ url: URL, relativePath: String?, from view: NSView, at rect: NSRect) {
        guard shownURL != url else { return }
        close()
        let popover = NSPopover()
        popover.behavior = .semitransient
        popover.animates = false
        popover.delegate = self
        popover.contentViewController = NSHostingController(rootView: ImagePreviewView(url: url, relativePath: relativePath))
        self.popover = popover
        shownURL = url
        popover.show(relativeTo: rect, of: view, preferredEdge: .minY)
    }

    func close() {
        popover?.close()
        popover = nil
        shownURL = nil
    }

    func popoverDidClose(_ notification: Notification) {
        popover = nil
        shownURL = nil
    }
}
