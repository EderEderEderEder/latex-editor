import AppKit
import Foundation
import PDFKit
import Testing
@testable import LatexEditor

/// Ein eigenes AppModel (nicht `AppModel.shared`) mit Projekt, künstlichem PDF und erfundener SyncTeX-Abbildung
@MainActor
private struct MarkSetup {
    static let paragraph = "Das Qubit ist die kleinste Einheit der Quanteninformation und besitzt zwei Zustände. Ein Bit kennt nur null oder eins."
    let model = AppModel()
    let project: TemporaryProject
    let fixture: MarkFixture
    let view = SyncTeXPDFView()
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 900), styleMask: [.titled], backing: .buffered, defer: false)
    let undoManager = UndoManager()
    let markDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("marks-\(UUID().uuidString)")

    init() async throws {
        project = try TemporaryProject()
        try project.write("main.tex", "\\section{Einleitung}\n\n\(Self.paragraph)\n")
        fixture = MarkFixture(
            rows: ["Einleitung", "Das Qubit ist die kleinste Einheit", "der Quanteninformation und besitzt",
                   "zwei Zustände. Ein Bit kennt nur", "null oder eins."],
            layout: [1: 0...0, 3: 1...4], root: project.root
        )
        await model.project.open(root: project.root)
        model.marks.directory = markDirectory
        model.marks.defaults = temporaryDefaults()
        model.fileActions.undoManagerOverride = undoManager
        model.markBackwardLookup = fixture.backward
        window.isReleasedWhenClosed = false
        window.contentView = view
        view.document = fixture.document
        view.autoScales = true
        view.layoutDocumentView()
        model.pdf.pdfView = view
        view.store = model.pdf
    }

    func remove() {
        model.markPopover.close()
        window.close()
        project.remove()
        try? FileManager.default.removeItem(at: markDirectory)
    }

    var highlights: [PDFAnnotation] {
        (fixture.document.page(at: 0)?.annotations ?? []).filter { $0.type == "Highlight" }
    }

    func selection() throws -> PDFSelection {
        try #require(fixture.selection(from: "kleinste", to: "Quanteninformation"))
    }

    /// Ohne Ereignisschleife (Test) würden mehrere Schritte zu einer Gruppe: jeder Schritt bekommt seine eigene
    func step(_ work: () async -> Void) async {
        undoManager.groupsByEvent = false
        undoManager.beginUndoGrouping()
        await work()
        undoManager.endUndoGrouping()
    }

    /// „Rückgängig“ und „Wiederholen“ arbeiten in einer Task: kurz warten, bis die Bedingung gilt
    func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<200 where !condition() { try await Task.sleep(for: .milliseconds(10)) }
    }
}

@MainActor
@Suite("PDF-Markierungen: Bedienung")
struct MarkActionsTests {
    @Test("Markieren legt die Markierung an, zeigt sie sofort dort, wo markiert wurde, und merkt sich die Farbe")
    func createsAndShows() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        await setup.model.createMark(from: try setup.selection(), color: .green)

        let mark = try #require(setup.model.marks.marks.first)
        #expect(mark.color == .green)
        guard case .placed(let segments, _)? = setup.model.marks.resolutions[mark.id] else { Issue.record("keine Lage"); return }
        #expect(segments.count == 2)
        #expect(setup.highlights.count == 1)
        #expect(setup.model.marks.lastColor == .green)
        #expect(setup.view.currentSelection == nil, "Die Auswahl ist danach weg")
    }

    @Test("Rückgängig und Wiederholen: Anlegen, Farbe ändern, Entfernen")
    func undoRedo() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        let selection = try setup.selection()
        await setup.step { await model.createMark(from: selection, color: .yellow) }
        let id = try #require(model.marks.marks.first).id

        await setup.step { model.recolorMark(id, to: .pink) }
        #expect(model.marks.marks.first?.color == .pink)
        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.first?.color == .yellow }
        #expect(model.marks.marks.first?.color == .yellow)

        await setup.step { model.removeMarks([id]) }
        #expect(model.marks.marks.isEmpty)
        #expect(setup.highlights.isEmpty)
        setup.undoManager.undo()
        try await setup.waitUntil { !model.marks.marks.isEmpty }
        #expect(model.marks.marks.count == 1, "Entfernen rückgängig: die Markierung ist zurück")
        #expect(setup.highlights.count == 1, "und liegt wieder an derselben Stelle")

        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.isEmpty }
        #expect(model.marks.marks.isEmpty, "Anlegen rückgängig")
        setup.undoManager.redo()
        try await setup.waitUntil { !model.marks.marks.isEmpty }
        #expect(model.marks.marks.count == 1)
        #expect(setup.highlights.count == 1)
    }

    @Test("Das Menü „Markierung entfernen“ wirkt auf Markierungen unter der ausgewählten Textstelle")
    func removeUnderSelection() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        await model.createMark(from: try setup.selection(), color: .blue)
        #expect(model.marks.marks(overlapping: model.pdf.selectionSegments).isEmpty, "Ohne Auswahl nichts")

        setup.view.setCurrentSelection(try #require(setup.fixture.selection(from: "Quantenin", to: "formation")), animate: false)
        model.pdf.syncSelection()
        #expect(!model.pdf.selectionSegments.isEmpty)
        #expect(model.marks.marks(overlapping: model.pdf.selectionSegments).count == 1)
        model.removeMarksUnderSelection()
        #expect(model.marks.marks.isEmpty)

        setup.view.setCurrentSelection(try #require(setup.fixture.selection(from: "null", to: "eins")), animate: false)
        model.pdf.syncSelection()
        #expect(model.marks.marks(overlapping: model.pdf.selectionSegments).isEmpty)
        setup.view.clearSelection()
        model.pdf.syncSelection()
        #expect(model.pdf.selectionSegments.isEmpty)
    }

    @Test("Ist der Text neuer als das PDF, bleibt eine eben angelegte Markierung an ihrer Stelle")
    func keepsPlacementWhenTextIsNewer() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        await model.createMark(from: try setup.selection(), color: .yellow)
        let id = try #require(model.marks.marks.first).id
        let before = model.marks.resolutions[id]

        // Mit demselben PDF-Datum und neuerer Datei liefert die Zuordnung „wartet“: die bekannte Lage bleibt
        model.pdf.setMainFile(setup.project.root.appendingPathComponent("main.tex"))
        #expect(model.marks.resolutions[id] == before)
    }

    @Test("Ohne Quellzeile oder ohne SyncTeX-Daten gibt es eine verständliche Meldung statt einer Markierung")
    func failures() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        model.markBackwardLookup = { _, _ in nil }
        await model.createMark(from: try setup.selection(), color: .yellow)
        #expect(model.marks.marks.isEmpty)
        #expect(model.fileActions.notice == MarkCreator.Failure.noSourceLine.message)

        model.fileActions.notice = nil
        model.markBackwardLookup = nil
        await model.createMark(from: try setup.selection(), color: .yellow)
        #expect(model.marks.marks.isEmpty)
        #expect(model.fileActions.notice?.contains("SyncTeX") == true)
    }

    private func page(_ setup: MarkSetup) throws -> PDFPage {
        try #require(setup.fixture.document.page(at: 0))
    }

    @Test("Eine Notiz sitzt an der Zeile unter dem Klick, hat ein Symbol und lässt sich zurücknehmen")
    func note() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        let page = try page(setup)
        let point = CGPoint(x: 120, y: MarkFixture.pageHeight - MarkFixture.top(of: 2) - 5)
        await setup.step { await model.createNote(on: page, at: point) }

        let note = try #require(model.marks.marks.first)
        #expect(note.kind == .note)
        #expect(note.start.line == 3)
        #expect(note.start == note.end)
        #expect(note.text.isEmpty)
        #expect(page.annotations.filter { $0.type == "Text" }.count == 1)
        #expect(page.annotations.filter { $0.type == "Highlight" }.isEmpty)

        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.isEmpty }
        #expect(model.marks.marks.isEmpty)
        #expect(page.annotations.filter { $0.type == "Text" }.isEmpty)
    }

    @Test("Ein Kommentar bekommt ein Symbol am Rand, wird gespeichert und lässt sich zurücknehmen")
    func comment() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        let page = try page(setup)
        let selection = try setup.selection()
        await setup.step { await model.createMark(from: selection, color: .yellow) }
        let id = try #require(model.marks.marks.first).id
        #expect(page.annotations.filter { $0.type == "Text" }.isEmpty, "Ohne Kommentar kein Symbol")

        await setup.step { model.setComment(id, to: "  Quelle prüfen \n") }
        #expect(model.marks.marks.first?.comment == "Quelle prüfen")
        let icon = try #require(page.annotations.first { $0.type == "Text" })
        #expect(icon.userName == id.uuidString)
        #expect(icon.bounds.maxX > MarkFixture.left + 468, "Im rechten Seitenrand")
        #expect(page.annotations.filter { $0.type == "Highlight" }.count == 1)

        model.setComment(id, to: "Quelle prüfen")
        #expect(model.fileUndoManager.undoActionName == "Kommentar ändern", "Unverändert: kein weiterer Schritt")
        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.first?.comment == "" }
        #expect(model.marks.marks.first?.comment == "")
        #expect(page.annotations.filter { $0.type == "Text" }.isEmpty)
    }

    @Test("Das Popover übernimmt den Kommentar erst beim Schließen, als ein Schritt")
    func popoverCommitsOnClose() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        await model.createMark(from: try setup.selection(), color: .green)
        let id = try #require(model.marks.marks.first).id

        model.showMarkPopover(id)
        #expect(model.markPopover.shownID == id)
        model.markPopover.draft?.text = "Neu"
        #expect(model.marks.marks.first?.comment == "", "Noch nichts übernommen")
        model.markPopover.close()
        #expect(model.markPopover.shownID == nil)
        #expect(model.marks.marks.first?.comment == "Neu")
    }

    @Test("Eine nicht zugeordnete Markierung lässt sich auf eine neue Textstelle setzen; Farbe und Kommentar bleiben")
    func reassign() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        let first = try setup.selection()
        await setup.step { await model.createMark(from: first, color: .pink) }
        let old0 = try #require(model.marks.marks.first)
        await setup.step { model.setComment(old0.id, to: "bleibt") }
        let old = try #require(model.marks.marks.first)
        model.marks.setResolution(.orphaned, for: old.id)

        setup.view.setCurrentSelection(try #require(setup.fixture.selection(from: "Bit kennt", to: "nur")), animate: false)
        await setup.step { await model.reassignMark(old.id) }
        let moved = try #require(model.marks.marks.first)
        #expect(moved.id == old.id)
        #expect(moved.color == .pink)
        #expect(moved.comment == "bleibt")
        #expect(moved.start.words.first == "bit")
        guard case .placed? = model.marks.resolutions[old.id] else { Issue.record("nicht zugeordnet"); return }

        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.first?.start.words == old.start.words }
        #expect(model.marks.marks.first?.start.words == old.start.words)
        #expect(model.marks.resolutions[old.id] == .orphaned)
    }

    @Test("Klick auf eine Markierung findet sie, daneben nichts")
    func markUnderPoint() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        await setup.model.createMark(from: try setup.selection(), color: .blue)
        let id = try #require(setup.model.marks.marks.first).id
        guard case .placed(let segments, _)? = setup.model.marks.resolutions[id], let segment = segments.first else {
            Issue.record("keine Lage"); return
        }
        let page = try page(setup)
        let inside = setup.view.convert(CGPoint(x: segment.rect.midX, y: segment.rect.midY), from: page)
        #expect(setup.view.markID(atViewPoint: inside) == id)
        let outside = setup.view.convert(CGPoint(x: 400, y: 100), from: page)
        #expect(setup.view.markID(atViewPoint: outside) == nil)
    }

    @Test("Rechtsklickmenü des PDFs: Markieren bei Auswahl, Farbe und Entfernen auf einer Markierung")
    func contextMenuItems() {
        let view = SyncTeXPDFView()
        #expect(view.markMenuItems(hasSelection: false, markID: nil).isEmpty)

        let selection = view.markMenuItems(hasSelection: true, markID: nil)
        #expect(selection.map(\.title) == ["Markieren", "Markieren mit", "Kommentieren …"])
        #expect(selection[1].submenu?.items.map(\.title) == MarkColor.allCases.map(\.title))
        #expect(selection[1].submenu?.items.allSatisfy { $0.image != nil } == true)

        let onMark = view.markMenuItems(hasSelection: false, markID: UUID())
        #expect(onMark.map(\.title) == ["Kommentar bearbeiten …", "Farbe ändern", "Markierung entfernen"])
        #expect(view.markMenuItems(hasSelection: true, markID: UUID()).count == 6)
        #expect(view.markMenuItems(hasSelection: false, markID: nil, canAddNote: true).map(\.title) == ["Notiz hier hinzufügen …"])
        #expect(view.markMenuItems(hasSelection: true, markID: nil, canAddNote: true).map(\.title) == ["Markieren", "Markieren mit", "Kommentieren …"])
    }

    @Test("Die zuletzt benutzte Farbe bleibt für den nächsten Start")
    func lastColor() {
        let defaults = temporaryDefaults()
        let store = MarkStore(directory: FileManager.default.temporaryDirectory, defaults: defaults)
        #expect(store.lastColor == .yellow)
        store.lastColor = .orange
        #expect(MarkStore(directory: FileManager.default.temporaryDirectory, defaults: defaults).lastColor == .orange)
    }

    @Test("Markierungen überlappen nur auf derselben Seite und mit echter Fläche")
    func overlap() {
        let placed = MarkResolution.placed(segments: [.init(pageIndex: 0, rect: CGRect(x: 10, y: 10, width: 100, height: 12))], precision: .words)
        #expect(placed.overlaps([.init(pageIndex: 0, rect: CGRect(x: 50, y: 12, width: 100, height: 8))]))
        #expect(!placed.overlaps([.init(pageIndex: 1, rect: CGRect(x: 50, y: 12, width: 100, height: 8))]))
        #expect(!placed.overlaps([.init(pageIndex: 0, rect: CGRect(x: 110, y: 10, width: 10, height: 12))]), "Nur berühren zählt nicht")
        #expect(!MarkResolution.orphaned.overlaps([.init(pageIndex: 0, rect: CGRect(x: 0, y: 0, width: 999, height: 999))]))
    }
}
