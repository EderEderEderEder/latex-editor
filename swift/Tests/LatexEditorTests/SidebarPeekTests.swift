import SwiftUI
import Testing
@testable import LatexEditor

@MainActor
@Suite("Vorschau der eingeklappten Seitenleiste")
struct SidebarPeekTests {
    private static let delay = Duration.milliseconds(30)
    private static let wait = Duration.milliseconds(120)
    /// Unter Last (andere Tests blockieren den Main-Thread) kommt der Timer spät
    private static let timeout = Duration.seconds(10)

    private func waitUntilHidden(_ peek: SidebarPeek) async throws {
        let deadline = ContinuousClock.now + Self.timeout
        while peek.isShown, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(10)) }
    }

    @Test("Erscheint beim Hover über den Button und bleibt, bis die Maus weg ist")
    func showsWhileHovering() async throws {
        let peek = SidebarPeek(hideDelay: Self.delay)
        peek.hover(.button, inside: true)
        #expect(peek.isShown)
        try await Task.sleep(for: Self.wait)
        #expect(peek.isShown)
        peek.hover(.button, inside: false)
        try await waitUntilHidden(peek)
        #expect(!peek.isShown)
    }

    @Test("Wechsel vom Button zur Vorschau lässt sie nicht verschwinden")
    func movingToPanelKeepsPeek() async throws {
        let peek = SidebarPeek(hideDelay: Self.delay)
        peek.hover(.button, inside: true)
        peek.hover(.button, inside: false)
        peek.hover(.panel, inside: true)
        try await Task.sleep(for: Self.wait)
        #expect(peek.isShown)
        peek.hover(.panel, inside: false)
        try await waitUntilHidden(peek)
        #expect(!peek.isShown)
    }

    @Test("Hover hängt am Seitenleisten-Button des Systems und zeigt nur eingeklappt etwas")
    func tracksSystemToggleButton() async throws {
        let window = makeSplitViewWindow()
        let deadline = ContinuousClock.now + Self.timeout
        while SidebarButtonHoverTracker.toggleButtonView(in: window) == nil, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        let buttonView = try #require(SidebarButtonHoverTracker.toggleButtonView(in: window))

        let peek = SidebarPeek(hideDelay: Self.delay)
        let tracker = SidebarButtonHoverTracker(peek: peek)
        tracker.attach(in: window)
        #expect(buttonView.trackingAreas.contains { $0.owner === tracker })

        let entered = try #require(enterExitEvent(.mouseEntered, in: window))
        tracker.mouseEntered(with: entered)
        #expect(!peek.isShown)
        tracker.isCollapsed = true
        tracker.mouseEntered(with: entered)
        #expect(peek.isShown)
        tracker.mouseExited(with: try #require(enterExitEvent(.mouseExited, in: window)))
        try await waitUntilHidden(peek)
        #expect(!peek.isShown)
        window.close()
    }

    private func makeSplitViewWindow() -> NSWindow {
        let content = NavigationSplitView { Text("Seitenleiste") } detail: { Text("Arbeitsbereich") }
        let controller = NSHostingController(rootView: content)
        controller.sceneBridgingOptions = [.toolbars]
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 500),
            styleMask: [.titled, .resizable, .fullSizeContentView], backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.contentViewController = controller
        return window
    }

    private func enterExitEvent(_ type: NSEvent.EventType, in window: NSWindow) -> NSEvent? {
        NSEvent.enterExitEvent(
            with: type, location: .zero, modifierFlags: [], timestamp: 0,
            windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil
        )
    }

    @Test("dismiss blendet sofort aus und verwirft den Hover")
    func dismissIsImmediate() async throws {
        let peek = SidebarPeek(hideDelay: Self.delay)
        peek.hover(.button, inside: true)
        peek.dismiss()
        #expect(!peek.isShown)
        peek.hover(.button, inside: false)
        try await Task.sleep(for: Self.wait)
        #expect(!peek.isShown)
    }
}
