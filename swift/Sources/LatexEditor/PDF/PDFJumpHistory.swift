import CoreGraphics

/// „Zurück“/„Vorwärts“-Verlauf für Sprünge im PDF (z. B. über \ref-Links); PDFKits eigener Verlauf geht beim Neuladen verloren.
struct PDFJumpHistory: Equatable {
    static let maximumDepth = 20
    private static let duplicateTolerance: CGFloat = 1

    private(set) var backStack: [PDFViewState] = []
    private(set) var forwardStack: [PDFViewState] = []

    var canGoBack: Bool { !backStack.isEmpty }
    var canGoForward: Bool { !forwardStack.isEmpty }
    var backPageIndex: Int? { backStack.last?.pageIndex }

    /// Stelle, von der aus ein neuer Sprung geschieht.
    mutating func push(_ origin: PDFViewState) {
        forwardStack.removeAll()
        if let top = backStack.last, Self.isSameSpot(top, origin) { return }
        backStack.append(origin)
        if backStack.count > Self.maximumDepth {
            backStack.removeFirst(backStack.count - Self.maximumDepth)
        }
    }

    mutating func back(from current: PDFViewState) -> PDFViewState? {
        guard let target = backStack.popLast() else { return nil }
        forwardStack.append(current)
        return target
    }

    mutating func forward(from current: PDFViewState) -> PDFViewState? {
        guard let target = forwardStack.popLast() else { return nil }
        backStack.append(current)
        return target
    }

    mutating func clear() {
        backStack.removeAll()
        forwardStack.removeAll()
    }

    /// Nach einem Build kann das PDF kürzer sein: Seitenindizes auf `0..<pageCount` begrenzen, bei 0 Seiten leeren.
    mutating func clamp(toPageCount pageCount: Int) {
        guard pageCount > 0 else {
            clear()
            return
        }
        backStack = backStack.map { Self.clamped($0, pageCount: pageCount) }
        forwardStack = forwardStack.map { Self.clamped($0, pageCount: pageCount) }
    }

    private static func clamped(_ state: PDFViewState, pageCount: Int) -> PDFViewState {
        let index = min(max(state.pageIndex, 0), pageCount - 1)
        guard index != state.pageIndex else { return state }
        return PDFViewState(pageIndex: index, point: state.point, scale: state.scale, autoScales: state.autoScales)
    }

    private static func isSameSpot(_ a: PDFViewState, _ b: PDFViewState) -> Bool {
        a.pageIndex == b.pageIndex
            && abs(a.point.x - b.point.x) <= duplicateTolerance
            && abs(a.point.y - b.point.y) <= duplicateTolerance
    }
}
