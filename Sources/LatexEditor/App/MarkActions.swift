import Foundation
import PDFKit

extension AppModel {
    /// Die gerade nötige Toleranz zwischen Änderungszeit von Datei und PDF (latexmk schreibt das PDF nach dem Lesen)
    private static let pdfAgeTolerance: TimeInterval = 1

    // MARK: Zuordnen

    /// Ordnet alle Markierungen dem geladenen PDF zu und zeigt sie. Läuft nach jedem neuen PDF und jedem neuen
    /// SyncTeX-Index; ein neuer Aufruf ersetzt einen laufenden. Ohne SyncTeX-Index wird nichts verändert: Fehlte er nur,
    /// würden sonst alle Markierungen als verwaist gelten.
    func scheduleMarkResolution() {
        markResolutionTask?.cancel()
        markResolutionTask = Task { [weak self] in
            guard let self else { return }
            await synctex.waitUntilLoaded()
            guard !Task.isCancelled, let root = project.rootURL, synctex.index != nil,
                  let document = pdf.pdfView?.document, pdf.pdfURL != nil else { return }
            let sources = await Self.readSources(Set(marks.marks.flatMap { [$0.start.path, $0.end.path] }), root: root)
            guard !Task.isCancelled, document === pdf.pdfView?.document else { return }
            let pdfDate = pdfModificationDate()
            let resolver = MarkResolver(
                root: root, document: document, linesOf: { sources[$0]?.lines },
                forward: { [synctex] in synctex.forward(file: $0, line: $1) },
                isNewerThanPDF: { path in
                    guard let fileDate = sources[path]?.modified, let pdfDate else { return false }
                    return fileDate.timeIntervalSince(pdfDate) > Self.pdfAgeTolerance
                }
            )
            var resolutions: [UUID: MarkResolution] = [:]
            for mark in marks.marks {
                resolutions[mark.id] = keepingPlacement(of: mark, fresh: resolver.resolve(mark), pdfDate: pdfDate)
            }
            marks.setResolutions(resolutions, pdfDate: pdfDate)
            refreshMarkDisplay()
        }
    }

    /// Ist der Text neuer als das PDF, stimmen seine Zeilen nicht mehr mit dem PDF überein; solange es dasselbe PDF ist wie
    /// beim letzten Zuordnen (z. B. Wechsel der Ansicht), bleibt die bekannte Lage aber richtig. Das gilt auch, wenn der Pfad
    /// im SyncTeX-Index noch der alte ist (Datei umbenannt, noch nicht neu kompiliert).
    private func keepingPlacement(of mark: PDFMark, fresh: MarkResolution, pdfDate: Date?) -> MarkResolution {
        guard fresh == .pending || fresh == .orphaned, marks.resolvedForPDFDate == pdfDate,
              let known = marks.resolutions[mark.id], case .placed = known else { return fresh }
        return known
    }

    /// Quelle → PDF für das Anlegen; in Tests ersetzbar (`markForwardOverride`)
    private func markForwardLookup() -> (URL, Int) -> SyncTeXBox? {
        markForwardOverride ?? { [synctex] in synctex.forward(file: $0, line: $1) }
    }

    func refreshMarkDisplay() {
        pdf.showMarks(marks.marks, marks.resolutions)
    }

    private func pdfModificationDate() -> Date? {
        guard let url = pdf.pdfURL else { return nil }
        return (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
    }

    // MARK: Anlegen

    /// Markiert die Auswahl im PDF (ohne Farbe: die zuletzt benutzte)
    func markSelection(color: MarkColor? = nil, thenComment: Bool = false) {
        guard let selection = pdf.pdfView?.currentSelection else { return }
        let color = color ?? marks.lastColor
        Task {
            guard let id = await createMark(from: selection, color: color), thenComment else { return }
            showMarkPopover(id)
        }
    }

    func toggleMarkingMode() {
        pdf.isMarkingMode.toggle()
    }

    /// Farbe im Menü des Stiftknopfs: Sie gilt ab jetzt, der Markierungsmodus ist an, eine bestehende Auswahl wird gleich markiert
    func chooseMarkColor(_ color: MarkColor) {
        marks.lastColor = color
        pdf.isMarkingMode = true
        if !pdf.selectionSegments.isEmpty { markSelection(color: color) }
    }

    func commentSelection() {
        markSelection(thenComment: true)
    }

    @discardableResult
    func createMark(from selection: PDFSelection, color: MarkColor) async -> UUID? {
        guard let root = project.rootURL, let document = pdf.pdfView?.document else { return nil }
        let lookup = markBackwardLookup ?? { [synctex] in synctex.backward(page: $0, point: $1) }
        guard markBackwardLookup != nil || synctex.index != nil else {
            fileActions.notice = "Zum Markieren braucht die App die SyncTeX-Daten des letzten Builds. Kompiliere das Projekt zuerst."
            return nil
        }
        let probe = MarkCreator(root: root, document: document, linesOf: { _ in nil }, backward: lookup)
        let sources = await Self.readSources(probe.sourcePaths(of: selection), root: root)
        guard document === pdf.pdfView?.document else { return nil }
        let creator = MarkCreator(root: root, document: document, linesOf: { sources[$0]?.lines }, backward: lookup, forward: markForwardLookup())
        do {
            var mark = try creator.makeMark(from: selection, color: color)
            // Bis zum nächsten Build liegt sie genau dort, wo markiert wurde
            let segments = MarkResolution.segments(of: selection, in: document)
            let placed = MarkResolution.placed(segments: segments, precision: .words)
            // Wer dieselbe Stelle noch einmal markiert, ersetzt die alte Markierung (ein Kommentar der alten bleibt erhalten)
            let replaced = marks.marks(overlapping: segments).filter { $0.kind == .highlight }
            if mark.comment.isEmpty, let comment = replaced.first(where: { !$0.comment.isEmpty })?.comment { mark.comment = comment }
            insertMarks([(mark, placed)], replacing: replaced, actionName: replaced.isEmpty ? "Markierung hinzufügen" : "Markierung ersetzen")
            marks.lastColor = color
            pdf.pdfView?.clearSelection()
            return mark.id
        } catch let failure as MarkCreator.Failure {
            fileActions.notice = failure.message
        } catch {
            fileActions.notice = error.localizedDescription
        }
        return nil
    }

    /// Rechtsklick auf freie Fläche: eine Notiz an der Zeile dort, mit geöffnetem Popover für den Text
    func addNote(on page: PDFPage, at point: CGPoint) {
        Task { if let id = await createNote(on: page, at: point) { showMarkPopover(id) } }
    }

    @discardableResult
    func createNote(on page: PDFPage, at point: CGPoint) async -> UUID? {
        guard let root = project.rootURL, let document = pdf.pdfView?.document else { return nil }
        let lookup = markBackwardLookup ?? { [synctex] in synctex.backward(page: $0, point: $1) }
        guard markBackwardLookup != nil || synctex.index != nil else {
            fileActions.notice = "Für eine Notiz braucht die App die SyncTeX-Daten des letzten Builds. Kompiliere das Projekt zuerst."
            return nil
        }
        let probe = MarkCreator(root: root, document: document, linesOf: { _ in nil }, backward: lookup)
        let paths = probe.sourcePath(on: page, at: point).map { Set([$0]) } ?? []
        let sources = await Self.readSources(paths, root: root)
        guard document === pdf.pdfView?.document else { return nil }
        let creator = MarkCreator(root: root, document: document, linesOf: { sources[$0]?.lines }, backward: lookup, forward: markForwardLookup())
        do {
            let note = try creator.makeNote(on: page, at: point, color: marks.lastColor)
            // Vorläufig am Rand der Stelle, an der geklickt wurde; nach dem nächsten Build am Rand der Zeile
            let size = MarkResolver.noteIconSize
            let rect = CGRect(x: max(page.bounds(for: .mediaBox).minX + size / 2, point.x - size - size / 2), y: point.y - size / 2, width: size, height: size)
            let placed = MarkResolution.placed(segments: [.init(pageIndex: document.index(for: page), rect: rect)], precision: .lines)
            insertMarks([(note, placed)], actionName: "Notiz hinzufügen")
            return note.id
        } catch let failure as MarkCreator.Failure {
            fileActions.notice = failure.message
        } catch {
            fileActions.notice = error.localizedDescription
        }
        return nil
    }

    // MARK: Kommentar, Neu zuordnen, Anzeigen

    func setComment(_ id: UUID, to text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let old = marks.marks.first(where: { $0.id == id })?.comment, old != trimmed else { return }
        applyComment(trimmed, to: id)
        registerFileUndo(FileUndoAction(
            name: "Kommentar ändern",
            undo: { [weak self] in self?.applyComment(old, to: id) },
            redo: { [weak self] in self?.applyComment(trimmed, to: id) }
        ))
    }

    private func applyComment(_ text: String, to id: UUID) {
        marks.update(id) { $0.comment = text }
        refreshMarkDisplay()
    }

    /// Eine nicht zugeordnete Markierung auf die jetzt im PDF ausgewählte Textstelle setzen (Farbe und Kommentar bleiben)
    func reassignMark(_ id: UUID) async {
        guard let old = marks.marks.first(where: { $0.id == id }), old.kind == .highlight,
              let selection = pdf.pdfView?.currentSelection, let document = pdf.pdfView?.document, let root = project.rootURL else { return }
        let lookup = markBackwardLookup ?? { [synctex] in synctex.backward(page: $0, point: $1) }
        let probe = MarkCreator(root: root, document: document, linesOf: { _ in nil }, backward: lookup)
        let sources = await Self.readSources(probe.sourcePaths(of: selection), root: root)
        let creator = MarkCreator(root: root, document: document, linesOf: { sources[$0]?.lines }, backward: lookup, forward: markForwardLookup())
        do {
            var moved = try creator.makeMark(from: selection, color: old.color, comment: old.comment)
            moved = PDFMark(id: old.id, color: old.color, comment: old.comment, text: moved.text, start: moved.start, end: moved.end, pageHint: moved.pageHint, createdAt: old.createdAt)
            let placed = MarkResolution.placed(segments: MarkResolution.segments(of: selection, in: document), precision: .words)
            let oldResolution = marks.resolutions[id]
            replaceMark(moved, resolution: placed)
            pdf.pdfView?.clearSelection()
            registerFileUndo(FileUndoAction(
                name: "Neu zuordnen",
                undo: { [weak self] in self?.replaceMark(old, resolution: oldResolution) },
                redo: { [weak self] in self?.replaceMark(moved, resolution: placed) }
            ))
        } catch let failure as MarkCreator.Failure {
            fileActions.notice = failure.message
        } catch {
            fileActions.notice = error.localizedDescription
        }
    }

    private func replaceMark(_ mark: PDFMark, resolution: MarkResolution?) {
        marks.update(mark.id) { $0 = mark }
        marks.setResolution(resolution, for: mark.id)
        refreshMarkDisplay()
    }

    /// Springt im PDF zur Markierung (Liste)
    func revealMark(_ id: UUID) {
        guard case .placed(let segments, _)? = marks.resolutions[id], let first = segments.first else { return }
        pdf.reveal(first)
    }

    func showMarkPopover(_ id: UUID) {
        guard marks.marks.contains(where: { $0.id == id }), case .placed(let segments, _)? = marks.resolutions[id],
              let first = segments.first, let target = pdf.viewRect(of: first) else { return }
        markPopover.present(
            markID: id, store: marks, from: target.view, at: target.rect,
            actions: MarkPopoverActions(
                recolor: { [weak self] color in self?.recolorMark(id, to: color) },
                setComment: { [weak self] text in self?.setComment(id, to: text) },
                remove: { [weak self] in self?.removeMarks([id]) }
            )
        )
    }

    // MARK: Ändern und Entfernen (mit Rückgängig)

    func recolorMark(_ id: UUID, to color: MarkColor) {
        guard let old = marks.marks.first(where: { $0.id == id })?.color, old != color else { return }
        applyColor(color, to: id)
        registerFileUndo(FileUndoAction(
            name: "Farbe ändern",
            undo: { [weak self] in self?.applyColor(old, to: id) },
            redo: { [weak self] in self?.applyColor(color, to: id) }
        ))
        marks.lastColor = color
    }

    private func applyColor(_ color: MarkColor, to id: UUID) {
        marks.update(id) { $0.color = color }
        if !pdf.recolorMarkAnnotations(id, to: color) { refreshMarkDisplay() }
    }

    func removeMarks(_ ids: [UUID], actionName: String = "Markierung entfernen") {
        let removed = ids.compactMap { marks.remove($0) }
        guard !removed.isEmpty else { return }
        refreshMarkDisplay()
        let snapshots = removed.map { ($0.mark, $0.resolution) }
        registerFileUndo(FileUndoAction(
            name: actionName,
            undo: { [weak self] in self?.restoreMarks(snapshots) },
            redo: { [weak self] in self?.deleteMarks(snapshots.map(\.0.id)) }
        ))
    }

    /// Alle Markierungen und Notizen des Projekts in einem Schritt (Rückgängig holt alle zurück)
    func removeAllMarks() {
        removeMarks(marks.marks.map(\.id), actionName: "Alle Markierungen entfernen")
    }

    /// Menü Bearbeiten: entfernt die Markierungen, die auf der markierten Textstelle liegen
    func removeMarksUnderSelection() {
        removeMarks(marks.marks(overlapping: pdf.selectionSegments).map(\.id))
    }

    /// Legt Markierungen an und entfernt dabei `replaced` (ein Schritt für Rückgängig)
    private func insertMarks(_ snapshots: [(PDFMark, MarkResolution?)], replacing replaced: [PDFMark] = [], actionName: String) {
        let pdfDate = pdfModificationDate()
        let old = replaced.map { ($0, marks.resolutions[$0.id]) }
        deleteMarks(replaced.map(\.id))
        restoreMarks(snapshots, pdfDate: pdfDate)
        registerFileUndo(FileUndoAction(
            name: actionName,
            undo: { [weak self] in
                self?.deleteMarks(snapshots.map(\.0.id))
                self?.restoreMarks(old, pdfDate: pdfDate)
            },
            redo: { [weak self] in
                self?.deleteMarks(old.map(\.0.id))
                self?.restoreMarks(snapshots, pdfDate: pdfDate)
            }
        ))
    }

    private func restoreMarks(_ snapshots: [(PDFMark, MarkResolution?)], pdfDate: Date? = nil) {
        for (mark, resolution) in snapshots { marks.add(mark, resolution: resolution, pdfDate: pdfDate) }
        refreshMarkDisplay()
    }

    private func deleteMarks(_ ids: [UUID]) {
        for id in ids { marks.remove(id) }
        refreshMarkDisplay()
    }

    // MARK: Quelltext lesen

    private struct SourceFile: Sendable {
        let lines: [String]
        let modified: Date?
    }

    /// Die Dateien, wie sie auf der Platte liegen (so wurden sie kompiliert), im Hintergrund gelesen
    private nonisolated static func readSources(_ paths: Set<String>, root: URL) async -> [String: SourceFile] {
        await Task.detached(priority: .utility) {
            var result: [String: SourceFile] = [:]
            for path in paths {
                let url = MarkPaths.absolute(path, in: root)
                guard let text = ProjectText.string(url) else { continue }
                let modified = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
                result[path] = SourceFile(lines: text.components(separatedBy: "\n"), modified: modified)
            }
            return result
        }.value
    }
}
