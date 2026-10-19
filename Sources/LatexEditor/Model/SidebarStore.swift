import Foundation
import Observation

/// Aktiver Seitenleisten-Tab, pro Projekt gemerkt. Liegt außerhalb der View, damit z. B. die
/// Build-Statusanzeige in der Toolbar zum Fehler-Tab wechseln kann.
@MainActor
@Observable
final class SidebarStore {
    var tab = SidebarTab.files {
        didSet {
            guard tab != oldValue, let project else { return }
            SidebarTabMemory.remember(tab, for: project, defaults: defaults)
        }
    }

    @ObservationIgnored private var project: URL?
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load(project newProject: URL?) {
        project = nil
        tab = newProject.map { SidebarTabMemory.tab(for: $0, defaults: defaults) } ?? .files
        project = newProject
    }
}
