import Foundation
import Testing
@testable import LatexEditor

private func found(_ subject: RenameSubject, in text: String, bib: Bool = false) -> [String] {
    let source = text as NSString
    return Renamer.occurrences(of: subject, in: text, isBibliography: bib).map { source.substring(with: $0) }
}

private func renamed(_ subject: RenameSubject, to name: String, in text: String, bib: Bool = false) -> String {
    Renamer.apply(Renamer.occurrences(of: subject, in: text, isBibliography: bib), newName: name, to: text)
}

@Suite("Umbenennen: Fundstellen")
struct RenamingOccurrenceTests {
    @Test("Label: Definition und alle Verweise, nicht Zitate, Kommentare, Verbatim")
    func labels() {
        let text = "\\label{a}\\ref{a}\\ref{ab}\\cref{x,a}\\cite{a}\\hyperref[a]{T} % \\ref{a}\n\\begin{verbatim}\\ref{a}\\end{verbatim}"
        #expect(found(RenameSubject(kind: .label, name: "a"), in: text).count == 4, "label, ref, cref-Liste, hyperref")
        #expect(renamed(RenameSubject(kind: .label, name: "a"), to: "fig:lang", in: "\\label{a} \\ref{a} \\cref{x,a}")
                == "\\label{fig:lang} \\ref{fig:lang} \\cref{x,fig:lang}")
    }

    @Test("Quelle im Text: alle Zitierbefehle, Listen, Vor-/Nachnote, \\nocite; nicht Labels")
    func citationsInText() {
        let text = "\\cite{knuth} \\parencite[vgl.][S.~3]{a, knuth} \\textcite{knuthx} \\nocite{knuth} \\ref{knuth} % \\cite{knuth}"
        let subject = RenameSubject(kind: .citation, name: "knuth")
        #expect(found(subject, in: text).count == 3)
        #expect(renamed(subject, to: "knuth84", in: text)
                == "\\cite{knuth84} \\parencite[vgl.][S.~3]{a, knuth84} \\textcite{knuthx} \\nocite{knuth84} \\ref{knuth} % \\cite{knuth}")
    }

    @Test("Quelle in der .bib: Eintragsschlüssel und Querverweise, nicht auskommentiert, nicht @string, nicht Feldinhalte")
    func citationsInBibliography() {
        let bib = """
            @book{knuth,
            \ttitle = {Über knuth},
            }
            % @book{knuth,
            @inbook{teil, crossref = {knuth}, xdata = {a, knuth}}
            @string{knuth = "x"}
            @article( knuth2 , year = 1)
            """
        let subject = RenameSubject(kind: .citation, name: "knuth")
        #expect(found(subject, in: bib, bib: true) == ["knuth", "knuth", "knuth"], "Kopf, crossref, xdata-Liste")
        let result = renamed(subject, to: "knuth84", in: bib, bib: true)
        #expect(result.contains("@book{knuth84,") && result.contains("crossref = {knuth84}") && result.contains("xdata = {a, knuth84}"))
        #expect(result.contains("Über knuth}") && result.contains("% @book{knuth,") && result.contains("@string{knuth"))
        #expect(found(RenameSubject(kind: .label, name: "knuth"), in: bib, bib: true).isEmpty, "In .bib nur Quellen")
    }

    @Test("Abkürzungen: \\newacronym/\\DeclareAcronym/\\newglossaryentry und \\ac, \\acp, \\Ac*, \\gls …")
    func acronyms() {
        let text = """
            \\newacronym[longplural={APIs}]{api}{API}{Programmierschnittstelle}
            \\DeclareAcronym{api}{short=API}
            Die \\ac{api}, \\acp{api}, \\Ac*{api}, \\gls{api}, \\acs{apis}, \\acronym{api} % \\ac{api}
            """
        let subject = RenameSubject(kind: .acronym, name: "api")
        #expect(found(subject, in: text).count == 6)
        #expect(Acronyms.definedKeys(in: text) == ["api"])
    }

    @Test("Eigene Befehle: Definition und Aufrufe, nicht längere Namen, nicht nach \\\\, nicht in Kommentaren")
    func commands() {
        let text = "\\newcommand{\\tool}{X}\n\\def\\tool{Y}\nMit \\tool, \\tool{} und \\tool\\ hier. \\toolbox \\\\tool \\\\\\tool % \\tool"
        let subject = RenameSubject(kind: .command, name: "tool")
        #expect(found(subject, in: text).count == 6, "zwei Definitionen, drei Aufrufe, \\\\\\tool (Umbruch + Befehl)")
        let result = renamed(subject, to: "werkzeug", in: text)
        #expect(result.contains("\\newcommand{\\werkzeug}") && result.contains("\\toolbox") && result.contains("\\\\tool ")
                && result.contains("% \\tool"))
    }

    @Test("Befehl unter dem Cursor: auf \\ und im Namen, nicht nach \\\\")
    func commandAtCursor() {
        let text = "a \\tool b \\\\word" as NSString
        #expect(CommandNames.name(at: 2, in: text) == "tool")
        #expect(CommandNames.name(at: 4, in: text) == "tool")
        #expect(CommandNames.name(at: 7, in: text) == "tool")
        #expect(CommandNames.name(at: 13, in: text) == nil, "\\\\ ist ein Zeilenumbruch")
        #expect(CommandNames.name(at: 0, in: text) == nil)
    }

    @Test("Umgebungen: Definition und alle \\begin/\\end; Paar mit Verschachtelung")
    func environments() {
        let text = """
            \\newenvironment{hinweis}{}{}
            \\begin{hinweis}
            \\begin{itemize}
            \\item \\begin{itemize} \\item x \\end{itemize}
            \\end{itemize}
            \\end{hinweis}
            """
        #expect(found(RenameSubject(kind: .environment, name: "hinweis"), in: text).count == 3)
        #expect(EnvironmentNames.definedNames(in: text) == ["hinweis"])

        let source = text as NSString
        let outerBegin = source.range(of: "\\begin{itemize}").location + 8
        let pair = EnvironmentNames.pair(at: outerBegin, in: source)
        #expect(pair.map { source.substring(with: $0.end) } == "itemize")
        #expect(pair?.end.location == source.range(of: "\\end{itemize}", options: .backwards).location + 5, "das äußere \\end")
        let innerEnd = source.range(of: "\\end{itemize}").location + 2
        #expect(EnvironmentNames.pair(at: innerEnd, in: source)?.begin.location
                == source.range(of: "\\begin{itemize} \\item x").location + 7, "vom \\end rückwärts zum inneren \\begin")
        #expect(EnvironmentNames.pair(at: 2, in: "\\begin{offen}\nText" as NSString) == nil)
    }
}

@Suite("Umbenennen: Erkennung und Prüfung")
struct RenamingDetectionTests {
    private func candidates(_ text: String, at marker: String, offset: Int = 1, bib: Bool = false) -> [RenameCandidate] {
        let source = text as NSString
        return Renamer.candidates(at: source.range(of: marker).location + offset, in: source, isBibliography: bib)
    }

    @Test("Was unter dem Cursor steht")
    func detection() {
        let text = "\\label{fig:a} \\cite{knuth} \\ac{api} \\begin{itemize}\n\\item \\tool\n\\end{itemize}\n\\newenvironment{box}{}{}"
        #expect(candidates(text, at: "fig:a") == [.project(RenameSubject(kind: .label, name: "fig:a"))])
        #expect(candidates(text, at: "knuth") == [.project(RenameSubject(kind: .citation, name: "knuth"))])
        #expect(candidates(text, at: "api") == [.project(RenameSubject(kind: .acronym, name: "api"))])
        let pair = candidates(text, at: "itemize")
        #expect(pair.count == 2)
        if case let .pair(found) = pair.first { #expect(found.name == "itemize") } else { Issue.record("Paar erwartet") }
        #expect(pair.last == .project(RenameSubject(kind: .environment, name: "itemize")))
        #expect(candidates(text, at: "tool") == [.project(RenameSubject(kind: .command, name: "tool"))])
        #expect(candidates(text, at: "{box}") == [.project(RenameSubject(kind: .environment, name: "box"))])
        #expect(candidates("Nur Text hier", at: "Text").isEmpty)
        #expect(candidates("@book{knuth,\n title={knuth}}", at: "knuth", bib: true)
                == [.project(RenameSubject(kind: .citation, name: "knuth"))])
        #expect(candidates("@book{knuth,\n title={knuth}}", at: "={knuth", offset: 3, bib: true).isEmpty, "Feldinhalt ist kein Schlüssel")
    }

    @Test("Neue Namen je Art")
    func validation() {
        let labels: Set<String> = ["a", "b"]
        #expect(Renamer.validate("fig:neu_1", kind: .label, old: "a", existing: labels) == nil)
        #expect(Renamer.validate("  ", kind: .label, old: "a", existing: labels) != nil)
        #expect(Renamer.validate("a", kind: .label, old: "a", existing: labels) == "Der Name ist unverändert.")
        #expect(Renamer.validate("b", kind: .label, old: "a", existing: labels) == "Ein Label mit diesem Namen gibt es schon.")
        #expect(Renamer.validate("x}y", kind: .citation, old: "a", existing: []) != nil)
        #expect(Renamer.validate("zwei worte", kind: .acronym, old: "a", existing: []) != nil)
        #expect(Renamer.validate("b", kind: .citation, old: "a", existing: labels) == "Eine Quelle mit diesem Namen gibt es schon.")

        #expect(Renamer.validate("\\werkzeug", kind: .command, old: "tool", existing: []) == nil, "mit \\ eingegeben")
        #expect(Renamer.normalized("\\werkzeug", kind: .command) == "werkzeug")
        #expect(Renamer.validate("tool2", kind: .command, old: "tool", existing: []) != nil)
        #expect(Renamer.validate("section", kind: .command, old: "tool", existing: ["section"]) == "Einen Befehl mit diesem Namen gibt es schon.")
        #expect(Renamer.validate("enumerate", kind: .environment, old: "itemize", existing: []) == nil)
        #expect(Renamer.validate("align*", kind: .environment, old: "align", existing: []) == nil)
        #expect(Renamer.validate("a*b", kind: .environment, old: "x", existing: []) != nil)
    }
}
