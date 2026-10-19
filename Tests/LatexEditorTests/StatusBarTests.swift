import AppKit
import SwiftUI
import Testing
@testable import LatexEditor

@Suite("Wortzahl: Datei und Projekt", .serialized)
@MainActor
struct WordCountStoreTests {
    private func wait(for condition: () -> Bool) async throws {
        for _ in 0..<200 where !condition() { try await Task.sleep(for: .milliseconds(20)) }
    }

    @Test("Offene Datei: entprellt aus dem Editortext, auch ungespeichert")
    func countsOpenFile() async throws {
        let store = WordCountStore()
        let url = URL(fileURLWithPath: "/tmp/wortzahl-a.tex")
        let session = DocumentSession(url: url, text: "Eins zwei drei \\textbf{vier} % fünf")
        store.schedule(session)
        #expect(store.words(inOpenFile: url) == nil, "erst nach der Pause")
        try await wait { store.words(inOpenFile: url) != nil }
        #expect(store.words(inOpenFile: url) == 4)

        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "Noch zwei ")
        store.schedule(session)
        try await wait { store.words(inOpenFile: url) == 6 }
        #expect(store.words(inOpenFile: url) == 6)
    }

    @Test("Projekt: Summe aus Platte und Editor; offener Text geht vor, nach dem Schließen gilt wieder die Platte")
    func projectSum() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "\\documentclass{report}\n\\begin{document}\nEins zwei\n\\include{a}\\include{b}\n\\end{document}\n")
        let chapterA = try project.write("a.tex", "drei vier fünf\n")
        let chapterB = try project.write("b.tex", "sechs\n")
        let store = WordCountStore()
        store.projectFiles = { [main, chapterA, chapterB] }

        store.refreshProject(immediately: true)
        await store.waitUntilIdle()
        #expect(store.projectWords == 2 + 3 + 1)

        let session = DocumentSession(url: chapterA, text: "drei vier fünf plus noch zwei ungespeicherte Wörter")
        store.schedule(session)
        try await wait { store.words(inOpenFile: chapterA) != nil }
        await store.waitUntilIdle()
        try await wait { store.projectWords == 2 + 8 + 1 }
        #expect(store.projectWords == 2 + 8 + 1, "der ungespeicherte Text zählt")

        store.retain([])
        store.refreshProject(immediately: true)
        await store.waitUntilIdle()
        #expect(store.projectWords == 6, "Tab zu: Platte")
        #expect(store.words(inOpenFile: chapterA) == nil)
    }

    @Test("Geänderte Datei auf der Platte wird neu gezählt (Zwischenspeicher nach Änderungsdatum)")
    func diskChangeInvalidatesCache() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "Eins zwei\n")
        let store = WordCountStore()
        store.projectFiles = { [main] }
        store.refreshProject(immediately: true)
        await store.waitUntilIdle()
        #expect(store.projectWords == 2)

        try "Eins zwei drei vier\n".write(to: main, atomically: true, encoding: .utf8)
        store.refreshProject(immediately: true)
        await store.waitUntilIdle()
        #expect(store.projectWords == 4)
    }

    @Test("Zurücksetzen und ohne Dateien: keine Projektzahl")
    func reset() async throws {
        let store = WordCountStore()
        store.refreshProject(immediately: true)
        await store.waitUntilIdle()
        #expect(store.projectWords == nil)
    }
}

@Suite("Statusleiste", .serialized)
@MainActor
struct StatusBarTests {
    @Test("Der Editor meldet Zeile, Spalte und Wörter der Auswahl")
    func cursorReport() async throws {
        let harness = CompletionHarness(text: "Erste Zeile\nZweite Zeile hier\nDritte")
        try await harness.start()
        var latest: CursorInfo?
        harness.coordinator.onCursorMoved = { latest = $0 }

        // Die Meldung ist um 150 ms entprellt; unter Last (parallele Tests) darf sie länger brauchen
        func waitForReport(_ condition: (CursorInfo) -> Bool) async throws {
            for _ in 0..<150 where !(latest.map(condition) ?? false) { try await Task.sleep(for: .milliseconds(20)) }
        }
        harness.textView.setSelectedRange(NSRange(location: 12 + 7, length: 0))
        try await waitForReport { $0.line == 2 && $0.column == 8 }
        #expect(latest?.line == 2)
        #expect(latest?.column == 8)
        #expect(latest?.selectedWords == 0)

        harness.textView.setSelectedRange(NSRange(location: 12, length: 17))
        try await waitForReport { $0.selectedCharacters == 17 }
        #expect(latest?.line == 2)
        #expect(latest?.column == 1)
        #expect(latest?.selectedCharacters == 17)
        #expect(latest?.selectedWords == 3, "„Zweite Zeile hier“")
    }

    @Test("Zahlen mit Tausenderpunkt, Einzahl und Mehrzahl")
    func formatting() {
        #expect(EditorStatusBar.wordsText(1) == "1 Wort")
        #expect(EditorStatusBar.wordsText(0) == "0 Wörter")
        #expect(EditorStatusBar.wordsText(12_345) == "12.345 Wörter")
    }

    @Test("Die Leiste zeigt Position, Datei- und Projektwörter und wächst mit dem Zoom")
    func rendersAndScales() async throws {
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/leiste.tex"), text: "Ein kurzer Text")
        let counts = WordCountStore()
        counts.schedule(session)
        for _ in 0..<100 where counts.words(inOpenFile: session.url) == nil { try await Task.sleep(for: .milliseconds(20)) }
        let editor = EditorStore()
        editor.reportCursor(CursorInfo(file: session.url, line: 3, column: 9, selectedCharacters: 0, selectedWords: 0))

        func height(_ scale: CGFloat) -> CGFloat {
            NSHostingView(rootView: EditorStatusBar(editor: editor, counts: counts, session: session)
                .environment(\.interfaceScale, scale)).fittingSize.height
        }
        #expect(height(2) == height(1) * 2)
        #expect(EditorStatusBar.positionText(for: editor.cursor) == "Zeile 3 · Spalte 9")
        #expect(EditorStatusBar.positionText(for: nil) == "Zeile – · Spalte –")
        #expect(counts.words(inOpenFile: session.url) == 3)
    }
}
