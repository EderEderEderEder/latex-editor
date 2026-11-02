import Foundation
import Observation

/// Die Markierungen des offenen Projekts und wo sie im aktuellen PDF liegen. Gespeichert wird bei jeder Änderung
/// (nacheinander, damit eine ältere Fassung nie eine neuere überschreibt).
@MainActor
@Observable
final class MarkStore {
    private(set) var marks: [PDFMark] = []
    private(set) var resolutions: [UUID: MarkResolution] = [:]
    /// Zu welchem PDF (Änderungszeit) `resolutions` gehören: Nur für dasselbe PDF bleibt eine Lage bestehen, wenn der Text
    /// inzwischen neuer ist
    private(set) var resolvedForPDFDate: Date?
    /// Farbe des letzten Markierens: Das Tastenkürzel nimmt sie wieder
    var lastColor: MarkColor {
        didSet { if lastColor != oldValue { defaults.set(lastColor.rawValue, forKey: Self.lastColorKey) } }
    }

    static let lastColorKey = "lastMarkColor"

    /// Eine Meldung für den Nutzer (Datei unlesbar, Speichern fehlgeschlagen)
    @ObservationIgnored var onProblem: ((String) -> Void)?
    @ObservationIgnored var directory: URL
    @ObservationIgnored private(set) var root: URL?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    /// Nach einer Datei mit neuerer Version nichts überschreiben
    @ObservationIgnored private var isReadOnly = false
    @ObservationIgnored private var hasReportedSaveFailure = false

    /// Austauschbar für Tests (sie dürfen nicht in `UserDefaults.standard` schreiben)
    @ObservationIgnored var defaults: UserDefaults

    init(directory: URL = MarkStorage.defaultDirectory(), defaults: UserDefaults = .standard) {
        self.directory = directory
        self.defaults = defaults
        lastColor = defaults.string(forKey: Self.lastColorKey).flatMap(MarkColor.init(rawValue:)) ?? .yellow
    }

    func load(root: URL) {
        reset()
        self.root = root.standardizedFileURL
        do {
            marks = try MarkStorage.load(root: root, in: directory)
        } catch MarkStorage.LoadError.newerVersion(let version) {
            isReadOnly = true
            onProblem?("Die Markierungen dieses Projekts stammen aus einer neueren Version der App (Format \(version)). Sie werden nicht verändert.")
        } catch {
            let target = MarkStorage.setAside(root: root, in: directory)
            let hint = target.map { " Die Datei liegt jetzt unter „\($0.lastPathComponent)“ im Programmordner der App." } ?? ""
            onProblem?("Die Markierungen dieses Projekts konnten nicht gelesen werden.\(hint)")
        }
    }

    func reset() {
        marks = []
        resolutions = [:]
        resolvedForPDFDate = nil
        root = nil
        isReadOnly = false
        hasReportedSaveFailure = false
    }

    /// `resolution`: wo die Markierung im jetzigen PDF liegt (beim Anlegen die gewählten Zeilen, beim Rückgängig die alte Lage)
    func add(_ mark: PDFMark, resolution: MarkResolution? = nil, pdfDate: Date? = nil) {
        marks.append(mark)
        if let resolution {
            resolutions[mark.id] = resolution
            resolvedForPDFDate = pdfDate ?? resolvedForPDFDate
        }
        save()
    }

    /// Entfernt die Markierung und gibt sie samt Lage zurück (für „Rückgängig“)
    @discardableResult
    func remove(_ id: UUID) -> (mark: PDFMark, resolution: MarkResolution?)? {
        guard let mark = marks.first(where: { $0.id == id }) else { return nil }
        let resolution = resolutions[id]
        marks.removeAll { $0.id == id }
        resolutions[id] = nil
        save()
        return (mark, resolution)
    }

    /// Eine `.tex`-Datei oder ein Ordner wurde umbenannt oder verschoben: Die Anker ziehen mit (relative Pfade)
    func relocate(from source: URL, to destination: URL) {
        guard let root, let old = MarkPaths.relative(source, to: root), let new = MarkPaths.relative(destination, to: root) else { return }
        func moved(_ path: String) -> String? {
            if path == old { return new }
            return path.hasPrefix(old + "/") ? new + path.dropFirst(old.count) : nil
        }
        var changed = false
        for index in marks.indices {
            var mark = marks[index]
            if let path = moved(mark.start.path) { mark.start.path = path }
            if let path = moved(mark.end.path) { mark.end.path = path }
            guard mark != marks[index] else { continue }
            marks[index] = mark
            changed = true
        }
        if changed { save() }
    }

    func marks(overlapping segments: [MarkResolution.Segment]) -> [PDFMark] {
        guard !segments.isEmpty else { return [] }
        return marks.filter { resolutions[$0.id]?.overlaps(segments) == true }
    }

    func update(_ id: UUID, _ change: (inout PDFMark) -> Void) {
        guard let index = marks.firstIndex(where: { $0.id == id }) else { return }
        var mark = marks[index]
        change(&mark)
        guard mark != marks[index] else { return }
        marks[index] = mark
        save()
    }

    func setResolution(_ resolution: MarkResolution?, for id: UUID) {
        guard marks.contains(where: { $0.id == id }) else { return }
        resolutions[id] = resolution
    }

    func setResolutions(_ new: [UUID: MarkResolution], pdfDate: Date?) {
        if new != resolutions { resolutions = new }
        if pdfDate != resolvedForPDFDate { resolvedForPDFDate = pdfDate }
    }

    /// Sofort und vollständig auf die Platte (Tests, Beenden)
    func flush() async {
        await saveTask?.value
    }

    private func save() {
        guard let root, !isReadOnly else { return }
        let snapshot = marks
        let directory = directory
        let previous = saveTask
        saveTask = Task { [weak self] in
            await previous?.value
            let failure: String? = await Task.detached(priority: .utility) {
                do {
                    try MarkStorage.save(snapshot, root: root, in: directory)
                    return nil
                } catch {
                    return error.localizedDescription
                }
            }.value
            self?.finishSave(failure: failure)
        }
    }

    /// Einmal pro Fehlerserie melden: Sonst erschiene bei jeder Änderung dieselbe Meldung
    private func finishSave(failure: String?) {
        guard let failure else {
            hasReportedSaveFailure = false
            return
        }
        guard !hasReportedSaveFailure else { return }
        hasReportedSaveFailure = true
        onProblem?("Die Markierungen konnten nicht gespeichert werden: \(failure)")
    }
}
