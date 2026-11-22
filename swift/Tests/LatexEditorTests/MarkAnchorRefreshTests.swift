import Foundation
import PDFKit
import Testing
@testable import LatexEditor

/// Der Absatz der Einleitung des Demoprojekts (hier eingebettet) und zwei Überarbeitungen nacheinander: Nach der ersten
/// passt der ursprüngliche Anker noch (Ähnlichkeit 0,81), nach der zweiten nicht mehr.
private enum RevisedParagraph {
    static let original = [
        "\\chapter{Einleitung}",
        "",
        "Dieses Projekt ist eine \\emph{Demo-Arbeit}. Sie ersetzt die echte Abschlussarbeit bei allen Tests und beim",
        "Entwickeln des Editors. Die Datei \\texttt{hgbthesis.cls} ist eine eigene Nachbildung und enthält nichts aus der",
        "Vorlage der Hochschule.",
    ]
    static let revisionOne = replacing(
        [("echte Abschlussarbeit", "richtige Bachelorarbeit"), ("Tests", "Prüfungen"), ("eigene Nachbildung", "eigenständige Kopie"),
         ("enthält", "umfasst")],
        in: original
    )
    static let revisionTwo = replacing(
        [("allen", "sämtlichen"), ("ersetzt", "vertritt"), ("beim", "während"), ("Entwickeln des Editors", "Bearbeiten des Programms"),
         ("nichts", "kaum etwas"), ("Vorlage der Hochschule.", "Vorlage der Hochschule Hagenberg.")],
        in: revisionOne
    )
    static let deleted = Array(original.prefix(2)) + ["Hier steht jetzt ein ganz anderer Satz ohne jeden Bezug."]

    private static func replacing(_ pairs: [(String, String)], in lines: [String]) -> [String] {
        lines.map { line in pairs.reduce(line) { $0.replacingOccurrences(of: $1.0, with: $1.1) } }
    }
}

/// PDF und SyncTeX-Abbildung zu einer Fassung, wie ein Neukompilieren sie liefert (ohne LaTeX: 9 Wörter je PDF-Zeile)
@MainActor
private enum RevisionRendering {
    private static let wordsPerRow = 9
    private static let headingRows = 1

    static func resolver(_ lines: [String], newer: Bool = false) -> MarkResolver {
        let fixture = fixture(for: lines)
        return MarkResolver(
            root: fixture.root, document: fixture.document, linesOf: { _ in lines },
            forward: fixture.forward, isNewerThanPDF: { _ in newer }
        )
    }

    static func makeMark(in lines: [String]) throws -> PDFMark {
        let fixture = fixture(for: lines)
        let selection = try #require(fixture.selection(from: "ist eine Demo", to: "Hochschule."))
        let creator = MarkCreator(root: fixture.root, document: fixture.document, linesOf: { _ in lines },
                                  backward: fixture.backward, forward: fixture.forward)
        return try creator.makeMark(from: selection, color: .yellow)
    }

    private static func fixture(for lines: [String]) -> MarkFixture {
        var rows = [plainWords(lines[0]).joined(separator: " ")]
        var layout: [Int: ClosedRange<Int>] = [1: 0...0]
        var words: [(line: Int, word: String)] = []
        for (index, line) in lines.enumerated().dropFirst() { words += plainWords(line).map { (index + 1, $0) } }
        for (offset, entry) in words.enumerated() {
            let row = headingRows + offset / wordsPerRow
            layout[entry.line] = layout[entry.line].map { $0.lowerBound...row } ?? row...row
        }
        for start in stride(from: 0, to: words.count, by: wordsPerRow) {
            rows.append(words[start..<min(words.count, start + wordsPerRow)].map(\.word).joined(separator: " "))
        }
        return MarkFixture(rows: rows, layout: layout)
    }

    private static func plainWords(_ line: String) -> [String] {
        line.replacingOccurrences(of: #"\\[A-Za-z@]+\*?"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: "[{}]", with: "", options: .regularExpression)
            .split(whereSeparator: \.isWhitespace).map(String.init)
    }
}

private func isPlaced(_ resolution: MarkResolution) -> Bool {
    if case .placed = resolution { return true }
    return false
}

@MainActor
@Suite("PDF-Markierungen: Anker nach dem Zuordnen auffrischen")
struct MarkAnchorRefreshTests {
    @Test("Zweimal überarbeitet: Mit dem aufgefrischten Anker bleibt die Markierung zugeordnet, ohne verwaist sie")
    func twiceRevisedStaysPlaced() throws {
        let mark = try RevisionRendering.makeMark(in: RevisedParagraph.original)
        #expect(mark.start.line == 3 && mark.end.line == 5)
        #expect(RevisionRendering.resolver(RevisedParagraph.revisionTwo).resolve(mark) == .orphaned, "Das Problem: alter Anker")

        let first = RevisionRendering.resolver(RevisedParagraph.revisionOne)
        let fresh = first.resolve(mark)
        #expect(isPlaced(fresh))
        let renewed = try #require(first.refreshedAnchors(of: mark, after: fresh))
        #expect(renewed.start.text == RevisedParagraph.revisionOne[2])
        #expect(renewed.start.after == RevisedParagraph.revisionOne[3])
        #expect(renewed.end.before == RevisedParagraph.revisionOne[3])
        #expect(renewed.start.words == mark.start.words && renewed.end.words == mark.end.words, "Die Wörter bleiben")
        #expect(renewed.start.matchedWords == mark.start.matchedWords && renewed.start.occurrence == mark.start.occurrence)
        #expect(renewed.id == mark.id && renewed.color == mark.color && renewed.text == mark.text)

        let second = RevisionRendering.resolver(RevisedParagraph.revisionTwo)
        #expect(isPlaced(second.resolve(renewed)), "Nach der zweiten Überarbeitung noch zugeordnet")
    }

    @Test("Verwaist oder „wartet“: nichts wird aufgefrischt; unverändert: auch nicht")
    func noRefreshWithoutChangeOrPlacement() throws {
        let mark = try RevisionRendering.makeMark(in: RevisedParagraph.original)
        let gone = RevisionRendering.resolver(RevisedParagraph.deleted)
        let orphaned = gone.resolve(mark)
        #expect(orphaned == .orphaned)
        #expect(gone.refreshedAnchors(of: mark, after: orphaned) == nil)

        let newer = RevisionRendering.resolver(RevisedParagraph.revisionOne, newer: true)
        #expect(newer.resolve(mark) == .pending)
        #expect(newer.refreshedAnchors(of: mark, after: .pending) == nil)

        let same = RevisionRendering.resolver(RevisedParagraph.original)
        let placed = same.resolve(mark)
        #expect(isPlaced(placed))
        #expect(same.refreshedAnchors(of: mark, after: placed) == nil, "Gleicher Stand: keine Änderung")
    }

    @Test("Unsichere Zuordnung (Ende vor Anfang, nur Zeilenrechtecke): der Anker bleibt, wie er ist")
    func unsafePlacementKeepsAnchors() throws {
        let original = RevisedParagraph.original
        let mark = try RevisionRendering.makeMark(in: original)
        let swapped = [original[0], original[1], original[4], original[2], original[3]]
        #expect(MarkAnchorLocator.locate(mark.start, in: swapped, isStart: true) == 4)
        #expect(MarkAnchorLocator.locate(mark.end, in: swapped, isStart: false) == 3)

        let resolver = RevisionRendering.resolver(swapped)
        let fresh = resolver.resolve(mark)
        guard case .placed(_, let precision) = fresh else {
            Issue.record("Nicht zugeordnet: \(fresh)")
            return
        }
        #expect(precision == .lines)
        #expect(resolver.refreshedAnchors(of: mark, after: fresh) == nil)
    }

    @Test("Eine Notiz wird an der Zeile aufgefrischt, Anfang und Ende bleiben gleich")
    func noteRefreshes() throws {
        let anchor = MarkAnchorLocator.anchor(path: "main.tex", line: 3, in: RevisedParagraph.original, words: [])
        let note = PDFMark(id: UUID(), kind: .note, color: .blue, comment: "Notiz", text: "", start: anchor, end: anchor,
                           pageHint: 1, createdAt: Date())
        let first = RevisionRendering.resolver(RevisedParagraph.revisionOne)
        let renewed = try #require(first.refreshedAnchors(of: note, after: first.resolve(note)))
        #expect(renewed.start == renewed.end)
        #expect(renewed.start.text == RevisedParagraph.revisionOne[2])
        #expect(isPlaced(RevisionRendering.resolver(RevisedParagraph.revisionTwo).resolve(renewed)))
    }

    @Test("Der Store übernimmt nur Anker von Markierungen, die sich seit dem Lauf nicht geändert haben")
    func storeSkipsChangedMarks() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("marks-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MarkStore(directory: directory, defaults: temporaryDefaults())
        store.load(root: URL(fileURLWithPath: "/tmp/projekt-auffrischen-\(UUID().uuidString)"))
        let mark = try RevisionRendering.makeMark(in: RevisedParagraph.original)
        store.add(mark)
        let first = RevisionRendering.resolver(RevisedParagraph.revisionOne)
        let renewed = try #require(first.refreshedAnchors(of: mark, after: first.resolve(mark)))

        store.update(mark.id) { $0.comment = "inzwischen geändert" }
        store.refreshAnchors([(mark, renewed)])
        #expect(store.marks.first?.start == mark.start, "Geänderte Markierung: Anker bleibt")
        store.remove(mark.id)
        store.refreshAnchors([(mark, renewed)])
        #expect(store.marks.isEmpty, "Entfernte Markierung kommt nicht zurück")
        await store.flush()
    }
}

/// Über das AppModel (eigenes, nicht `AppModel.shared`), wie nach einem Build: zuordnen, auffrischen, speichern
extension AppModelSuite {
@MainActor
@Suite("PDF-Markierungen: Anker auffrischen (App-Ebene)")
struct MarkAnchorRefreshModelTests {
    private static let firstBuild = Date(timeIntervalSince1970: 1_700_000_000)
    private static let secondBuild = Date(timeIntervalSince1970: 1_700_000_600)

    @MainActor
    private struct Setup {
        let model = AppModel()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("marks-\(UUID().uuidString)")
        let root = URL(fileURLWithPath: "/tmp/projekt-auffrischen-\(UUID().uuidString)")
        let mark: PDFMark

        init() async throws {
            mark = try RevisionRendering.makeMark(in: RevisedParagraph.original)
            model.marks.defaults = temporaryDefaults()
            model.marks.directory = directory
            model.marks.load(root: root)
            model.marks.add(mark)
            await model.marks.flush()
        }

        var storageFile: URL { MarkStorage.fileURL(for: root, in: directory) }

        func reloaded() -> MarkStore {
            let store = MarkStore(directory: directory, defaults: temporaryDefaults())
            store.load(root: root)
            return store
        }

        func remove() { try? FileManager.default.removeItem(at: directory) }
    }

    @Test("Nach dem Zuordnen gilt der aufgefrischte Anker, auch nach einem Neustart, und hält die zweite Überarbeitung aus")
    func refreshedAnchorSurvivesRestart() async throws {
        let setup = try await Setup()
        defer { setup.remove() }
        setup.model.resolveMarks(with: RevisionRendering.resolver(RevisedParagraph.revisionOne), pdfDate: Self.firstBuild)
        let current = try #require(setup.model.marks.marks.first)
        #expect(current.start.text == RevisedParagraph.revisionOne[2])
        #expect(current.start != setup.mark.start)
        let afterFirst = try #require(setup.model.marks.resolutions[current.id])
        #expect(isPlaced(afterFirst))
        await setup.model.marks.flush()

        let reloaded = setup.reloaded()
        #expect(reloaded.marks.map(\.start) == [current.start], "Nach dem Neustart der aufgefrischte Anker")
        #expect(reloaded.marks.map(\.end) == [current.end])
        setup.model.resolveMarks(with: RevisionRendering.resolver(RevisedParagraph.revisionTwo), pdfDate: Self.secondBuild)
        let afterSecond = try #require(setup.model.marks.resolutions[current.id])
        #expect(isPlaced(afterSecond), "Zweite Überarbeitung: zugeordnet")
    }

    @Test("Unverändert oder verwaist: Die Markierung bleibt, wie sie ist, und nichts wird geschrieben")
    func noWriteWithoutChange() async throws {
        let setup = try await Setup()
        defer { setup.remove() }
        try FileManager.default.removeItem(at: setup.storageFile)

        setup.model.resolveMarks(with: RevisionRendering.resolver(RevisedParagraph.original), pdfDate: Self.firstBuild)
        await setup.model.marks.flush()
        #expect(setup.model.marks.marks == [setup.mark])
        #expect(!FileManager.default.fileExists(atPath: setup.storageFile.path), "Gleicher Stand: kein Speichern")

        // Anderes PDF-Datum: sonst bliebe die bekannte Lage des vorigen Laufs stehen (`keepingPlacement`)
        setup.model.resolveMarks(with: RevisionRendering.resolver(RevisedParagraph.deleted), pdfDate: Self.secondBuild)
        await setup.model.marks.flush()
        #expect(setup.model.marks.resolutions[setup.mark.id] == .orphaned)
        #expect(setup.model.marks.marks == [setup.mark], "Verwaist: Anker unverändert")
        #expect(!FileManager.default.fileExists(atPath: setup.storageFile.path), "Verwaist: kein Speichern")
    }
}
}
