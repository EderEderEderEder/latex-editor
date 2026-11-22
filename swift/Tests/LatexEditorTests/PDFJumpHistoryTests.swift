import CoreGraphics
import Testing
@testable import LatexEditor

@Suite("PDF-Verlauf")
struct PDFJumpHistoryTests {
    private func state(_ page: Int, x: CGFloat = 10, y: CGFloat = 20, scale: CGFloat = 1, auto: Bool = true) -> PDFViewState {
        PDFViewState(pageIndex: page, point: CGPoint(x: x, y: y), scale: scale, autoScales: auto)
    }

    @Test("Leerer Verlauf hat weder Rück- noch Vorwärtsweg")
    func empty() {
        var history = PDFJumpHistory()
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
        #expect(history.backPageIndex == nil)
        #expect(history.back(from: state(0)) == nil)
        #expect(history.forward(from: state(0)) == nil)
    }

    @Test("Hin und zurück: push, back, forward")
    func roundTrip() {
        var history = PDFJumpHistory()
        let origin = state(1)
        let target = state(5)
        history.push(origin)
        #expect(history.back(from: target) == origin)
        #expect(history.canGoForward)
        #expect(!history.canGoBack)
        #expect(history.forward(from: origin) == target)
        #expect(history.canGoBack)
        #expect(!history.canGoForward)
    }

    @Test("Neuer Sprung nach back leert Vorwärts")
    func pushClearsForward() {
        var history = PDFJumpHistory()
        history.push(state(1))
        _ = history.back(from: state(5))
        #expect(history.canGoForward)
        history.push(state(2))
        #expect(!history.canGoForward)
        #expect(history.backStack == [state(2)])
    }

    @Test("Gleiche Stelle wird nicht doppelt eingetragen, andere Seite oder anderer Punkt schon")
    func noDuplicates() {
        var history = PDFJumpHistory()
        history.push(state(1))
        history.push(state(1, x: 10.5, y: 20.5))
        #expect(history.backStack.count == 1)
        history.push(state(2))
        #expect(history.backStack.count == 2)
        history.push(state(2, x: 10, y: 80))
        #expect(history.backStack.count == 3)
    }

    @Test("Tiefe 20: der 21. Eintrag verdrängt den ältesten")
    func maximumDepth() {
        var history = PDFJumpHistory()
        for page in 0...PDFJumpHistory.maximumDepth {
            history.push(state(page))
        }
        #expect(PDFJumpHistory.maximumDepth == 20)
        #expect(history.backStack.count == PDFJumpHistory.maximumDepth)
        #expect(history.backStack.first?.pageIndex == 1)
        #expect(history.backPageIndex == PDFJumpHistory.maximumDepth)
    }

    @Test("backPageIndex liefert die Seite des obersten Rückwegs")
    func backPageIndex() {
        var history = PDFJumpHistory()
        history.push(state(3))
        history.push(state(7))
        #expect(history.backPageIndex == 7)
        _ = history.back(from: state(9))
        #expect(history.backPageIndex == 3)
    }

    @Test("clamp begrenzt Seitenindizes bei kürzerem PDF")
    func clampShorterDocument() {
        var history = PDFJumpHistory()
        history.push(state(2))
        history.push(state(9, x: 5, y: 6, scale: 2, auto: false))
        _ = history.back(from: state(12))
        history.clamp(toPageCount: 5)
        #expect(history.backStack == [state(2)])
        #expect(history.forwardStack == [state(4)])
    }

    @Test("clamp mit 0 Seiten leert den Verlauf")
    func clampZeroPages() {
        var history = PDFJumpHistory()
        history.push(state(2))
        _ = history.back(from: state(3))
        history.clamp(toPageCount: 0)
        #expect(history == PDFJumpHistory())
    }

    @Test("clear leert beide Stapel")
    func clear() {
        var history = PDFJumpHistory()
        history.push(state(1))
        history.push(state(2))
        _ = history.back(from: state(3))
        history.clear()
        #expect(!history.canGoBack)
        #expect(!history.canGoForward)
    }

    @Test("Rückweg stellt Seite, Punkt, Zoom und autoScales exakt wieder her")
    func restoresExactState() {
        var history = PDFJumpHistory()
        let origin = state(4, x: 123.5, y: 456.25, scale: 1.75, auto: false)
        history.push(origin)
        let restored = history.back(from: state(8))
        #expect(restored?.pageIndex == 4)
        #expect(restored?.point == CGPoint(x: 123.5, y: 456.25))
        #expect(restored?.scale == 1.75)
        #expect(restored?.autoScales == false)
    }
}
