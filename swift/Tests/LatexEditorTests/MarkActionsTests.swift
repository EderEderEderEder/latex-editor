import AppKit
import Foundation
import PDFKit
import SwiftUI
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
        model.markForwardOverride = fixture.forward
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

/// Echte Fenster, Popover und je ein eigenes AppModel: unter dem seriellen Dach, damit sie nicht gleichzeitig mit den
/// anderen Fenstertests den Hauptthread beanspruchen (der volle Lauf stand sonst gelegentlich still).
extension AppModelSuite {
@MainActor
@Suite("PDF-Markierungen: Bedienung (App-Ebene)")
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

    @Test("Farbe ändern tauscht die Annotationen nicht aus, sondern färbt sie um; Entferntes bleibt kurz am Leben")
    func recolorInPlace() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        await model.createMark(from: try setup.selection(), color: .yellow)
        let id = try #require(model.marks.marks.first).id
        model.setComment(id, to: "Kommentar")
        let before = setup.fixture.document.page(at: 0)?.annotations ?? []
        let highlight = try #require(before.first { $0.type == "Highlight" })
        let icon = try #require(before.first { $0 is MarkIconAnnotation })

        model.recolorMark(id, to: .green)
        let after = setup.fixture.document.page(at: 0)?.annotations ?? []
        #expect(after.contains { $0 === highlight } && after.contains { $0 === icon }, "Dieselben Objekte")
        #expect(highlight.color == MarkColor.green.highlightColor)
        #expect(icon.color == MarkColor.green.iconColor)
        #expect(model.marks.marks.first?.color == .green)

        model.removeMarks([id])
        #expect(model.pdf.retiredMarkAnnotations.contains { $0 === highlight }, "Kurz noch gehalten")
        #expect((setup.fixture.document.page(at: 0)?.annotations ?? []).isEmpty)
    }

    @Test("Dieselbe Stelle noch einmal markieren ersetzt die alte Markierung (Kommentar bleibt), Nachbarwörter nicht; ein Schritt Rückgängig")
    func markingAgainReplaces() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        let page = try page(setup)
        let first = try setup.selection()
        await setup.step { await model.createMark(from: first, color: .yellow) }
        let old = try #require(model.marks.marks.first)
        await setup.step { model.setComment(old.id, to: "bleibt") }

        let overlapping = try #require(setup.fixture.selection(from: "Einheit", to: "der"))
        await setup.step { await model.createMark(from: overlapping, color: .blue) }
        #expect(model.marks.marks.count == 1, "Ersetzt, nicht doppelt")
        #expect(model.marks.marks.first?.color == .blue)
        #expect(model.marks.marks.first?.comment == "bleibt")
        #expect(page.annotations.filter { $0.type == "Highlight" }.count == 1)

        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.first?.id == old.id }
        #expect(model.marks.marks.map(\.id) == [old.id], "Die alte ist zurück, die neue weg")
        #expect(page.annotations.filter { $0.type == "Highlight" }.count == 1)

        let neighbour = try #require(setup.fixture.selection(from: "null", to: "eins."))
        await setup.step { await model.createMark(from: neighbour, color: .green) }
        #expect(model.marks.marks.count == 2, "Eine andere Stelle ersetzt nichts")
    }

    @Test("Alle Markierungen entfernen: ein Schritt, Rückgängig holt alle zurück")
    func removeAll() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        let first = try setup.selection()
        let second = try #require(setup.fixture.selection(from: "null", to: "eins."))
        await setup.step { await model.createMark(from: first, color: .yellow) }
        await setup.step { await model.createMark(from: second, color: .green) }
        #expect(model.marks.marks.count == 2)

        await setup.step { model.removeAllMarks() }
        #expect(model.marks.marks.isEmpty)
        #expect(setup.highlights.isEmpty)
        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.count == 2 }
        #expect(model.marks.marks.count == 2)
        #expect(setup.highlights.count == 2)
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

        setup.view.setCurrentSelection(try #require(setup.fixture.selection(from: "null", to: "eins.")), animate: false)
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
        #expect(page.annotations.filter { $0 is MarkIconAnnotation }.count == 1)
        #expect(page.annotations.filter { $0.type == "Highlight" }.isEmpty)

        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.isEmpty }
        #expect(model.marks.marks.isEmpty)
        #expect(page.annotations.filter { $0 is MarkIconAnnotation }.isEmpty)
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
        #expect(page.annotations.filter { $0 is MarkIconAnnotation }.isEmpty, "Ohne Kommentar kein Symbol")

        await setup.step { model.setComment(id, to: "  Quelle prüfen \n") }
        #expect(model.marks.marks.first?.comment == "Quelle prüfen")
        let icon = try #require(page.annotations.first { $0 is MarkIconAnnotation })
        #expect(icon.userName == id.uuidString)
        guard case .placed(let segments, _)? = model.marks.resolutions[id], let last = segments.last else { Issue.record("keine Lage"); return }
        #expect(icon.bounds.minX >= last.rect.maxX && icon.bounds.minX < last.rect.maxX + 4, "Am Ende der Markierung")
        #expect(icon.bounds.width < 14, "Klein")
        #expect(page.annotations.filter { $0.type == "Highlight" }.count == 1)

        model.setComment(id, to: "Quelle prüfen")
        #expect(model.fileUndoManager.undoActionName == "Kommentar ändern", "Unverändert: kein weiterer Schritt")
        setup.undoManager.undo()
        try await setup.waitUntil { model.marks.marks.first?.comment == "" }
        #expect(model.marks.marks.first?.comment == "")
        #expect(page.annotations.filter { $0 is MarkIconAnnotation }.isEmpty)
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

    @Test("Das Kommentarfeld nimmt die Schreibmarke selbst, hinter dem vorhandenen Text, und gibt Eingaben weiter")
    func commentFieldTakesFocus() async throws {
        var text = "Vorhanden"
        let coordinator = MarkCommentField.Coordinator(text: Binding(get: { text }, set: { text = $0 }))
        let scrollView = MarkCommentField.makeScrollView(text: text, delegate: coordinator)
        let textView = try #require(scrollView.documentView as? FocusingTextView)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        scrollView.frame = NSRect(x: 0, y: 0, width: 300, height: 100)
        window.contentView?.addSubview(scrollView)
        for _ in 0..<100 where window.firstResponder !== textView { try await Task.sleep(for: .milliseconds(10)) }
        #expect(window.firstResponder === textView)
        #expect(textView.selectedRange() == NSRange(location: 9, length: 0))

        textView.insertText(" und mehr", replacementRange: textView.selectedRange())
        #expect(text == "Vorhanden und mehr")
        window.close()
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

    @Test("Markierungsmodus: Eine fertige Auswahl wird sofort markiert, ohne Modus nicht")
    func markingMode() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        setup.view.setCurrentSelection(try setup.selection(), animate: false)
        setup.view.markSelectionInMarkingMode()
        try await Task.sleep(for: .milliseconds(100))
        #expect(model.marks.marks.isEmpty, "Ohne Markierungsmodus passiert nichts")

        model.toggleMarkingMode()
        #expect(model.pdf.isMarkingMode)
        setup.view.markSelectionInMarkingMode()
        try await setup.waitUntil { !model.marks.marks.isEmpty }
        #expect(model.marks.marks.count == 1)
        #expect(model.marks.marks.first?.color == .yellow)
        #expect(setup.view.currentSelection == nil)
        #expect(model.pdf.isMarkingMode, "Der Modus bleibt an")

        setup.view.markSelectionInMarkingMode()
        try await Task.sleep(for: .milliseconds(100))
        #expect(model.marks.marks.count == 1, "Ohne Auswahl nichts")
        model.toggleMarkingMode()
        #expect(!model.pdf.isMarkingMode)
    }

    @Test("Farbe im Menü des Stiftknopfs: gilt weiter, schaltet den Modus ein und markiert eine bestehende Auswahl gleich")
    func chooseColor() async throws {
        let setup = try await MarkSetup()
        defer { setup.remove() }
        let model = setup.model
        model.chooseMarkColor(.orange)
        #expect(model.pdf.isMarkingMode)
        #expect(model.marks.lastColor == .orange)
        #expect(model.marks.marks.isEmpty, "Ohne Auswahl wird nichts markiert")

        setup.view.setCurrentSelection(try setup.selection(), animate: false)
        model.pdf.syncSelection()
        model.chooseMarkColor(.blue)
        try await setup.waitUntil { !model.marks.marks.isEmpty }
        #expect(model.marks.marks.first?.color == .blue)
        #expect(model.marks.lastColor == .blue)
    }

    @Test("Das Symbol wird auf einem Hintergrund-Thread gezeichnet (so ruft PDFKit es auf) und hat die Farbe der Markierung")
    func iconDrawsOffTheMainThread() async throws {
        final class Canvas: @unchecked Sendable {
            let size = 24
            var pixels: [UInt8]
            var drewOnMainThread = true
            init() { pixels = [UInt8](repeating: 0, count: size * size * 4) }
        }
        let canvas = Canvas()
        for isNote in [false, true] {
            canvas.pixels = [UInt8](repeating: 0, count: canvas.size * canvas.size * 4)
            nonisolated(unsafe) let annotation: PDFAnnotation = isNote
                ? MarkNoteIconAnnotation(bounds: CGRect(x: 0, y: 0, width: 24, height: 24), forType: .square, withProperties: nil)
                : MarkCommentIconAnnotation(bounds: CGRect(x: 0, y: 0, width: 24, height: 24), forType: .square, withProperties: nil)
            annotation.color = NSColor(red: 0, green: 0, blue: 1, alpha: 1)
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                DispatchQueue.global().async {
                    canvas.drewOnMainThread = Thread.isMainThread
                    canvas.pixels.withUnsafeMutableBytes { raw in
                        if let context = CGContext(
                            data: raw.baseAddress, width: canvas.size, height: canvas.size, bitsPerComponent: 8, bytesPerRow: canvas.size * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                        ) {
                            annotation.draw(with: .mediaBox, in: context)
                        }
                    }
                    continuation.resume()
                }
            }
            #expect(!canvas.drewOnMainThread)
            // Irgendwo im Symbol ist ein blauer, deckender Punkt
            let hasBlue = stride(from: 0, to: canvas.pixels.count, by: 4).contains {
                canvas.pixels[$0 + 2] > 200 && canvas.pixels[$0] < 60 && canvas.pixels[$0 + 3] > 200
            }
            #expect(hasBlue, isNote ? "Notiz" : "Kommentar")
        }
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
}
