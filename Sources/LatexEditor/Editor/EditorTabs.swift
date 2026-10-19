import Foundation

/// Ein Tab: eine Datei im Editor oder die Git-Änderungen einer Datei (Diff).
enum EditorTab: Hashable, Sendable {
    case file(URL)
    case diff(URL)

    var url: URL {
        switch self {
        case let .file(url), let .diff(url): url
        }
    }

    var fileURL: URL? {
        if case let .file(url) = self { return url }
        return nil
    }

    var diffURL: URL? {
        if case let .diff(url) = self { return url }
        return nil
    }

    /// Derselbe Tab für einen anderen Pfad (Umbenennen, Verschieben).
    func with(url: URL) -> EditorTab {
        switch self {
        case .file: .file(url)
        case .diff: .diff(url)
        }
    }
}

/// Geöffnete Tabs: Reihenfolge, aktiver Tab und höchstens ein „Vorschau-Tab“ (kursiv), der beim
/// nächsten Öffnen per Einfachklick ersetzt wird, solange er nicht bearbeitet oder per Doppelklick
/// festgehalten wurde. Datei- und Diff-Tabs teilen sich den Vorschau-Platz. Reine Logik, ohne Oberfläche.
struct EditorTabs: Equatable, Sendable {
    /// Ergebnis von `open`: welcher Tab verdrängt wurde (Vorschau-Tab), damit seine Sitzung freigegeben werden kann.
    struct OpenResult: Equatable, Sendable {
        let replaced: EditorTab?
    }

    private(set) var items: [EditorTab] = []
    private(set) var preview: EditorTab?
    private(set) var active: EditorTab?

    var isEmpty: Bool { items.isEmpty }
    /// Dateien mit eigenem Tab, in Tab-Reihenfolge
    var fileURLs: [URL] { items.compactMap(\.fileURL) }
    var activeFileURL: URL? { active?.fileURL }
    var previewFileURL: URL? { preview?.fileURL }

    func contains(_ tab: EditorTab) -> Bool {
        items.contains(tab)
    }

    /// Ob die Datei einen (Datei-)Tab hat.
    func contains(_ url: URL) -> Bool {
        contains(.file(url))
    }

    // MARK: Öffnen und Wechseln

    /// Öffnet `tab` und aktiviert ihn. Ein vorhandener Tab wird nur aktiviert; ein dauerhaftes
    /// Öffnen (`asPreview: false`) macht einen Vorschau-Tab dauerhaft.
    @discardableResult
    mutating func open(_ tab: EditorTab, asPreview: Bool) -> OpenResult {
        if contains(tab) {
            active = tab
            if !asPreview, preview == tab { preview = nil }
            return OpenResult(replaced: nil)
        }
        var replaced: EditorTab?
        if asPreview, let current = preview, let index = items.firstIndex(of: current) {
            items[index] = tab
            preview = tab
            replaced = current
        } else {
            items.insert(tab, at: insertionIndex)
            preview = asPreview ? tab : preview
        }
        active = tab
        return OpenResult(replaced: replaced)
    }

    mutating func activate(_ tab: EditorTab) {
        guard contains(tab) else { return }
        active = tab
    }

    /// Macht einen Vorschau-Tab dauerhaft (Bearbeitung oder Doppelklick).
    mutating func promote(_ tab: EditorTab) {
        if preview == tab { preview = nil }
    }

    mutating func activateNext() {
        step(by: 1)
    }

    mutating func activatePrevious() {
        step(by: -1)
    }

    // MARK: Schließen

    /// Schließt einen Tab. Liefert den neuen aktiven Tab (rechter Nachbar, sonst linker, sonst nil).
    @discardableResult
    mutating func close(_ tab: EditorTab) -> EditorTab? {
        guard let index = items.firstIndex(of: tab) else { return active }
        items.remove(at: index)
        if preview == tab { preview = nil }
        guard active == tab else { return active }
        active = items.isEmpty ? nil : items[min(index, items.count - 1)]
        return active
    }

    /// Schließt alle außer `tab` (der aktiv wird).
    mutating func close(allExcept tab: EditorTab) {
        guard contains(tab) else { return }
        items = [tab]
        active = tab
        if preview != tab { preview = nil }
    }

    mutating func closeAll() {
        items = []
        preview = nil
        active = nil
    }

    // MARK: Pfade ändern

    /// Folgt einer umbenannten oder verschobenen Datei bzw. einem Ordner: Position, Vorschau-Status
    /// und aktiver Tab bleiben erhalten. Liefert die Zuordnung alt → neu der Datei-Tabs.
    @discardableResult
    mutating func relocate(from old: URL, to new: URL) -> [URL: URL] {
        func moved(_ url: URL) -> URL {
            if url.path == old.path { return new }
            guard url.path.hasPrefix(old.path + "/") else { return url }
            return new.appendingPathComponent(String(url.path.dropFirst(old.path.count + 1)))
        }
        func movedTab(_ tab: EditorTab) -> EditorTab { tab.with(url: moved(tab.url)) }
        var mapping: [URL: URL] = [:]
        for url in fileURLs where moved(url) != url { mapping[url] = moved(url) }
        items = items.map(movedTab)
        preview = preview.map(movedTab)
        active = active.map(movedTab)
        return mapping
    }

    /// Alle Tabs (Datei und Diff), deren Datei `url` selbst ist oder darunter (Ordner) liegt.
    func tabs(under url: URL) -> [EditorTab] {
        items.filter { $0.url.path == url.path || $0.url.path.hasPrefix(url.path + "/") }
    }

    // MARK: Reihenfolge

    /// Verschiebt `tab` an die Position von `target` (davor, wenn von rechts gezogen, sonst dahinter).
    mutating func move(_ tab: EditorTab, onto target: EditorTab) {
        guard tab != target, let from = items.firstIndex(of: tab), let to = items.firstIndex(of: target) else { return }
        items.remove(at: from)
        items.insert(tab, at: to)
    }

    // MARK: Hilfen

    /// Neue Tabs stehen rechts vom aktiven Tab (wie bei VS Code und Browsern).
    private var insertionIndex: Int {
        guard let active, let index = items.firstIndex(of: active) else { return items.count }
        return index + 1
    }

    private mutating func step(by offset: Int) {
        guard items.count > 1, let active, let index = items.firstIndex(of: active) else { return }
        self.active = items[(index + offset + items.count) % items.count]
    }
}

/// Merkt die offenen Tabs pro Projektpfad (UserDefaults), damit sie beim nächsten Start wieder da sind.
enum TabMemory {
    struct Snapshot: Equatable {
        let paths: [String]
        let active: String?
    }

    private static let key = "openTabsByProject"
    private static let pathsKey = "paths"
    private static let activeKey = "active"

    static func load(for project: URL, defaults: UserDefaults = .standard) -> Snapshot? {
        let all = defaults.dictionary(forKey: key)
        guard let entry = all?[project.standardizedFileURL.path] as? [String: Any],
              let paths = entry[pathsKey] as? [String] else { return nil }
        return Snapshot(paths: paths, active: entry[activeKey] as? String)
    }

    /// Nur Datei-Tabs; Diff-Tabs werden nicht über einen Neustart gemerkt.
    static func save(_ tabs: EditorTabs, for project: URL, defaults: UserDefaults = .standard) {
        var all = defaults.dictionary(forKey: key) ?? [:]
        var entry: [String: Any] = [pathsKey: tabs.fileURLs.map(\.path)]
        if let active = tabs.activeFileURL { entry[activeKey] = active.path }
        all[project.standardizedFileURL.path] = entry
        defaults.set(all, forKey: key)
    }
}
