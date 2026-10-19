import AppKit
import Foundation
import Testing
@testable import LatexEditor

@Suite("Prüfung auf unbekannte Verweise: Store", .serialized)
@MainActor
struct ReferenceCheckStoreTests {
    private func session(_ text: String, name: String = "kapitel.tex") -> DocumentSession {
        DocumentSession(url: URL(fileURLWithPath: "/tmp/\(name)"), text: text)
    }

    @Test("Probleme pro Datei, entprellt; nach einer Korrektur verschwinden sie")
    func checksSession() async throws {
        let store = ReferenceCheckStore()
        store.knownLabels = { ["a"] }
        store.knownCitations = { ["x"] }
        let session = session("\\ref{a} \\ref{fehlt} \\cite{x,y}")
        store.schedule(session)
        #expect(store.problems(for: session.url).isEmpty, "erst nach der Pause")
        await store.waitUntilIdle()
        #expect(store.problems(for: session.url).map(\.key) == ["fehlt", "y"])

        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: session.textStorage.length), with: "\\ref{a}")
        store.schedule(session, immediately: true)
        await store.waitUntilIdle()
        #expect(store.problems(for: session.url).isEmpty)
    }

    @Test("Ohne Index nicht prüfen; ohne Literatur keine Zitatprüfung; .bib wird nicht geprüft")
    func skips() async throws {
        let store = ReferenceCheckStore()
        let tex = session("\\ref{x} \\cite{y}")
        store.knownLabels = { nil }
        store.schedule(tex, immediately: true)
        await store.waitUntilIdle()
        #expect(store.problems(for: tex.url).isEmpty, "Index nicht gelesen: alles wäre „unbekannt“")

        store.knownLabels = { [] }
        store.knownCitations = { nil }
        store.schedule(tex, immediately: true)
        await store.waitUntilIdle()
        #expect(store.problems(for: tex.url).map(\.key) == ["x"])

        let bib = session("\\ref{x}", name: "lit.bib")
        store.schedule(bib, immediately: true)
        await store.waitUntilIdle()
        #expect(store.problems(for: bib.url).isEmpty)
    }

    @Test("Hinweise: ungenutzte Labels und Quellen aus dem Index; \\nocite{*} und fehlender Index")
    func hints() {
        let store = ReferenceCheckStore()
        let file = URL(fileURLWithPath: "/p/a.tex")
        var index = CompletionIndex()
        index.catalog.labels = [LabelEntry(label: "a", file: file, line: 1), LabelEntry(label: "b", file: file, line: 2)]
        index.catalog.bibEntries = [BibEntry(key: "k1", title: "T1"), BibEntry(key: "k2", title: "T2")]
        index.usedLabels = ["a"]
        index.usedCitations = ["k1"]

        store.indexChanged(index, isLoaded: true, openSessions: [])
        #expect(store.unusedLabels.map(\.label) == ["b"])
        #expect(store.unusedSources.map(\.key) == ["k2"])

        index.citesEverything = true
        store.indexChanged(index, isLoaded: true, openSessions: [])
        #expect(store.unusedSources.isEmpty)

        store.indexChanged(index, isLoaded: false, openSessions: [])
        #expect(store.unusedLabels.isEmpty, "ohne gelesenen Index keine Hinweise")
    }

    @Test("Geschlossene Dateien verlieren ihre Probleme, Zurücksetzen räumt alles")
    func retainAndReset() async throws {
        let store = ReferenceCheckStore()
        store.knownLabels = { [] }
        let one = session("\\ref{x}", name: "eins.tex")
        let two = session("\\ref{y}", name: "zwei.tex")
        store.schedule(one, immediately: true)
        store.schedule(two, immediately: true)
        await store.waitUntilIdle()
        store.retain([one.url])
        #expect(!store.problems(for: one.url).isEmpty)
        #expect(store.problems(for: two.url).isEmpty)
        store.reset()
        #expect(store.problems(for: one.url).isEmpty)
    }
}

@Suite("Unbekannte Verweise im Editor", .serialized)
@MainActor
struct ReferenceUnderlineTests {
    private func underline(at index: Int, in harness: CompletionHarness) -> Bool {
        let layoutManager = harness.textView.layoutManager
        return layoutManager?.temporaryAttribute(.underlineStyle, atCharacterIndex: index, effectiveRange: nil) != nil
    }

    @Test("Der Schlüssel wird unterstrichen (mit Hinweistext), sonst nichts; Entfernen und Dateiwechsel räumen auf")
    func underlinesKey() async throws {
        let text = "Siehe \\ref{fehlt} und \\ref{da}"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        let range = (text as NSString).range(of: "fehlt")
        let problem = ReferenceProblem(kind: .unknownLabel, key: "fehlt", range: range)

        harness.coordinator.updateReferenceProblems([problem])
        try await Task.sleep(for: .milliseconds(60))
        #expect(underline(at: range.location, in: harness))
        #expect(underline(at: NSMaxRange(range) - 1, in: harness))
        #expect(!underline(at: range.location - 2, in: harness), "„{“ davor bleibt frei")
        #expect(!underline(at: NSMaxRange(range) + 1, in: harness), "„}“ danach bleibt frei")
        #expect(!underline(at: (text as NSString).range(of: "da}").location, in: harness))
        let tip = harness.textView.layoutManager?.temporaryAttribute(.toolTip, atCharacterIndex: range.location, effectiveRange: nil) as? String
        #expect(tip?.contains("fehlt") == true)
        #expect(!harness.session.isDirty, "temporäre Attribute ändern den Text nicht")

        harness.coordinator.updateReferenceProblems([])
        try await Task.sleep(for: .milliseconds(60))
        #expect(!underline(at: range.location, in: harness))
    }

    @Test("Ränge hinter dem Textende werden ignoriert")
    func staleRanges() async throws {
        let harness = CompletionHarness(text: "kurz")
        try await harness.start()
        harness.coordinator.updateReferenceProblems([ReferenceProblem(kind: .unknownLabel, key: "x", range: NSRange(location: 100, length: 5))])
        try await Task.sleep(for: .milliseconds(60))
        #expect(!underline(at: 0, in: harness))
    }
}

extension AppModelSuite {
@Suite("Verweisprüfung im Projekt (App-Ebene)")
@MainActor
struct ReferenceCheckAppTests {
    private let model = AppModel.shared

    @Test("Offene Datei: unbekanntes Label und Zitat werden gefunden, bekannte nicht; Hinweise aus dem Index")
    func projectCheck() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("main.tex", "\\documentclass{report}\n\\bibliography{lit}\n\\begin{document}\n\\input{kapitel}\n\\end{document}\n")
        try project.write("kapitel.tex", "\\chapter{A}\\label{cha:a}\nSiehe \\ref{cha:a}, \\ref{cha:fehlt} und \\cite{bekannt,unbekannt}.\n\\label{ungenutzt}\n")
        try project.write("lit.bib", "@book{bekannt, title={Eins}}\n@book{nichtzitiert, title={Zwei}}\n")
        await model.openProject(project.root)
        await model.editor.open(project.url("kapitel.tex"), asPreview: false)
        await model.referenceChecks.waitUntilIdle()
        for _ in 0..<100 where model.referenceChecks.problems(for: project.url("kapitel.tex")).isEmpty {
            try await Task.sleep(for: .milliseconds(50))
        }

        let problems = model.referenceChecks.problems(for: project.url("kapitel.tex"))
        #expect(problems.map(\.key) == ["cha:fehlt", "unbekannt"])
        #expect(model.referenceChecks.unusedLabels.map(\.label) == ["ungenutzt"])
        #expect(model.referenceChecks.unusedSources.map(\.key) == ["nichtzitiert"])
        let source = try #require(model.referenceChecks.unusedSources.first)
        #expect(source.file == project.url("lit.bib"))
        #expect(source.line == 2)

        // Tippen: das fehlende Label wird angelegt → Problem verschwindet nach der Pause
        let session = try #require(model.editor.session(for: project.url("kapitel.tex")))
        session.replaceText(with: session.textStorage.string + "\\label{cha:fehlt}\n", actionName: "Tippen")
        for _ in 0..<100 where model.referenceChecks.problems(for: project.url("kapitel.tex")).count != 1 {
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(model.referenceChecks.problems(for: project.url("kapitel.tex")).map(\.key) == ["unbekannt"],
                "das nur im Editor (ungespeichert) definierte Label zählt als bekannt")
    }
}
}
