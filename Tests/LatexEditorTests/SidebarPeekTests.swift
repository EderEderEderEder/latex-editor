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
