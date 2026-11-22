import Foundation
import Observation

/// Liste der zuletzt geöffneten Projekte (neueste zuerst, ohne Duplikate, begrenzt).
enum RecentProjectList {
    static let limit = 10

    static func adding(_ path: String, to list: [String]) -> [String] {
        Array(([path] + list.filter { $0 != path }).prefix(limit))
    }
}

/// „Zuletzt geöffnet“ für das Menü, gespeichert in UserDefaults.
@MainActor
@Observable
final class RecentProjectsStore {
    private static let key = "recentProjectPaths"

    private(set) var paths: [String]
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        paths = defaults.stringArray(forKey: Self.key) ?? []
    }

    func add(_ url: URL) {
        update(RecentProjectList.adding(url.standardizedFileURL.path, to: paths))
    }

    func remove(_ path: String) {
        update(paths.filter { $0 != path })
    }

    func clear() {
        update([])
    }

    private func update(_ newPaths: [String]) {
        guard newPaths != paths else { return }
        paths = newPaths
        defaults.set(newPaths, forKey: Self.key)
    }
}

enum SidebarTab: String, CaseIterable, Hashable, Sendable {
    case files
    case outline
    case search
    case issues
    case changes

    /// Titel im Menü Darstellung
    var menuTitle: String {
        switch self {
        case .files: "Dateien"
        case .outline: "Gliederung"
        case .search: "Im Projekt suchen"
        case .issues: "Meldungen"
        case .changes: "Änderungen"
        }
    }
}

/// Merkt den zuletzt gewählten Seitenleisten-Tab pro Projektpfad.
enum SidebarTabMemory {
    private static let key = "sidebarTabByProject"

    static func tab(for project: URL, defaults: UserDefaults = .standard) -> SidebarTab {
        let stored = defaults.dictionary(forKey: key)?[project.standardizedFileURL.path] as? String
        return stored.flatMap(SidebarTab.init(rawValue:)) ?? .files
    }

    static func remember(_ tab: SidebarTab, for project: URL, defaults: UserDefaults = .standard) {
        var all = defaults.dictionary(forKey: key) ?? [:]
        all[project.standardizedFileURL.path] = tab.rawValue
        defaults.set(all, forKey: key)
    }
}
