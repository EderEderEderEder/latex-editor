import SwiftUI

/// Zustand der „Vorschau“ der eingeklappten Seitenleiste: Sie erscheint, solange die Maus auf dem Seitenleisten-Button
/// oder auf der Vorschau selbst ist. Kurze Verzögerung beim Ausblenden, damit die Maus vom Button (Toolbar) zur
/// Vorschau (darunter) wechseln kann, ohne dass sie dazwischen verschwindet.
@MainActor
@Observable
final class SidebarPeek {
    enum Zone {
        case button
        case panel
    }

    static let defaultHideDelay: Duration = .milliseconds(200)

    private(set) var isShown = false
    private var zonesUnderMouse: Set<Zone> = []
    private var hideTask: Task<Void, Never>?
    private let hideDelay: Duration

    init(hideDelay: Duration = SidebarPeek.defaultHideDelay) {
        self.hideDelay = hideDelay
    }

    func hover(_ zone: Zone, inside: Bool) {
        if inside { zonesUnderMouse.insert(zone) } else { zonesUnderMouse.remove(zone) }
        hideTask?.cancel()
        if !zonesUnderMouse.isEmpty {
            isShown = true
            return
        }
        hideTask = Task { [hideDelay] in
            try? await Task.sleep(for: hideDelay)
            guard !Task.isCancelled else { return }
            isShown = false
        }
    }

    /// Sofort weg (Seitenleiste wurde ein- oder ausgeklappt); die Maus muss neu eintreten, um sie wieder zu zeigen
    func dismiss() {
        hideTask?.cancel()
        zonesUnderMouse = []
        isShown = false
    }
}

/// Hängt den Hover an den Seitenleisten-Button des Systems (`NavigationSplitView`). SwiftUI meldet dessen Hover nicht,
/// er ist aber ein Toolbar-Element mit eigener View, an die ein Tracking-Bereich passt. Ein eigener Button daneben
/// ließ sich nicht zuverlässig ersetzen: `.toolbar(removing: .sidebarToggle)` griff in der App nicht, es gab zwei.
struct SidebarButtonHover: NSViewRepresentable {
    let peek: SidebarPeek
    let isCollapsed: Bool

    func makeCoordinator() -> SidebarButtonHoverTracker { SidebarButtonHoverTracker(peek: peek) }

    func makeNSView(context: Context) -> NSView { PassThroughView() }

    func updateNSView(_ view: NSView, context: Context) {
        let tracker = context.coordinator
        tracker.isCollapsed = isCollapsed
        // Die Toolbar entsteht erst nach dem ersten Layout und kann ihre Elemente neu aufbauen
        DispatchQueue.main.async { tracker.attach(in: view.window) }
    }

    private final class PassThroughView: NSView {
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}

final class SidebarButtonHoverTracker: NSResponder {
    /// `com.apple.SwiftUI.navigationSplitView.toggleSidebar` (macOS 15/26)
    static let toggleIdentifierSuffix = "toggleSidebar"

    var isCollapsed = false
    private let peek: SidebarPeek
    private weak var trackedView: NSView?
    private var trackingArea: NSTrackingArea?

    init(peek: SidebarPeek) {
        self.peek = peek
        super.init()
    }

    required init?(coder: NSCoder) { nil }

    static func toggleButtonView(in window: NSWindow?) -> NSView? {
        window?.toolbar?.items.first { $0.itemIdentifier.rawValue.hasSuffix(toggleIdentifierSuffix) }?.view
    }

    func attach(in window: NSWindow?) {
        guard let buttonView = Self.toggleButtonView(in: window), buttonView !== trackedView else { return }
        if let trackingArea { trackedView?.removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect], owner: self)
        buttonView.addTrackingArea(area)
        trackedView = buttonView
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        // Nur eingeklappt zeigt Hover etwas; Verlassen gilt immer
        guard isCollapsed else { return }
        peek.hover(.button, inside: true)
    }

    override func mouseExited(with event: NSEvent) {
        peek.hover(.button, inside: false)
    }
}

/// Die schwebende Seitenleiste über dem Arbeitsbereich. Sie bleibt im Baum, solange die Seitenleiste eingeklappt ist,
/// und wird nur verschoben und ein-/ausgeblendet: Erst beim Hover aufgebaut (Dateibaum, Material), ruckelte das
/// Einblenden. Der Schatten hängt an der Form, nicht am Inhalt (sonst rendert jedes Animationsbild den Inhalt neu).
struct SidebarPeekPanel: View {
    private static let inset: CGFloat = 8
    private static let cornerRadius: CGFloat = 14
    private static let shadowRadius: CGFloat = 14
    private static let shadowOffset: CGFloat = 3
    private static let shadowOpacity = 0.25
    private static let showAnimation = Animation.smooth(duration: 0.24)
    private static let hideAnimation = Animation.easeOut(duration: 0.18)

    let model: AppModel
    let peek: SidebarPeek
    let width: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let animation = peek.isShown ? Self.showAnimation : Self.hideAnimation
        SidebarView(model: model)
            .frame(width: width)
            .clipShape(shape)
            .background {
                shape.fill(.regularMaterial)
                    .shadow(color: .black.opacity(Self.shadowOpacity), radius: Self.shadowRadius, y: Self.shadowOffset)
            }
            .overlay(shape.strokeBorder(.separator))
            .padding(Self.inset)
            .onHover { peek.hover(.panel, inside: $0) }
            // Verborgen ganz links aus dem Fenster: die Listen darin (AppKit) fangen dann sicher keine Klicks
            .offset(x: peek.isShown ? 0 : -(width + Self.inset * 2))
            .animation(reduceMotion ? nil : animation, value: peek.isShown)
            .opacity(peek.isShown ? 1 : 0)
            .animation(animation, value: peek.isShown)
            .allowsHitTesting(peek.isShown)
            .accessibilityHidden(!peek.isShown)
            // Leere Flächen fangen keine Mausereignisse: der Arbeitsbereich neben der Vorschau bleibt bedienbar
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
    }
}
