import Foundation
import Testing
@testable import LatexEditor

@Suite("Verwendungen eines Namens")
struct UsageFinderTests {
    private let tex = URL(fileURLWithPath: "/p/a.tex")
    private let bib = URL(fileURLWithPath: "/p/lit.bib")

    @Test("Label: Definition zuerst erkennbar, Verweise mit Zeile und Auszug")
    func label() {
        let text = "Einleitung\n\\begin{figure}\n\t\\label{fig:a}\n\\end{figure}\nSiehe \\ref{fig:a} und \\autoref{fig:a}, \\ref{fig:b}.\n"
        let usages = UsageFinder.usages(of: RenameSubject(kind: .label, name: "fig:a"), in: text, url: tex)
        #expect(usages.map(\.line) == [3, 5, 5])
        #expect(usages.map(\.isDefinition) == [true, false, false])
        #expect(usages[0].excerpt == "\\label{fig:a}", "Einrückung entfällt")
        #expect(usages[1].id != usages[2].id, "zwei Treffer in einer Zeile sind getrennte Einträge")
        let match = usages[1].matchInExcerpt.map { (usages[1].excerpt as NSString).substring(with: $0) }
        #expect(match == "fig:a")
    }

    @Test("Quelle: Eintrag in der .bib ist die Definition, \\cite sind Verwendungen")
    func citation() {
        let key = RenameSubject(kind: .citation, name: "knuth")
        let uses = UsageFinder.usages(of: key, in: "Wie \\cite{knuth, lamport} zeigt.", url: tex)
        #expect(uses.count == 1)
        #expect(uses[0].isDefinition == false)
        let definition = UsageFinder.usages(of: key, in: "@book{knuth,\n  title = {TAOCP}\n}\n", url: bib)
        #expect(definition.map(\.isDefinition) == [true])
    }

    @Test("Abkürzung: \\newacronym ist die Definition")
    func acronym() {
        let text = "\\newacronym{api}{API}{Application Programming Interface}\nDie \\gls{api} und \\acrshort{api}.\n"
        let usages = UsageFinder.usages(of: RenameSubject(kind: .acronym, name: "api"), in: text, url: tex)
        #expect(usages.map(\.isDefinition) == [true, false, false])
    }

    @Test("Befehl und Umgebung: \\newcommand bzw. \\newenvironment sind Definitionen")
    func definitions() {
        let text = "\\newcommand{\\tool}[1]{\\textsf{#1}}\n\\tool{x} \\tool{y}\n\\newenvironment{box}{}{}\n\\begin{box}\\end{box}\n"
        let command = UsageFinder.usages(of: RenameSubject(kind: .command, name: "tool"), in: text, url: tex)
        #expect(command.map(\.isDefinition) == [true, false, false])
        let environment = UsageFinder.usages(of: RenameSubject(kind: .environment, name: "box"), in: text, url: tex)
        #expect(environment.first?.isDefinition == true)
        #expect(environment.dropFirst().allSatisfy { !$0.isDefinition })
    }

    @Test("Lange Zeilen: Ausschnitt um den Treffer mit Auslassungszeichen")
    func longLine() throws {
        let text = String(repeating: "wort ", count: 80) + "\\ref{ziel}" + String(repeating: " rest", count: 80)
        let usage = try #require(UsageFinder.usages(of: RenameSubject(kind: .label, name: "ziel"), in: text, url: tex).first)
        #expect(usage.excerpt.hasPrefix("…") && usage.excerpt.hasSuffix("…"))
        #expect((usage.excerpt as NSString).length <= UsageFinder.maximumExcerptLength + 2)
        let match = try #require(usage.matchInExcerpt)
        #expect((usage.excerpt as NSString).substring(with: match) == "ziel")
    }

    @Test("Kein Vorkommen: leere Liste")
    func none() {
        #expect(UsageFinder.usages(of: RenameSubject(kind: .label, name: "x"), in: "kein Label", url: tex).isEmpty)
    }
}
