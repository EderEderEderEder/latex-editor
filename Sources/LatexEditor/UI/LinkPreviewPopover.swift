import AppKit
import SwiftUI

struct LinkPreviewView: View {
    let preview: LinkPreviewRenderer.LinkPreview

    private static let padding: CGFloat = 10
    private static let captionSpacing: CGFloat = 6
    private static let borderCornerRadius: CGFloat = 4
    private static let borderWidth: CGFloat = 1

    var body: some View {
        VStack(spacing: Self.captionSpacing) {
            LinkPreviewScrollView(preview: preview)
                .frame(
                    width: LinkPreviewRenderer.imageWidth + LinkPreviewRenderer.scrollerWidth,
                    height: preview.viewportHeight
                )
                .clipShape(RoundedRectangle(cornerRadius: Self.borderCornerRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: Self.borderCornerRadius)
                        .strokeBorder(Color(nsColor: .separatorColor), lineWidth: Self.borderWidth)
                }
                .accessibilityLabel("Vorschau von Seite \(preview.pageNumber)")
            Text("Seite \(preview.pageNumber)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(Self.padding)
        .accessibilityElement(children: .combine)
    }
}

/// Bildlaufansicht mit sichtbarem Scrollbalken, die beim Öffnen das Linkziel zeigt. Eigene `NSScrollView` statt SwiftUI,
/// weil nur sie den Startversatz sofort und den Balken immer sichtbar (Legacy-Stil) liefert.
private struct LinkPreviewScrollView: NSViewRepresentable {
    let preview: LinkPreviewRenderer.LinkPreview

    func makeNSView(context: Context) -> NSScrollView {
        let imageSize = preview.image.size
        let viewportSize = CGSize(
            width: imageSize.width + LinkPreviewRenderer.scrollerWidth, height: preview.viewportHeight
        )
        let imageView = NSImageView(frame: CGRect(origin: .zero, size: imageSize))
        imageView.image = preview.image
        imageView.imageScaling = .scaleAxesIndependently
        let scrollView = NSScrollView(frame: CGRect(origin: .zero, size: viewportSize))
        scrollView.scrollerStyle = .legacy
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = false
        scrollView.drawsBackground = false
        scrollView.documentView = imageView
        // Das Dokument ist nicht gespiegelt: y zählt von unten
        let originY = imageSize.height - preview.initialScrollOffset - preview.viewportHeight
        scrollView.contentView.scroll(to: CGPoint(x: 0, y: max(originY, 0)))
        scrollView.reflectScrolledClipView(scrollView.contentView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {}
}

@MainActor
final class LinkPreviewPresenter: NSObject, NSPopoverDelegate {
    private var popover: NSPopover?

    var isShown: Bool { popover?.isShown ?? false }

    func show(_ preview: LinkPreviewRenderer.LinkPreview, relativeTo rect: NSRect, of view: NSView) {
        close()
        let host = NSHostingController(rootView: LinkPreviewView(preview: preview))
        let popover = NSPopover()
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self
        popover.contentViewController = host
        popover.contentSize = host.view.fittingSize
        popover.show(relativeTo: rect, of: view, preferredEdge: .maxY)
        self.popover = popover
    }

    func close() {
        popover?.close()
        popover = nil
    }

    /// Auch wenn sich das transiente Popover selbst schließt: Bild und Controller freigeben
    func popoverDidClose(_ notification: Notification) {
        guard let closed = notification.object as? NSPopover, closed === popover else { return }
        popover = nil
    }
}
