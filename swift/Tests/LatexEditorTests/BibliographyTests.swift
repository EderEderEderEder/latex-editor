import AppKit
import Foundation
import SwiftUI
import Testing
@testable import LatexEditor

@Suite("Literatur: Parser, Autoren, Schlüssel")
struct BibliographyParserTests {
    @Test("Felder mit {…} (verschachtelt), \"…\", Zahlen, Verkettung; Kommentare und @comment werden übersprungen")
    func parse() throws {
        let records = BibParser.parse("""
            % @book{auskommentiert, title={X}}
            @comment{ignoriert}
            @Book{Knuth1984,
              Author = {Knuth, Donald E.},
              title = {The {\\TeX}book},
              year = 1984,
              note = "Teil " # "2",
            }
            @online{web, title={Seite}, url={https://example.com/a_b}}
            """)

        #expect(records.map(\.key) == ["Knuth1984", "web"])
        let book = try #require(records.first)
        #expect(book.type == "book")
        #expect(book.value("author") == "Knuth, Donald E.")
        #expect(book.value("title") == "The {\\TeX}book")
        #expect(book.value("year") == "1984")
        #expect(book.value("note") == "Teil 2")
        #expect(records[1].value("url") == "https://example.com/a_b")
    }

    @Test("Katalog: Autor kurz, Jahr aus date oder year, Titel ohne Klammern")
    func catalogEntries() {
        let entries = ProjectCatalog.bibEntries(in: """
            @book{a, author={Mustermann, Max and Musterfrau, Erika and Dritter, D}, title={Ein {LaTeX} Buch}, date={2024-03-01}}
            @article{b, author={Erika Musterfrau}, title={Artikel}, year={2021}}
            """)

        #expect(entries.map(\.summary) == ["Mustermann u. a. 2024 · Ein LaTeX Buch", "Musterfrau 2021 · Artikel"])
    }

    @Test("Autoren: „Vorname Nachname; …“ wird zu „Nachname, Vorname and …“, Bestehendes bleibt")
    func authors() {
        #expect(BibAuthors.bibtex(from: "Max Mustermann; Erika Musterfrau") == "Mustermann, Max and Musterfrau, Erika")
        #expect(BibAuthors.bibtex(from: "Mustermann, Max\nAnna Maria Huber") == "Mustermann, Max and Huber, Anna Maria")
        #expect(BibAuthors.bibtex(from: "Knuth, D. and Lamport, L.") == "Knuth, D. and Lamport, L.")
        #expect(BibAuthors.bibtex(from: "Wikipedia") == "Wikipedia")
        #expect(BibAuthors.short("Mustermann, Max and Musterfrau, Erika") == "Mustermann und Musterfrau")
    }

    @Test("Schlüssel: Nachname + Jahr, Umlaute umschrieben, eindeutig mit a, b; ohne Autor das Titelwort")
    func keys() {
        #expect(BibKey.make(authors: "Müller, Jörg", title: "", year: "2024", existing: []) == "Mueller2024")
        #expect(BibKey.make(authors: "Müller, Jörg", title: "", year: "2024", existing: ["Mueller2024", "Mueller2024a"]) == "Mueller2024b")
        #expect(BibKey.make(authors: "", title: "Café Guide", year: "2020", existing: []) == "Cafe2020")
        #expect(BibKey.isValid("Knuth1984:tex-book_2"))
        #expect(!BibKey.isValid("Müller 2024"))
    }

    @Test("Formatierung wie die Vorlage; Sonderzeichen maskiert, URL und DOI nicht")
    func formatting() {
        let entry = BibFormatter.entry(type: "book", key: "Mustermann2024", fields: [
            ("author", "Mustermann, Max"), ("title", "Daten & Netze 100%"), ("publisher", ""), ("url", "https://x.org/a_b"),
        ])
        #expect(entry == "@book{Mustermann2024,\n\tauthor={Mustermann, Max},\n\ttitle={Daten \\& Netze 100\\%},\n\turl={https://x.org/a_b}\n}\n")
        #expect(BibFormatter.escaped("schon \\& maskiert", field: "title") == "schon \\& maskiert")
    }

    @Test("Zieldatei aus \\bibliography{…} der Hauptdatei; eine Leerzeile Abstand beim Anhängen")
    func bibliographyFile() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "")
        let other = try project.write("andere.bib", "")
        let target = try project.write("hgbreferences.bib", "")

        #expect(BibliographyFile.target(mainFile: main, mainText: "\\bibliography{hgbreferences} % Biblatex", projectFiles: [other, target]) == target)
        #expect(BibliographyFile.target(mainFile: main, mainText: "", projectFiles: [other, target]) == other)
        #expect(BibliographyFile.appendix(for: "@x{}\n", after: "") == "@x{}\n")
        #expect(BibliographyFile.appendix(for: "@x{}\n", after: "@a{}\n") == "\n@x{}\n")
        #expect(BibliographyFile.appendix(for: "@x{}\n", after: "@a{}") == "\n\n@x{}\n")
    }
}

@Suite("Literatur: neue Quelle")
struct SourceBuilderTests {
    private let today = ISO8601DateFormatter().date(from: "2026-10-15T10:00:00Z")!

    @Test("Formular Buch: vollständiger Eintrag mit Sprache, Schlüssel automatisch")
    func book() throws {
        var settings = SourceSettings()
        settings.authors = "Max Mustermann"
        settings.values = ["title": "Ein Buchtitel", "publisher": "Verlag", "location": "Hagenberg", "date": "2024"]
        let draft = try SourceBuilder.draft(from: settings, existingKeys: [], today: today).get()

        #expect(draft.key == "Mustermann2024")
        #expect(draft.entry == """
            @book{Mustermann2024,
            \tauthor={Mustermann, Max},
            \ttitle={Ein Buchtitel},
            \tpublisher={Verlag},
            \tlocation={Hagenberg},
            \tdate={2024},
            \tlangid={ngerman}
            }

            """)
    }

    @Test("Fehlende Pflichtfelder werden genannt; Webseite bekommt das heutige Abrufdatum")
    func validation() throws {
        var settings = SourceSettings()
        settings.values = ["title": "X"]
        #expect(SourceBuilder.draft(from: settings, existingKeys: [], today: today) == .failure(.missingFields(["Autor", "Verlag", "Jahr"])))

        settings.type = .online
        settings.values = ["title": "Dokumentation", "url": "https://swift.org", "organization": "Apple"]
        settings.language = .english
        let draft = try SourceBuilder.draft(from: settings, existingKeys: [], today: today).get()
        #expect(draft.key == "Dokumentation")
        #expect(draft.entry.contains("\turldate={2026-10-15},"))
        #expect(draft.entry.contains("\tlangid={english}"))
    }

    @Test("BibTeX einfügen: Felder bleiben unverändert, ungültiger oder doppelter Schlüssel wird ersetzt")
    func bibtex() throws {
        var settings = SourceSettings()
        settings.mode = .bibtex
        settings.bibtex = "@article{Müller 2020, author={Müller, Jörg}, title={Über $\\alpha$}, year={2020}}"
        let draft = try SourceBuilder.draft(from: settings, existingKeys: ["Mueller2020"], today: today).get()

        #expect(draft.key == "Mueller2020a")
        #expect(draft.entry == "@article{Mueller2020a,\n\tauthor={Müller, Jörg},\n\ttitle={Über $\\alpha$},\n\tyear={2020}\n}\n")

        settings.bibtex = "kein Eintrag"
        #expect(SourceBuilder.draft(from: settings, existingKeys: [], today: today) == .failure(.noBibtexEntry))
    }

    @Test("Eigener Schlüssel wird übernommen, wenn gültig und frei")
    func ownKey() throws {
        var settings = SourceSettings()
        settings.mode = .bibtex
        settings.bibtex = "@book{alt, title={T}, author={A, B}, year={2000}}"
        settings.keyOverride = "mein-buch"
        #expect(try SourceBuilder.draft(from: settings, existingKeys: [], today: today).get().key == "mein-buch")
    }
}

@Suite("Vervollständigung: Zitate nach Autor, Titel, Jahr")
struct CitationSearchTests {
    @Test("Suche findet über Autor und Titel, Treffer im Schlüssel stehen vorne")
    @MainActor
    func search() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let bib = try project.write("literatur.bib", """
            @book{Knuth1984, author={Knuth, Donald}, title={The TeXbook}, year={1984}}
            @book{lamport94, author={Lamport, Leslie}, title={LaTeX: A Document Preparation System}, year={1994}}
            @book{texbuch, author={Kopka, Helmut}, title={LaTeX Einführung}, year={2002}}
            """)
        let provider = CompletionProvider()
        await provider.reload(files: [bib], projectRoot: project.root, mainFile: nil)
        let items = provider.items(for: CompletionContext(kind: .argument(.citation), prefix: "", range: NSRange()), document: "" as NSString, cursor: 0)

        #expect(CompletionMatcher.rank(items, prefix: "lamport").map(\.text) == ["lamport94"])
        #expect(CompletionMatcher.rank(items, prefix: "kopka").map(\.text) == ["texbuch"])
        #expect(CompletionMatcher.rank(items, prefix: "1984").map(\.text) == ["Knuth1984"])
        #expect(CompletionMatcher.rank(items, prefix: "tex").map(\.text) == ["texbuch", "Knuth1984", "lamport94"])
        #expect(items.first { $0.text == "Knuth1984" }?.detail == "Knuth 1984 · The TeXbook")
    }
}

extension AppModelSuite {
@Suite("Quelle anlegen (App-Ebene)")
@MainActor
struct SourceInsertTests {
    private let model = AppModel.shared

    private func makeProject() async throws -> TemporaryProject {
        let project = try TemporaryProject()
        try project.write("main.tex", "\\documentclass{report}\n\\bibliography{literatur}\n\\begin{document}\nText \n\\end{document}\n")
        try project.write("literatur.bib", "@book{alt, author={A, B}, title={T}, date={2000}}\n")
        model.build.compileOnSave = false
        await model.openProject(project.root)
        return project
    }

    @Test("Formular: Eintrag kommt ans Ende der .bib, Zitat an die Cursorposition, Vervollständigung kennt ihn")
    func insertFromForm() async throws {
        let project = try await makeProject()
        defer { project.remove(); model.build.compileOnSave = true }
        let session = try #require(model.editor.current)
        let cursor = (session.textStorage.string as NSString).range(of: "Text ").upperBound
        model.presentInsert(.source)
        await model.insertion.waitForCatalog()
        model.insertion.source.authors = "Erika Musterfrau"
        model.insertion.source.values = ["title": "Neues Buch", "publisher": "Verlag", "date": "2025"]
        model.insertion.source.note = "S.~3"

        let window = try await showEditor(selecting: cursor)
        defer { window.contentView = NSView() }
        await model.performInsert()
        try await Task.sleep(for: .milliseconds(50))

        let bib = try String(contentsOf: project.url("literatur.bib"), encoding: .utf8)
        #expect(bib.hasPrefix("@book{alt, author={A, B}, title={T}, date={2000}}\n\n@book{Musterfrau2025,\n\tauthor={Musterfrau, Erika},"))
        #expect(session.textStorage.string.contains("Text \\cite[S.~3]{Musterfrau2025}"))
        #expect(model.completionProvider.index.catalog.bibEntries.map(\.key).contains("Musterfrau2025"))
        #expect(!model.insertion.isPresented)
    }

    @Test("Geschlossene Latin-1-.bib bleibt erhalten; unlesbare .bib wird nie überschrieben")
    func appendKeepsBibliography() async throws {
        let project = try await makeProject()
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: project.url("literatur.bib").path)
            project.remove()
            model.build.compileOnSave = true
        }
        let original = "@book{alt, author={Müller, A}, title={Größe}, date={2000}}\n"
        try #require(original.data(using: .isoLatin1)).write(to: project.url("literatur.bib"))
        model.presentInsert(.source)
        await model.insertion.waitForCatalog()
        model.insertion.source.mode = .bibtex
        model.insertion.source.bibtex = "@misc{neu, title={Neu}}"
        model.insertion.source.citeAfterInsert = false
        await model.performInsert()

        let data = try Data(contentsOf: project.url("literatur.bib"))
        let text = try #require(String(data: data, encoding: .isoLatin1))
        #expect(text.hasPrefix(original) && text.contains("@misc{neu,"), "Alter Inhalt bleibt, neuer kommt dazu")
        #expect(String(data: data, encoding: .utf8) == nil, "Kodierung bleibt Latin-1")

        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: project.url("literatur.bib").path)
        model.presentInsert(.source)
        await model.insertion.waitForCatalog()
        model.insertion.source.mode = .bibtex
        model.insertion.source.bibtex = "@misc{zwei, title={Zwei}}"
        model.insertion.source.citeAfterInsert = false
        await model.performInsert()
        #expect(model.insertion.errorMessage?.contains("literatur.bib") == true)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: project.url("literatur.bib").path)
        #expect(try Data(contentsOf: project.url("literatur.bib")) == data, "Unverändert, nicht durch den neuen Eintrag ersetzt")
        model.insertion.errorMessage = nil
        model.insertion.isPresented = false
    }

    @Test("Offene, geänderte .bib: Eintrag landet im Editor und lässt sich rückgängig machen")
    func insertIntoOpenBibliography() async throws {
        let project = try await makeProject()
        defer { project.remove(); model.build.compileOnSave = true }
        await model.editor.open(project.url("literatur.bib"), asPreview: false)
        let bibSession = try #require(model.editor.current)
        bibSession.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "% Notiz\n")
        await model.editor.open(project.url("main.tex"), asPreview: false)
        model.presentInsert(.source)
        await model.insertion.waitForCatalog()
        model.insertion.source.mode = .bibtex
        model.insertion.source.bibtex = "@misc{neu, title={Neu}}"
        model.insertion.source.citeAfterInsert = false

        await model.performInsert()

        #expect(bibSession.textStorage.string.hasSuffix("\n\n@misc{neu,\n\ttitle={Neu}\n}\n"))
        #expect(try String(contentsOf: project.url("literatur.bib"), encoding: .utf8) == "@book{alt, author={A, B}, title={T}, date={2000}}\n")
        bibSession.undoManager.undo()
        #expect(bibSession.textStorage.string == "% Notiz\n@book{alt, author={A, B}, title={T}, date={2000}}\n")
    }

    /// Das Zitat geht über den echten Editor (`InsertRequest`), dafür braucht es ein Fenster mit RootView.
    private func showEditor(selecting location: Int) async throws -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: RootView(model: model))
        for _ in 0..<4 {
            window.contentView?.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(40))
        }
        let content = try #require(window.contentView)
        let textView = try #require(firstTextView(in: content))
        textView.setSelectedRange(NSRange(location: location, length: 0))
        return window
    }

    private func firstTextView(in view: NSView) -> LatexTextView? {
        if let match = view as? LatexTextView { return match }
        return view.subviews.lazy.compactMap { firstTextView(in: $0) }.first
    }
}
}
