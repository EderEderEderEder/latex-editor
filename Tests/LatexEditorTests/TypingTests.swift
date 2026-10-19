import AppKit
import Foundation
import Testing
@testable import LatexEditor

/// Echte Tastatur-Ereignisse an den Editor (wie in der App: keyDown → interpretKeyEvents → insertText/insertNewline).
@MainActor
private struct TypingHarness {
    let harness = CompletionHarness(text: "")

    var text: String { harness.session.textStorage.string }
    var selection: NSRange { harness.textView.selectedRange() }

    func start(_ initial: String = "") async throws {
        try await harness.start()
        harness.session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: initial)
        harness.textView.setSelectedRange(NSRange(location: (initial as NSString).length, length: 0))
        harness.window.makeFirstResponder(harness.textView)
    }

    func press(_ characters: String, keyCode: UInt16 = 0, modifiers: NSEvent.ModifierFlags = []) {
        let event = NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: modifiers, timestamp: 0, windowNumber: harness.window.windowNumber,
            context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: keyCode
        )!
        harness.textView.keyDown(with: event)
    }

    func type(_ text: String) {
        for character in text { press(String(character)) }
    }

    func returnKey() { press("\r", keyCode: 36) }
    func backspace() { press("\u{7F}", keyCode: 51) }
    func tab(shift: Bool = false) { press(shift ? "\u{19}" : "\t", keyCode: 48, modifiers: shift ? .shift : []) }

    /// Wie ein Menübefehl über die Responder-Kette (im Testprozess gibt es kein laufendes NSApp)
    func send(_ action: Selector) {
        _ = harness.textView.tryToPerform(action, with: nil)
    }
}

@Suite("Tippgefühl im echten Editor", .serialized)
@MainActor
struct TypingTests {
    @Test("Klammern schließen, überspringen und paarweise löschen; mit der Vervollständigung zusammen")
    func brackets() async throws {
        let typing = TypingHarness()
        try await typing.start()

        typing.type("\\emph{")
        #expect(typing.text == "\\emph{}")
        #expect(typing.selection.location == 6)
        typing.type("x}")
        #expect(typing.text == "\\emph{x}", "Die schließende Klammer wird übersprungen, nicht verdoppelt")
        typing.type(" \\ref{")
        #expect(typing.text == "\\emph{x} \\ref{}")
        #expect(typing.harness.completion.isVisible, "Nach \\ref{ öffnet die Liste trotz automatisch geschlossener Klammer")
        typing.press("\u{1B}", keyCode: 53)
        typing.backspace()
        #expect(typing.text == "\\emph{x} \\ref")
    }

    @Test("Enter rückt ein und ergänzt \\end; Tab mit Auswahl rückt ein, ⇧Tab aus")
    func newlineAndTab() async throws {
        let typing = TypingHarness()
        try await typing.start("\t\\begin{itemize}")
        typing.harness.completion.close()

        typing.returnKey()
        #expect(typing.text == "\t\\begin{itemize}\n\t\t\\item \n\t\\end{itemize}")
        typing.type("Eins")
        typing.returnKey()
        #expect(typing.text == "\t\\begin{itemize}\n\t\t\\item Eins\n\t\t\\item \n\t\\end{itemize}")

        typing.harness.textView.setSelectedRange(NSRange(location: 0, length: (typing.text as NSString).length))
        typing.tab(shift: true)
        #expect(typing.text == "\\begin{itemize}\n\t\\item Eins\n\t\\item \n\\end{itemize}")
        typing.tab()
        #expect(typing.text.hasPrefix("\t\\begin{itemize}\n\t\t\\item Eins"))
    }

    @Test("Menübefehle: Kommentar, Zeilen verschieben, Fett; jeder Befehl ein Undo-Schritt")
    func menuCommands() async throws {
        let typing = TypingHarness()
        try await typing.start("erste\nzweite")
        let undo = typing.harness.session.undoManager

        // Jeder Menübefehl ist in der App ein eigenes Ereignis; der UndoManager gruppiert pro Runloop-Durchlauf.
        let nextEvent = { try await Task.sleep(for: .milliseconds(20)) }
        typing.send(#selector(LatexTextView.toggleComment(_:)))
        #expect(typing.text == "erste\n% zweite")
        try await nextEvent()
        typing.send(#selector(LatexTextView.moveLinesUp(_:)))
        #expect(typing.text == "% zweite\nerste")
        try await nextEvent()
        typing.harness.textView.setSelectedRange(NSRange(location: 9, length: 5))
        typing.send(#selector(LatexTextView.formatBold(_:)))
        #expect(typing.text == "% zweite\n\\textbf{erste}")

        try await Task.sleep(for: .milliseconds(20))
        undo.undo()
        #expect(typing.text == "% zweite\nerste")
    }

    @Test("Abschaltbar: ohne „Klammern automatisch schließen“ wird normal getippt")
    func autoPairOff() async throws {
        UserDefaults.standard.set(false, forKey: LatexTextView.autoPairKey)
        defer { UserDefaults.standard.removeObject(forKey: LatexTextView.autoPairKey) }
        let typing = TypingHarness()
        try await typing.start()
        typing.type("{")
        #expect(typing.text == "{")
    }
}
