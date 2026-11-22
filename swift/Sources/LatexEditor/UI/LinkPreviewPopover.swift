import AppKit
import PDFKit
import SwiftUI

struct LinkPreviewView: View {
    let pdfView: PDFView
    /// Zielseite des Links, 1-basiert
    let pageNumber: Int
    let viewportSize: CGSize

    private static let padding: CGFloat = 10
    private static let captionSpacing: CGFloat = 6
    private static let borderCornerRadius: CGFloat = 4
    private static let borderWidth: CGFloat = 1

    var body: some View {
        VStack(spacing: Self.captionSpacing) {
            LinkPreviewPDFRepresentable(pdfView: pdfView)
                .frame(width: viewportSize.width, height: viewportSize.height)
                .clipShape(RoundedRectangle(cornerRadius: Self.borderCornerRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: Self.borderCornerRadius)
                        .strokeBorder(Color(nsColor: .separatorColor), lineWidth: Self.borderWidth)
                        .allowsHitTesting(false)
                }
                .accessibilityLabel("Vorschau ab Seite \(pageNumber)")
            Text("Seite \(pageNumber)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(Self.padding)
    }
}

/// Die fertig eingerichtete Vorschau-View (`LinkPreviewPDFView.make`) unverändert in SwiftUI einsetzen
private struct LinkPreviewPDFRepresentable: NSViewRepresentable {
    let pdfView: PDFView

    func makeNSView(context: Context) -> PDFView { pdfView }

    func updateNSView(_ view: PDFView, context: Context) {}
}

/// Eingebettete PDF-Ansicht der Vorschau: zeigt dasselbe `PDFDocument` wie die Hauptansicht, durchgehend scrollbar.
/// Eine einfache `PDFView` (keine `SyncTeXPDFView`): Ohne Store, Verlauf und Beobachter ändert sie den Zustand der
/// Hauptansicht nicht; ein Klick auf einen Link darin lässt nur die Vorschau springen.
@MainActor
enum LinkPreviewPDFView {
    static func make(showing start: PDFDestination, size: CGSize, scale: CGFloat) -> PDFView? {
        guard let document = start.page?.document else { return nil }
        let view = PDFView(frame: CGRect(origin: .zero, size: size))
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        view.autoScales = false
        view.document = document
        view.scaleFactor = scale
        showVerticalScroller(in: view)
        moveToStart(view, start)
        return view
    }

    /// `go(to:)` braucht das Layout der endgültigen Größe
    static func moveToStart(_ view: PDFView, _ start: PDFDestination) {
        guard view.document != nil else { return }
        view.layoutDocumentView()
        view.go(to: start)
    }

    /// Immer sichtbarer Balken (Legacy-Stil): Er zeigt, dass und wie weit die Vorschau scrollt. PDFKit bietet dafür
    /// keine Eigenschaft, deshalb an der eigenen `NSScrollView` in der Unterhierarchie der PDFView.
    static func showVerticalScroller(in view: PDFView) {
        guard let scrollView = enclosedScrollView(in: view) else { return }
        scrollView.scrollerStyle = .legacy
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = false
    }

    static func enclosedScrollView(in view: NSView) -> NSScrollView? {
        for subview in view.subviews {
            if let scrollView = subview as? NSScrollView { return scrollView }
            if let scrollView = enclosedScrollView(in: subview) { return scrollView }
        }
        return nil
    }
}

@MainActor
final class LinkPreviewPresenter: NSObject, NSPopoverDelegate {
    private var popover: NSPopover?
    private var previewView: PDFView?

    var isShown: Bool { popover?.isShown ?? false }

    /// Vorschau des Linkziels am Rechteck `rect` (Koordinaten der Hauptansicht); Größe und Zoom nach der Hauptansicht
    @discardableResult
    func show(_ destination: PDFDestination, from mainView: PDFView, relativeTo rect: NSRect) -> Bool {
        close()
        let size = LinkPreviewLayout.viewportSize(forMainViewSize: mainView.bounds.size)
        let scale = LinkPreviewLayout.scale(forMainScale: mainView.scaleFactor)
        guard let page = destination.page, let document = page.document,
              let start = LinkPreviewLayout.startDestination(for: destination),
              let pdfView = LinkPreviewPDFView.make(showing: start, size: size, scale: scale) else { return false }
        let content = LinkPreviewView(pdfView: pdfView, pageNumber: document.index(for: page) + 1, viewportSize: size)
        let popover = makePopover(showing: content)
        popover.show(relativeTo: rect, of: mainView, preferredEdge: .maxY)
        self.popover = popover
        previewView = pdfView
        // Im Popover-Fenster kann SwiftUI die View noch einmal einsetzen: einen Durchlauf später erneut ans Ziel
        DispatchQueue.main.async { [weak pdfView] in
            guard let pdfView else { return }
            LinkPreviewPDFView.moveToStart(pdfView, start)
        }
        return true
    }

    private func makePopover(showing content: LinkPreviewView) -> NSPopover {
        let host = NSHostingController(rootView: content)
        let popover = NSPopover()
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self
        popover.contentViewController = host
        popover.contentSize = host.view.fittingSize
        return popover
    }

    func close() {
        popover?.close()
        release()
    }

    /// Auch wenn sich das transiente Popover selbst schließt: View und Controller freigeben
    func popoverDidClose(_ notification: Notification) {
        guard let closed = notification.object as? NSPopover, closed === popover else { return }
        release()
    }

    /// Ohne Dokument hält die Vorschau das mit der Hauptansicht geteilte `PDFDocument` nicht fest
    private func release() {
        previewView?.document = nil
        previewView = nil
        popover = nil
    }
}
