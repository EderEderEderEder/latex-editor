import AppKit
import Testing
@testable import LatexEditor

/// Echter EditorCoordinator mit NSScrollView in einem Offscreen-Fenster, wie in der App.
@MainActor
private struct CoordinatorHarness {
    static let size = NSSize(width: 700, height: 500)

    let coordinator = EditorCoordinator()
    let scrollView: NSScrollView
    let window: NSWindow

    init() {
        scrollView = coordinator.makeScrollView()
        window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.size), styleMask: [.titled], backing: .buffered, defer: false)
        scrollView.frame = NSRect(origin: .zero, size: Self.size)
        window.contentView = scrollView
    }

    var textView: LatexTextView { scrollView.documentView as! LatexTextView }

    /// Wie ein SwiftUI-Update: `updateNSView`, danach die vorgemerkte Arbeit (DispatchQueue.main.async)
    /// laufen lassen und zeichnen. Ein `await` ist nötig, weil der Test selbst auf der Main-Queue läuft.
    func show(_ session: DocumentSession?, jump: JumpRequest? = nil, insert: InsertRequest? = nil) async {
        coordinator.update(session: session, jump: jump, insert: insert)
        try? await Task.sleep(for: .milliseconds(30))
        window.displayIfNeeded()
    }
}

@MainActor
private func session(_ name: String, _ text: String) -> DocumentSession {
    DocumentSession(url: URL(fileURLWithPath: "/tmp/\(name)"), text: text)
}

@Suite("Dateiwechsel im Editor", .serialized)
@MainActor
struct SessionSwitchTests {
    @Test("Wechsel von langer Datei (Cursor am Ende) zu kurzer Datei stürzt nicht ab")
    func switchToShorterFile() async {
        let harness = CoordinatorHarness()
        let long = session("long.tex", LargeDocument.make(lineCount: 150))
        let short = session("short.tex", "\\section{Kurz}\nNur ein bisschen Text.\n")
        await harness.show(long)
        harness.textView.setSelectedRange(NSRange(location: long.textStorage.length, length: 0))

        await harness.show(short)

        #expect(harness.textView.textStorage === short.textStorage)
        #expect(NSMaxRange(harness.textView.selectedRange()) <= short.textStorage.length)
    }
}

@Suite("Dateiwechsel: weitere Pfade", .serialized)
@MainActor
struct SessionSwitchPathTests {
    @Test("Hin- und Rückwechsel stellt die Auswahl der jeweiligen Datei wieder her")
    func restoresSelectionPerFile() async {
        let harness = CoordinatorHarness()
        let first = session("a.tex", LargeDocument.make(lineCount: 120))
        let second = session("b.tex", "kurz\n")
        await harness.show(first)
        harness.textView.setSelectedRange(NSRange(location: 500, length: 3))
        await harness.show(second)
        await harness.show(first)

        #expect(harness.textView.selectedRange() == NSRange(location: 500, length: 3))
    }

    @Test("Veraltete gespeicherte Auswahl und Scrollposition werden geklemmt")
    func clampsStaleSavedState() async {
        let harness = CoordinatorHarness()
        let other = session("other.tex", "x\n")
        let shrinking = session("shrink.tex", LargeDocument.make(lineCount: 200))
        await harness.show(shrinking)
        harness.textView.setSelectedRange(NSRange(location: 4_000, length: 50))
        await harness.show(other)
        // Extern gekürzt, während die Datei nicht angezeigt wird.
        shrinking.textStorage.replaceCharacters(in: NSRange(location: 10, length: shrinking.textStorage.length - 10), with: "")
        shrinking.savedScrollOffset = 1_000_000

        await harness.show(shrinking)

        #expect(NSMaxRange(harness.textView.selectedRange()) <= shrinking.textStorage.length)
        #expect(harness.scrollView.contentView.bounds.minY <= harness.textView.frame.height)
    }

    @Test("Projektwechsel: Session wird nil, danach neue Datei")
    func switchToNoSessionAndBack() async {
        let harness = CoordinatorHarness()
        let first = session("a.tex", LargeDocument.make(lineCount: 150))
        await harness.show(first)
        harness.textView.setSelectedRange(NSRange(location: first.textStorage.length, length: 0))

        await harness.show(nil)
        #expect(harness.textView.textStorage?.length == 0)
        #expect(!harness.textView.isEditable)

        await harness.show(session("neu.tex", "neu"))
        #expect(harness.textView.isEditable)
        #expect(NSMaxRange(harness.textView.selectedRange()) <= 3)
    }

    @Test("Wiederholte Sprünge über Dateigrenzen landen jedes Mal auf der Zielzeile")
    func repeatedJumpsAcrossFiles() async {
        let harness = CoordinatorHarness()
        let chapterOne = session("eins.tex", LargeDocument.make(lineCount: 300))
        let chapterTwo = session("zwei.tex", LargeDocument.make(lineCount: 80))
        let jumps: [(DocumentSession, Int)] = [
            (chapterOne, 250), (chapterTwo, 40), (chapterOne, 250), (chapterOne, 250), (chapterTwo, 1), (chapterOne, 3)
        ]
        for (target, line) in jumps {
            await harness.show(target, jump: JumpRequest(line: line))
            let caret = harness.textView.selectedRange().location
            #expect(target.lineIndex.line(containing: caret) + 1 == line, "Sprung zu \(target.url.lastPathComponent):\(line)")
        }
    }

    @Test("Sprung hinter das Dateiende landet auf der letzten Zeile")
    func jumpBeyondEndIsClamped() async {
        let harness = CoordinatorHarness()
        let file = session("klein.tex", "a\nb\nc")
        await harness.show(file, jump: JumpRequest(line: 999))

        #expect(harness.textView.selectedRange().location == 4)
        await harness.show(file, jump: JumpRequest(line: -5))
        #expect(harness.textView.selectedRange().location == 0)
    }
}

@Suite("Extern gelöschte Dateien")
@MainActor
struct DeletedFileTests {
    @Test("Unveränderte, angezeigte Datei wird geschlossen")
    func closesCleanSession() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let url = try project.write("kapitel.tex", "Text")
        let store = EditorStore()
        await store.open(url)
        try FileManager.default.removeItem(at: url)

        #expect(store.handleDeletedFile(url))
        #expect(store.current == nil)
    }

    @Test("Datei mit Änderungen bleibt offen, wird markiert und kann neu gespeichert werden")
    func keepsDirtySession() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let url = try project.write("kapitel.tex", "Text")
        let store = EditorStore()
        await store.open(url)
        let session = try #require(store.current)
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "Neu ")
        try FileManager.default.removeItem(at: url)

        #expect(!store.handleDeletedFile(url))
        #expect(store.current === session)
        #expect(session.isMissingOnDisk)

        store.saveCurrent()
        #expect(FileManager.default.fileExists(atPath: url.path))
        #expect(!session.isMissingOnDisk)
    }
}

@Suite("Einfügen im Editor", .serialized)
@MainActor
struct EditorInsertionTests {
    private func request(_ text: String, block: Bool = true, replaces: Bool = false) -> InsertRequest {
        InsertRequest(text: text, isBlock: block, replacesSelection: replaces)
    }

    @Test("Block landet in eigenen Zeilen an der Cursorposition, Cursor dahinter")
    func insertsBlockAtCursor() async {
        let harness = CoordinatorHarness()
        let file = session("a.tex", "Erste Zeile\nZweite Zeile\n")
        await harness.show(file)
        harness.textView.setSelectedRange(NSRange(location: 6, length: 0))

        await harness.show(file, insert: request("\\begin{x}\n\\end{x}\n"))

        #expect(file.textStorage.string == "Erste \n\\begin{x}\n\\end{x}\nZeile\nZweite Zeile\n")
        #expect(file.isDirty)
        #expect(harness.textView.selectedRange().location == 6 + 1 + 18)
    }

    @Test("Ein Undo-Schritt macht das ganze Einfügen rückgängig, Redo stellt es wieder her")
    func singleUndoStep() async throws {
        let harness = CoordinatorHarness()
        let file = session("a.tex", "Anfang\n")
        await harness.show(file)
        harness.textView.setSelectedRange(NSRange(location: 7, length: 0))
        await harness.show(file, insert: request("\\begin{table}\n\t\\centering\n\\end{table}\n"))
        let inserted = file.textStorage.string
        #expect(inserted.contains("\\end{table}"))

        let undoManager = try #require(harness.textView.undoManager)
        undoManager.undo()
        #expect(file.textStorage.string == "Anfang\n")
        undoManager.redo()
        #expect(file.textStorage.string == inserted)
    }

    @Test("Markierung wird bei Code ersetzt, bei Tabellen dahinter eingefügt")
    func selectionHandling() async {
        let harness = CoordinatorHarness()
        let file = session("a.tex", "vorher\nx = 1\nnachher\n")
        await harness.show(file)
        harness.textView.setSelectedRange(NSRange(location: 7, length: 5))
        await harness.show(file, insert: request("\\begin{PythonCode}\nx = 1\n\\end{PythonCode}\n", replaces: true))
        #expect(file.textStorage.string == "vorher\n\\begin{PythonCode}\nx = 1\n\\end{PythonCode}\nnachher\n")

        let other = session("b.tex", "abc def")
        await harness.show(other)
        harness.textView.setSelectedRange(NSRange(location: 0, length: 3))
        await harness.show(other, insert: request("T\n", replaces: false))
        #expect(other.textStorage.string.hasPrefix("abc"))
    }

    @Test("Verweis steht mitten im Satz ohne Zeilenumbruch")
    func inlineInsertion() async {
        let harness = CoordinatorHarness()
        let file = session("a.tex", "Siehe  für Details.")
        await harness.show(file)
        harness.textView.setSelectedRange(NSRange(location: 6, length: 0))
        await harness.show(file, insert: request("Abbildung~\\ref{fig:x}", block: false))
        #expect(file.textStorage.string == "Siehe Abbildung~\\ref{fig:x} für Details.")
    }

    @Test("Dieselbe Anfrage wird nicht zweimal ausgeführt")
    func requestHandledOnce() async {
        let harness = CoordinatorHarness()
        let file = session("a.tex", "")
        await harness.show(file)
        let single = request("X", block: false)
        await harness.show(file, insert: single)
        await harness.show(file, insert: single)
        #expect(file.textStorage.string == "X")
    }

    @Test("Markierter Text steht dem Einfügen-Fenster zur Verfügung")
    func selectedTextProvider() async {
        let harness = CoordinatorHarness()
        let file = session("a.tex", "let x = 1")
        await harness.show(file)
        harness.textView.setSelectedRange(NSRange(location: 4, length: 1))
        #expect(harness.coordinator.selectedText == "x")
        harness.textView.setSelectedRange(NSRange(location: 0, length: 0))
        #expect(harness.coordinator.selectedText == "")
    }
}
