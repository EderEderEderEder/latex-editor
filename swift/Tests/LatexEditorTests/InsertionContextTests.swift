import Foundation
import Testing
@testable import LatexEditor

@Suite("Vorschau an Ort und Stelle (Einfügen-Fenster)")
struct InsertionContextTests {
    private static let text = "eins\nzwei\ndrei\nvier\nfünf\nsechs\nsieben\nacht\nneun\n"

    private func context(cursorAt location: Int, length: Int = 0) -> InsertionContext {
        InsertionContext.make(text: Self.text as NSString, selection: NSRange(location: location, length: length), fileName: "a.tex")
    }

    @Test("Ausschnitt: drei Zeilen davor und danach, Zeilennummern wie im Editor")
    func excerpt() {
        let location = (Self.text as NSString).range(of: "fünf").location
        let context = context(cursorAt: location)
        #expect(context.firstLineNumber == 2)
        #expect(context.excerpt == "zwei\ndrei\nvier\nfünf\nsechs\nsieben\nacht")
        #expect(context.cursorLineNumber == 5)
    }

    @Test("Ein Block am Zeilenanfang steht in eigenen Zeilen, nur sie sind neu")
    func blockAtLineStart() {
        let location = (Self.text as NSString).range(of: "fünf").location
        let lines = context(cursorAt: location).lines(inserting: "\\begin{x}\n\\end{x}\n", isBlock: true, replacesSelection: false)
        #expect(lines.map(\.text) == ["zwei", "drei", "vier", "\\begin{x}", "\\end{x}", "fünf", "sechs", "sieben", "acht"])
        #expect(lines.map(\.isNew) == [false, false, false, true, true, false, false, false, false])
        #expect(lines.map(\.number) == Array(2...10))
    }

    @Test("Ein Block mitten in der Zeile beginnt in einer neuen Zeile (wie BlockPlacement im Editor)")
    func blockMidLine() {
        let location = (Self.text as NSString).range(of: "fünf").location + 2
        let lines = context(cursorAt: location).lines(inserting: "X\n", isBlock: true, replacesSelection: false)
        #expect(lines.map(\.text).contains("fü"))
        #expect(lines.first { $0.text == "X" }?.isNew == true)
        #expect(lines.first { $0.text == "nf" }?.isNew == false)
    }

    @Test("Ein Verweis im Fließtext markiert seine Zeile; eine Auswahl wird ersetzt, wenn der Baustein sie übernimmt")
    func inlineAndSelection() {
        let location = (Self.text as NSString).range(of: "drei").location
        let inline = context(cursorAt: location, length: 4).lines(inserting: "\\ref{a}", isBlock: false, replacesSelection: true)
        #expect(inline.first { $0.isNew }?.text == "\\ref{a}")
        let after = context(cursorAt: location, length: 4).lines(inserting: "\\ref{a}", isBlock: false, replacesSelection: false)
        #expect(after.first { $0.isNew }?.text == "drei\\ref{a}")
    }

    @Test("Am Dateianfang und -ende ohne Absturz")
    func edges() {
        #expect(context(cursorAt: 0).firstLineNumber == 1)
        let end = context(cursorAt: (Self.text as NSString).length)
        #expect(end.lines(inserting: "Z\n", isBlock: true, replacesSelection: false).first { $0.text == "Z" }?.isNew == true)
    }
}

@Suite("Einstellungen: Bereiche und Suche")
struct SettingsPaneTests {
    @Test("Suche findet Bereiche über Titel und Einstellungen, ohne Groß-/Kleinschreibung")
    func search() {
        #expect(SettingsPane.allCases.filter { $0.matches("tabbreite") } == [.editor])
        #expect(SettingsPane.allCases.filter { $0.matches("PDF") }.contains(.pdf))
        #expect(SettingsPane.allCases.filter { $0.matches("") } == SettingsPane.allCases)
        #expect(SettingsPane.allCases.filter { $0.matches("xyz") }.isEmpty)
    }

    @Test("Jeder Bereich steht in genau einer Gruppe")
    func groups() {
        let grouped = SettingsPane.Group.allCases.flatMap(\.panes)
        #expect(grouped.sorted { $0.rawValue < $1.rawValue } == SettingsPane.allCases.sorted { $0.rawValue < $1.rawValue })
    }
}
