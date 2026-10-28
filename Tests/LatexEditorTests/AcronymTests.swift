import Foundation
import Testing
@testable import LatexEditor

@Suite("Abkürzungen und Glossar")
struct AcronymTests {
    private let file = URL(fileURLWithPath: "/p/glossar.tex")

    private let source = """
        % \\newacronym{kommentar}{K}{Kommentar}
        \\newacronym{api}{API}{Application Programming Interface}
        \\newacronym[plural=ABs]{ab}{AB}{Abkürzung,
          mit Umbruch}
        \\DeclareAcronym{cpu}{short = CPU, long = Central Processing Unit}
        \\newglossaryentry{algo}{name={Algorithmus}, description={Eine Folge von Schritten}}
        \\newabbreviation{ml}{ML}{Machine Learning}
        Die \\gls{api} und \\acrshort{cpu}, \\Gls{algo} \\ac{unbekannt}.
        """

    @Test("Definitionen mit Kurzform und Langform, Kommentare zählen nicht")
    func definitions() {
        let entries = Acronyms.definitions(in: source, file: file)
        #expect(entries.map(\.key) == ["api", "ab", "cpu", "algo", "ml"])
        #expect(entries[0].short == "API" && entries[0].long == "Application Programming Interface")
        #expect(entries[0].line == 2)
        #expect(entries[1].long == "Abkürzung, mit Umbruch", "Umbruch wird zu einem Leerzeichen")
        #expect(entries[2].short == "CPU" && entries[2].long == "Central Processing Unit")
        #expect(entries[3].short == "Algorithmus" && entries[3].long == "Eine Folge von Schritten")
        #expect(entries[4].summary == "ML – Machine Learning")
    }

    @Test("Vervollständigung in \\gls{…} und \\acrshort{…}")
    func completionContext() {
        for (text, prefix) in [("\\gls{ap", "ap"), ("\\acrshort{", ""), ("\\Gls{a", "a"), ("\\ac{cp", "cp")] {
            let nsText = text as NSString
            let context = CompletionContextDetector.detect(in: nsText, cursor: nsText.length, lineStart: 0)
            #expect(context?.kind == .argument(.acronym), "\(text)")
            #expect(context?.prefix == prefix)
        }
    }

    @Test("Unbekannte Abkürzung wird gemeldet, Definitionen und bekannte nicht; ohne Definitionen keine Prüfung")
    func unknown() {
        let problems = ReferenceChecker.problems(in: source, labels: [], citations: nil, acronyms: ["api", "cpu", "algo"])
        #expect(problems.map(\.key) == ["unbekannt"])
        #expect(problems[0].kind == .unknownAcronym)
        #expect(problems[0].message.contains("nicht definiert"))
        #expect(ReferenceChecker.problems(in: source, labels: [], citations: nil, acronyms: nil).isEmpty)
    }

    @Test("⌘-Klick auf den Schlüssel einer Abkürzung, nicht auf die Definition")
    func jump() {
        let text = source as NSString
        let use = text.range(of: "\\gls{api}")
        let target = JumpTargetFinder.target(at: use.location + 7, in: text)
        #expect(target?.target == .acronym("api"))
        let definition = text.range(of: "{api}{API}")
        #expect(JumpTargetFinder.target(at: definition.location + 2, in: text) == nil)
    }

    @Test("Index: Einträge, Verwendungen und \\glsaddall")
    func index() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{article}\n\\begin{document}\n\\input{glossar}\nEine \\gls{api}.\n\\end{document}\n")
        try project.write("glossar.tex", "\\newacronym{api}{API}{Application Programming Interface}\n\\newacronym{cpu}{CPU}{Central Processing Unit}\n")
        let files = [project.url("main.tex"), project.url("glossar.tex")]
        let index = CompletionIndex.build(files: files, styleFiles: [], projectRoot: project.root, mainFile: project.url("main.tex"))
        #expect(index.acronymEntries.map(\.key) == ["api", "cpu"])
        #expect(index.acronyms == ["api", "cpu"])
        #expect(index.usedAcronyms == ["api"])
        #expect(!index.usesAllAcronyms)

        try project.write("main.tex", "\\glsaddall\n")
        let all = CompletionIndex.build(files: files, styleFiles: [], projectRoot: project.root, mainFile: project.url("main.tex"))
        #expect(all.usesAllAcronyms)
    }

    @Test("Hinweise: ungenutzte Abkürzungen aus dem Index")
    @MainActor
    func unusedHints() {
        let store = ReferenceCheckStore()
        var index = CompletionIndex()
        let used = AcronymEntry(key: "a", short: "A", long: "Alpha", file: file, line: 1)
        let unused = AcronymEntry(key: "b", short: "B", long: "Beta", file: file, line: 2)
        index.acronymEntries = [used, unused]
        index.usedAcronyms = ["a"]
        store.indexChanged(index, isLoaded: true, openSessions: [])
        #expect(store.unusedAcronyms == [unused])
        index.usesAllAcronyms = true
        store.indexChanged(index, isLoaded: true, openSessions: [])
        #expect(store.unusedAcronyms.isEmpty)
    }
}
