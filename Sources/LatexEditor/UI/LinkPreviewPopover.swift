import AppKit
import SwiftUI

struct LinkPreviewView: View {
    let preview: LinkPreviewRenderer.LinkPreview

    private static let padding: CGFloat = 10
    private static let captionSpacing: CGFloat = 6
    private static let imageCornerRadius: CGFloat = 4
    private static let imageBorderWidth: CGFloat = 1

    var body: some View {
        VStack(spacing: Self.captionSpacing) {
            Image(nsImage: preview.image)
                .frame(width: preview.image.size.width, height: preview.image.size.height)
                .clipShape(RoundedRectangle(cornerRadius: Self.imageCornerRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: Self.imageCornerRadius)
                        .strokeBorder(Color(nsColor: .separatorColor), lineWidth: Self.imageBorderWidth)
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
