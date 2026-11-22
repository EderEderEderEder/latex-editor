import Foundation
import Testing
@testable import LatexEditor

/// Korrektur für das Wort vor dem Ende von `text` (wie direkt nach dem Tippen eines Leerzeichens dahinter)
private func corrected(_ text: String) -> String? {
    let source = text as NSString
    return Capitalization.correction(forWordEndingAt: source.length, in: source)?.replacement
}

@Suite("Groß-/Kleinschreibung")
struct CapitalizationTests {
    @Test("Satzanfang nach . ! ? und am Absatzanfang wird groß")
    func sentenceStart() {
        #expect(corrected("Das ist gut. das") == "Das")
        #expect(corrected("Wirklich? ja") == "Ja")
        #expect(corrected("Achtung! hier") == "Hier")
        #expect(corrected("Ende.\nneuer") == "Neuer", "Ein Satz pro Zeile")
        #expect(corrected("Absatz eins.\n\nzweiter") == "Zweiter")
        #expect(corrected("Text ohne Punkt\n\nabsatz") == "Absatz", "Leerzeile = neuer Absatz")
        #expect(corrected("Mit Ü. über") == nil, "Einzelbuchstabe vor dem Punkt ist eine Abkürzung")
        #expect(corrected("Ein Satz (mit Klammer). danach") == "Danach")
        #expect(corrected("Er sagte \\enquote{so}. dann") == "Dann")
    }

    @Test("Nach einer abgesetzten Formel geht der Satz weiter, außer sie endet mit einem Satzzeichen")
    func afterDisplayMath() {
        let equation = "muss die Bedingung\n\n\\begin{equation}\n  a = 1\n\\end{equation}\n\n"
        #expect(corrected(equation + "erfüllt") == nil)
        #expect(corrected("muss gelten\n\n\\begin{align*}\n a &= 1 \\\\\n b &= 2\n\\end{align*}\n\nwobei") == nil)
        #expect(corrected("muss gelten\n\n\\[\n a = 1\n\\]\n\nerfüllt") == nil)
        #expect(corrected("muss gelten\n\n$$\n a = 1\n$$\n\nerfüllt") == nil)
        #expect(corrected("Es gilt\n\n\\begin{equation}\n  a = 1,\n\\end{equation}\n\nwobei") == nil)
        #expect(corrected("Es gilt\n\n\\begin{equation}\n  a = 1.\n\\end{equation}\n\nneuer") == "Neuer", "Satzzeichen in der Formel")
        #expect(corrected("Es gilt\n\n\\[\n a = 1 .\n\\]\n\nneuer") == "Neuer")
        #expect(corrected("Liste\n\\begin{itemize}\n\\item a\n\\end{itemize}\n\nneuer") == "Neuer", "Nur Formeln")
    }

    @Test("Kein Satzende: Abkürzungen, Zahlen, Auslassungspunkte, Wortmitte, Textanfang")
    func notSentenceStart() {
        #expect(corrected("Das ist z. B. ein") == nil)
        #expect(corrected("Das ist z.B. ein") == nil)
        #expect(corrected("Siehe Abb. drei") == nil)
        #expect(corrected("Siehe vgl. dazu") == nil)
        #expect(corrected("Das bzw. jenes") == nil)
        #expect(corrected("am 3. oktober") == nil, "Ordnungszahl")
        #expect(corrected("und dann... egal") == nil)
        #expect(corrected("Das ist gut, das") == nil)
        #expect(corrected("Das ist gut: das") == nil)
        #expect(corrected("erstes") == nil, "Textanfang (Präambel, eingebundene Datei) bleibt")
        #expect(corrected("main.tex") == nil, "Ohne Leerzeichen kein neues Wort")
        #expect(corrected("Ende. iPhone") == nil, "Gemischte Schreibung bleibt")
    }

    @Test("ZWei Großbuchstaben: „DIe“ → „Die“, aber nicht IDs, API, LaTeX, iOS")
    func twoInitialCapitals() {
        #expect(corrected("Hier DIe") == "Die")
        #expect(corrected("Hier ÜBer") == "Über")
        #expect(corrected("Viele IDs") == nil)
        #expect(corrected("Die API") == nil)
        #expect(corrected("Mit LaTeX") == nil)
        #expect(corrected("Für iOS") == nil)
        #expect(corrected("Ein OK") == nil)
    }

    @Test("Nach einem Befehl oder in einem Argument ist es kein eigenes Wort")
    func notAfterCommand() {
        #expect(corrected("Satz. \\emph") == nil)
        #expect(corrected("Satz. {das") == nil)
    }

    @Test("Code-Umgebungen werden erkannt, auch mit LaTeX-Befehlen im Code")
    func insideCode() {
        let text = "Text\n\\begin{PythonCode}\nx = 1\n\\begin{itemize}\ny\n" as NSString
        #expect(LatexEnvironments.isInsideCode(at: text.length, in: text))
        let closed = "\\begin{PythonCode}\nx\n\\end{PythonCode}\nText" as NSString
        #expect(!LatexEnvironments.isInsideCode(at: closed.length, in: closed))
        let prose = "\\begin{itemize}\n\\item Text" as NSString
        #expect(!LatexEnvironments.isInsideCode(at: prose.length, in: prose))
    }
}

private func kinds(_ text: String) -> [WritingHint.Kind] {
    WritingHints.hints(in: text).map(\.kind)
}

private func marked(_ text: String) -> [String] {
    let source = text as NSString
    return WritingHints.hints(in: text).map { source.substring(with: $0.range) }
}

@Suite("Schreibhinweise")
struct WritingHintsTests {
    @Test("Doppelte Wörter, auch über einen Zeilenumbruch und in anderer Schreibung, nicht über Absätze")
    func repeatedWords() {
        #expect(marked("Das ist das das Ende.") == ["das"])
        #expect(marked("Ende mit der\nder nächsten Zeile.") == ["der"])
        #expect(marked("Die die Leute") == ["die"])
        #expect(!kinds("Absatz der\n\nder nächste.").contains(.repeatedWord))
        #expect(kinds("Er ist ein Weinbauer bauer.").isEmpty, "Nur ganze Wörter")
    }

    @Test("Leerzeichen vor Satzzeichen, fehlendes Leerzeichen danach, mehrere Leerzeichen")
    func spacing() {
        #expect(kinds("Das ist so , und so.") == [.spaceBeforePunctuation])
        #expect(kinds("Satz ende .") == [.spaceBeforePunctuation])
        #expect(kinds("Wort,Wort hier.") == [.missingSpace])
        #expect(kinds("Ende.Neuer Satz.") == [.missingSpace])
        #expect(kinds("Zwei  Leerzeichen.") == [.multipleSpaces])
        #expect(kinds("Zahl 3,5 und 0.5 und z.B. hier").filter { $0 != .abbreviationSpacing }.isEmpty)
        #expect(kinds("\tEingerückt und Ende.").isEmpty, "Einrückung zählt nicht")
        #expect(kinds("Text % Kommentar  mit , Fehlern").isEmpty)
    }

    @Test("Typografie: z.B. ohne schmalen Abstand, Auslassungspunkte, gerade Anführungszeichen")
    func typography() {
        let hints = WritingHints.hints(in: "Das ist z.B. so, d. h. anders... und \"zitiert\" hier.")
        #expect(hints.map(\.kind) == [.abbreviationSpacing, .abbreviationSpacing, .ellipsis, .straightQuote, .straightQuote])
        #expect(hints[0].message.contains("z.\\,B."))
        #expect(kinds("Das ist z.\\,B. richtig.").isEmpty)
        #expect(kinds("Von J. R. Tolkien.").isEmpty, "Initialen")
        #expect(kinds("Das \\enquote{passt}\\dots{} so.").isEmpty)
    }

    @Test("Groß-/Kleinschreibung wie bei der Autokorrektur")
    func capitalization() {
        #expect(marked("Erster Satz. zweiter Satz.") == ["zweiter"])
        #expect(marked("Ein Satz pro Zeile.\nzweiter Satz.") == ["zweiter"])
        #expect(marked("Absatz.\n\n  neuer Absatz.") == ["neuer"])
        #expect(marked("Siehe z. B. dort und DIe Wand.").filter { !$0.contains(".") } == ["DIe"])
        #expect(kinds("Viele IDs. Und mehr.").isEmpty)
    }

    @Test("Fortgesetzter Satz nach einer Gleichung ist kein Fehlalarm")
    func noHintAfterEquation() {
        let text = """
            Um einen validen Zustand darzustellen, muss die Bedingung

            \\begin{equation}
              \\lvert\\alpha\\rvert^2 + \\lvert\\beta\\rvert^2 = 1
            \\end{equation}

            erfüllt sein.
            """
        #expect(!kinds(text).contains(.lowercaseSentenceStart))
        #expect(kinds("Text.\n\nerfüllt sein.").contains(.lowercaseSentenceStart))
    }

    @Test("Nur Fließtext: nicht in Präambel, Befehlen, Schlüsseln, Mathe, Kommentaren, Code, \\verb")
    func onlyProse() {
        let text = """
            \\documentclass{article}
            \\usepackage{a,b}  % Präambel , mit  Fehlern
            \\begin{document}
            Text mit $a  ,b$ und \\ref{fig:a,b} und \\cite[S. 3 ,4]{x}.
            \\begin{PythonCode}
            x = "a"  ,  y... das das
            \\end{PythonCode}
            Hier \\verb|a  ,b| Ende.
            % das das , hier
            \\begin{equation}
            a ,  b
            \\end{equation}
            \\end{document}
            """
        #expect(WritingHints.hints(in: text).isEmpty, "\(marked(text))")
    }

    @Test("Ohne \\begin{document} (eingebundene Kapiteldatei) wird alles geprüft; Hinweise nach Position sortiert")
    func chapterFile() {
        let hints = WritingHints.hints(in: "\\chapter{Titel}\nEin Satz ,und Wort,Wort. weiter")
        #expect(hints.map(\.kind) == [.spaceBeforePunctuation, .missingSpace, .lowercaseSentenceStart])
        #expect(hints.map(\.range.location) == hints.map(\.range.location).sorted())
    }
}
