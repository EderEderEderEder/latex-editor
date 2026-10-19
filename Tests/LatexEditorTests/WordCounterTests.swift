import Foundation
import Testing
@testable import LatexEditor

@Suite("Wortzähler")
struct WordCounterTests {
    private func count(_ text: String) -> Int { WordCounter.count(in: text) }

    @Test("Einfacher Text, Satzzeichen, Zeilenumbrüche, Zahlen")
    func plainText() {
        #expect(count("") == 0)
        #expect(count("Das ist ein Test.") == 4)
        #expect(count("Eins,\nzwei;  drei!") == 3)
        #expect(count("Im Jahr 2024 gab es 3 Fälle.") == 7)
        #expect(count("Umlaute: Übergrößenträger") == 2)
        #expect(count("a ~ b") == 2, "~ ist ein Leerraum")
    }

    @Test("Wörter mit Bindestrich, Apostroph und Dezimalzahlen sind eins; Gedankenstrich trennt")
    func joiners() {
        #expect(count("state-of-the-art") == 1)
        #expect(count("don't") == 1)
        #expect(count("Wert 3.14 und 2,5") == 4)
        #expect(count("eins--zwei") == 2)
        #expect(count("Ende. Neu") == 2, "Punkt zwischen Wörtern trennt")
    }

    @Test("Kommentare und Präambel zählen nicht; \\% ist kein Kommentar")
    func commentsAndPreamble() {
        #expect(count("Text % ein Kommentar\nmehr") == 2)
        #expect(count("50\\% sicher") == 2)
        #expect(count("\\documentclass{report}\n\\usepackage{x}\n\\begin{document}\nHallo Welt\n\\end{document}\nNachspann") == 2)
    }

    @Test("Befehle zählen nicht, ihr Text schon; Optionen und Schlüssel nicht")
    func commands() {
        #expect(count("\\textbf{fett} und \\emph{kursiv}") == 3)
        #expect(count("\\section{Die Einleitung}\\label{sec:ein}") == 2)
        #expect(count("Wie in \\cref{fig:a} und \\cite[S.~3]{autor2024} gezeigt") == 4)
        #expect(count("\\section[Kurz]{Der lange Titel}") == 3, "Kurzform zählt nicht doppelt")
        #expect(count("\\includegraphics[width=.5\\textwidth]{bild.png} Text") == 1)
        #expect(count("Haus\\footnote{Eine Fußnote hier}") == 4)
        #expect(count("\\input{kapitel/eins}\\include{zwei}") == 0)
        #expect(count("\\usepackage[utf8]{inputenc}Text") == 1)
        #expect(count("\\newcommand{\\neu}[1]{Makro #1}Text") == 1, "Makrodefinition zählt nicht")
        #expect(count("\\textcolor{red}{rot gefärbt}") == 2)
        #expect(count("\\verb|\\ref{x}| danach") == 1)
    }

    @Test("Formeln, Code und Umgebungen mit Inhalt, der kein Text ist")
    func mathAndCode() {
        #expect(count("Es gilt $x^2 + y^2$ immer") == 3)
        #expect(count("$$a = b$$ danach") == 1)
        #expect(count("Siehe \\(a+b\\) und \\[c+d\\] fertig") == 3)
        #expect(count("Vor\\begin{equation}a+b\\end{equation}Nach") == 2)
        #expect(count("\\begin{align*} a &= b \\\\ c &= d \\end{align*} Wort") == 1)
        #expect(count("\\begin{lstlisting}\nprint(1)\n\\end{lstlisting}\nEnde") == 1)
        #expect(count("\\begin{program}\\caption{Beispiel}\\begin{PythonCode}\nx = 1\n\\end{PythonCode}\\end{program}") == 1)
        #expect(count("Der Preis ist 5\\$ hoch") == 5, "\\$ ist kein Formelanfang")
        #expect(count("offen $x+y\n\nNeuer Absatz hier") == 4, "offene Formel endet an der Leerzeile")
    }

    @Test("Umgebungen: Spaltenformat, Platzierung und Listen")
    func environments() {
        #expect(count("\\begin{tabular}{@{}lr@{}}Name & Wert\\\\ A & B\\end{tabular}") == 4)
        #expect(count("\\begin{figure}[H]\\caption{Ein Bild}\\end{figure}") == 2)
        #expect(count("\\begin{itemize}\\item Eins\\item Zwei drei\\end{itemize}") == 3)
        #expect(count("\\begin{minipage}{0.5\\textwidth}Inhalt\\end{minipage}") == 1)
    }

    @Test("Akzente und Sonderbuchstaben trennen das Wort nicht")
    func accents() {
        #expect(count("Schr\\\"oder") == 1)
        #expect(count("Schr\\\"{o}der und Stra\\ss{}e") == 3)
        #expect(count("Fran\\c{c}ais") == 1)
        #expect(count("\\'Uber") == 1)
    }

    @Test("Zeilenumbruch mit Abstand, Dollar mit Escape in Formel")
    func linebreakAndEscapes() {
        #expect(count("eins\\\\[1ex] zwei") == 2)
        #expect(count("$a\\$b$ Rest") == 1)
    }

    /// Bewusst klein (gemessen: ca. 35 µs pro Zeile im Debug-Build): Die Gesamtläufe der Tests teilen sich die
    /// Maschine mit zeitempfindlichen Budget-Tests.
    @Test("Schnell genug und linear: 2.000 Zeilen Text")
    func performance() {
        let line = "Das ist ein \\textbf{Satz} mit $x^2$ und \\cite{key} sowie einem Kommentar. % weg\n"
        let lines = 2_000
        let start = ContinuousClock.now
        let words = count(String(repeating: line, count: lines))
        let elapsed = ContinuousClock.now - start
        #expect(words == lines * 9)
        #expect(elapsed < .milliseconds(500), "Debug-Build, läuft im Hintergrund")
    }
}
