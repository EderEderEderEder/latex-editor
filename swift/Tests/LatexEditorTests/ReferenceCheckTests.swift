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

    @Test("Schreibhinweise auch ohne gelesenen Index; .bib bekommt keine; geschlossene Dateien verlieren sie")
    func writingHints() async throws {
        let store = ReferenceCheckStore()
        store.knownLabels = { nil }
        let tex = session("Das das Ende. klein")
        store.schedule(tex, immediately: true)
        await store.waitUntilIdle()
        #expect(store.hints(for: tex.url).map(\.kind) == [.repeatedWord, .lowercaseSentenceStart])

        let bib = session("@book{a, title = {das das}}", name: "lit.bib")
        store.schedule(bib, immediately: true)
        await store.waitUntilIdle()
        #expect(store.hints(for: bib.url).isEmpty)

        store.retain([])
        #expect(store.hints(for: tex.url).isEmpty)
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

        harness.coordinator.updateTextMarks(problems: [problem], hints: [])
        try await Task.sleep(for: .milliseconds(60))
        #expect(underline(at: range.location, in: harness))
        #expect(underline(at: NSMaxRange(range) - 1, in: harness))
        #expect(!underline(at: range.location - 2, in: harness), "„{“ davor bleibt frei")
        #expect(!underline(at: NSMaxRange(range) + 1, in: harness), "„}“ danach bleibt frei")
        #expect(!underline(at: (text as NSString).range(of: "da}").location, in: harness))
        let tip = harness.textView.layoutManager?.temporaryAttribute(.toolTip, atCharacterIndex: range.location, effectiveRange: nil) as? String
        #expect(tip?.contains("fehlt") == true)
        #expect(!harness.session.isDirty, "temporäre Attribute ändern den Text nicht")

        harness.coordinator.updateTextMarks(problems: [], hints: [])
        try await Task.sleep(for: .milliseconds(60))
        #expect(!underline(at: range.location, in: harness))
    }

    @Test("Schreibhinweise blau gepunktet mit Tooltip; bei Überschneidung gewinnt der unbekannte Verweis")
    func hintsUnderlined() async throws {
        let text = "Das das Ende \\ref{fehlt}"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        let source = text as NSString
        let word = source.range(of: "das")
        let key = source.range(of: "fehlt")
        let hints = [WritingHint(kind: .repeatedWord, range: word, message: "„das“ steht zweimal hintereinander."),
                     WritingHint(kind: .missingSpace, range: key, message: "Hinweis")]
        let problem = ReferenceProblem(kind: .unknownLabel, key: "fehlt", range: key)

        harness.coordinator.updateTextMarks(problems: [problem], hints: hints)
        try await Task.sleep(for: .milliseconds(60))
        let layoutManager = try #require(harness.textView.layoutManager)
        #expect(layoutManager.temporaryAttribute(.underlineColor, atCharacterIndex: word.location, effectiveRange: nil) as? NSColor == .systemBlue)
        #expect(layoutManager.temporaryAttribute(.toolTip, atCharacterIndex: word.location, effectiveRange: nil) as? String
                == "„das“ steht zweimal hintereinander.")
        #expect(layoutManager.temporaryAttribute(.underlineColor, atCharacterIndex: key.location, effectiveRange: nil) as? NSColor == .systemRed)

        harness.coordinator.updateTextMarks(problems: [], hints: [])
        try await Task.sleep(for: .milliseconds(60))
        #expect(!underline(at: word.location, in: harness))
    }

    @Test("Fehler rot gestrichelt, Warnungen orange strichpunktiert; die schwerere Markierung gewinnt")
    func diagnosticsStyles() async throws {
        let text = "\\textbf{a und \\label{x} \\label{x}"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        let source = text as NSString
        let brace = source.range(of: "{")
        let label = source.range(of: "x")
        let marks = [
            TextMark(severity: .error, range: brace, message: "Klammer"),
            TextMark(severity: .warning, range: label, message: "doppelt"),
            TextMark(severity: .error, range: label, message: "schwerer"),
        ]
        harness.coordinator.updateTextMarks(problems: [], hints: [], diagnostics: marks)
        try await Task.sleep(for: .milliseconds(60))
        let layoutManager = try #require(harness.textView.layoutManager)
        func attribute(_ key: NSAttributedString.Key, at index: Int) -> Any? {
            layoutManager.temporaryAttribute(key, atCharacterIndex: index, effectiveRange: nil)
        }
        #expect(attribute(.underlineColor, at: brace.location) as? NSColor == .systemRed)
        #expect(attribute(.underlineColor, at: label.location) as? NSColor == .systemRed)
        #expect(attribute(.toolTip, at: label.location) as? String == "schwerer")
        let dashed = NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDash.rawValue
        #expect(attribute(.underlineStyle, at: brace.location) as? Int == dashed)

        let warning = [TextMark(severity: .warning, range: label, message: "doppelt")]
        harness.coordinator.updateTextMarks(problems: [], hints: [], diagnostics: warning)
        try await Task.sleep(for: .milliseconds(60))
        #expect(attribute(.underlineColor, at: label.location) as? NSColor == .systemOrange)
        let dashDot = NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDashDot.rawValue
        #expect(attribute(.underlineStyle, at: label.location) as? Int == dashDot)
        #expect(attribute(.underlineStyle, at: brace.location) == nil)
    }

    @Test("Meldungen des Builds unterstreichen die Zeile ohne Einrückung; Boxen und leere Zeilen nicht")
    func buildLinesUnderlined() async throws {
        let text = "eins\n   zwei fehler\n\ndrei warnung\nvier box\n"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        let source = text as NSString
        let marks: [Int: BuildIssue.Severity] = [2: .error, 3: .error, 4: .warning, 5: .badBox]
        harness.coordinator.updateTextMarks(problems: [], hints: [], buildLines: marks, buildMessages: [2: "Undefined control sequence."])
        try await Task.sleep(for: .milliseconds(60))
        let layoutManager = try #require(harness.textView.layoutManager)
        func color(at index: Int) -> NSColor? {
            layoutManager.temporaryAttribute(.underlineColor, atCharacterIndex: index, effectiveRange: nil) as? NSColor
        }
        let errorLine = source.range(of: "zwei")
        #expect(color(at: errorLine.location) == .systemRed)
        #expect(color(at: errorLine.location - 1) == nil, "Einrückung bleibt frei")
        #expect(layoutManager.temporaryAttribute(.toolTip, atCharacterIndex: errorLine.location, effectiveRange: nil) as? String == "Undefined control sequence.")
        #expect(color(at: source.range(of: "drei").location) == .systemOrange)
        #expect(color(at: source.range(of: "vier").location) == nil)
        #expect(color(at: 0) == nil)
    }

    @Test("Ränge hinter dem Textende werden ignoriert")
    func staleRanges() async throws {
        let harness = CompletionHarness(text: "kurz")
        try await harness.start()
        harness.coordinator.updateTextMarks(problems: [ReferenceProblem(kind: .unknownLabel, key: "x", range: NSRange(location: 100, length: 5))], hints: [])
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
