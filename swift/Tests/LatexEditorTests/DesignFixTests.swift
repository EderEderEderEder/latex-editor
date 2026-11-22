import AppKit
import Testing
@testable import LatexEditor

@Suite("Dialogtexte aus Meldungen")
struct AlertTextTests {
    @Test("Lage als Titel, Grund als Zusatztext")
    func splitsAtColon() {
        let text = AlertText("kapitel.tex konnte nicht gespeichert werden: Keine Berechtigung.")
        #expect(text.title == "kapitel.tex konnte nicht gespeichert werden")
        #expect(text.detail == "Keine Berechtigung.")
    }

    @Test("Mehrere Sätze: der erste ist der Titel")
    func splitsSentences() {
        let text = AlertText("Die Umgebung steht nicht mehr hier. Bitte erneut umbenennen.")
        #expect(text.title == "Die Umgebung steht nicht mehr hier.")
        #expect(text.detail == "Bitte erneut umbenennen.")
    }

    @Test("Ein kurzer Satz bleibt ganz Titel; nichts ergibt leere Texte")
    func shortOrEmpty() {
        #expect(AlertText("Bitte eine Commit-Nachricht eingeben.").title == "Bitte eine Commit-Nachricht eingeben.")
        #expect(AlertText("Bitte eine Commit-Nachricht eingeben.").detail.isEmpty)
        #expect(AlertText(nil).title.isEmpty)
    }

    @Test("Zu langer Titel vor dem Doppelpunkt: die ganze Meldung bleibt zusammen")
    func longHead() {
        let head = String(repeating: "lang ", count: 30)
        let text = AlertText(head + ": Grund")
        #expect(text.detail.isEmpty || text.title.count < 100)
    }
}

@MainActor
@Suite("Markierungen in der Zeilennummernleiste")
struct RulerMarkTests {
    @Test("Tooltip nennt Art und Text der Meldung und die Git-Änderung")
    func toolTips() {
        let fixture = EditorFixture(text: "a\nb\nc\n")
        fixture.ruler.issueMarks = [1: .error, 2: .warning]
        fixture.ruler.issueMessages = [1: "Undefined control sequence."]
        fixture.ruler.changeMarks = ChangeMarks(lines: [1: .modified, 3: .added], deletedAtEnd: false)
        #expect(fixture.ruler.toolTipText(forLine: 1) == "Fehler: Undefined control sequence.\nGeändert seit dem letzten Commit")
        #expect(fixture.ruler.toolTipText(forLine: 2) == "Warnung")
        #expect(fixture.ruler.toolTipText(forLine: 3) == "Neu seit dem letzten Commit")
        #expect(fixture.ruler.toolTipText(forLine: 4) == nil)
    }

    @Test("Meldungstexte pro Zeile: die schwerste gewinnt")
    func messagesByFile() {
        let file = URL(fileURLWithPath: "/tmp/a.tex")
        let log = """
        ./a.tex:3: Undefined control sequence.
        l.3 \\foo
        """
        let result = LatexBuildResult(exitCode: 1, output: "", latexLog: log, biberLog: nil, duration: .zero)
        let report = BuildReport.make(from: result, mainFile: file)
        #expect(report.messagesByFile.values.flatMap(\.values).contains("Undefined control sequence."))
    }
}
