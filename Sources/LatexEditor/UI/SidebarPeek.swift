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

/// Der Seitenleisten-Button der Toolbar (ersetzt den von `NavigationSplitView`, dessen Hover nicht abfragbar ist)
struct SidebarToggleButton: View {
    let peek: SidebarPeek
    let isCollapsed: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            Label("Seitenleiste", systemImage: "sidebar.leading")
        }
        .help(isCollapsed ? "Seitenleiste einblenden (⌃⌘S); Maus darüber zeigt sie vorübergehend" : "Seitenleiste ausblenden (⌃⌘S)")
        .onHover { inside in
            // Nur eingeklappt zeigt Hover etwas; Verlassen gilt immer
            guard isCollapsed || !inside else { return }
            peek.hover(.button, inside: inside)
        }
    }
}

/// Die schwebende Seitenleiste über dem Arbeitsbereich
struct SidebarPeekPanel: View {
    private static let inset: CGFloat = 8
    private static let cornerRadius: CGFloat = 14
    private static let fadeDuration = 0.18

    let model: AppModel
    let peek: SidebarPeek
    let width: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if peek.isShown {
                SidebarView(model: model)
                    .frame(width: width)
                    .background(.regularMaterial, in: shape)
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(.separator))
                    .shadow(color: .black.opacity(0.25), radius: 14, y: 3)
                    .padding(Self.inset)
                    .onHover { peek.hover(.panel, inside: $0) }
                    .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: Self.fadeDuration), value: peek.isShown)
        // Leere Flächen fangen keine Mausereignisse: der Arbeitsbereich neben der Vorschau bleibt bedienbar
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
    }
}
