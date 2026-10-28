import SwiftUI

/// Seitenleiste nach dem Vorbild von Texifier: Icon-Tabs oben, kompakte Statistik,
/// Liste im Sidebar-Stil, Filterfeld unten.
struct SidebarView: View {
    let model: AppModel

    @State private var filters: [SidebarTab: String] = [:]

    var body: some View {
        if model.project.rootURL == nil {
            NoProjectView(openProject: model.chooseProject)
        } else {
            VStack(spacing: 0) {
                SidebarTabBar(sidebar: model.sidebar, build: model.build, git: model.git)
                Divider()
                SidebarStatistics(project: model.project, outline: model.outline, build: model.build, sidebar: model.sidebar)
                Divider()
                content
                    .frame(maxHeight: .infinity)
                // „Suchen“ hat eigene Felder oben
                if model.sidebar.tab != .search {
                    Divider()
                    SidebarFilterField(text: filterBinding, placeholder: filterPlaceholder, showsBuildFiles: buildFilesBinding)
                }
            }
            // Grundschrift aller Listen (Zeilen ohne eigene Schrift)
            .scaledFont(.body)
        }
    }

    @ViewBuilder
    private var content: some View {
        let filter = filters[model.sidebar.tab, default: ""]
        switch model.sidebar.tab {
        case .files: FileTreeView(model: model, filter: filter)
        case .outline: OutlineListView(outline: model.outline, editor: model.editor, sidebar: model.sidebar, filter: filter)
        case .search: SearchListView(model: model)
        case .issues: IssueListView(model: model, filter: filter)
        case .changes: ChangesListView(model: model, filter: filter)
        }
    }

    /// Nur der Dateibaum hat Optionen im Filter
    private var buildFilesBinding: Binding<Bool>? {
        guard model.sidebar.tab == .files else { return nil }
        return Binding(get: { model.project.showsBuildFiles }, set: { model.project.showsBuildFiles = $0 })
    }

    private var filterPlaceholder: String {
        switch model.sidebar.tab {
        case .files: "Dateien filtern"
        case .outline: "Gliederung filtern"
        case .search: "Suchen"
        case .issues: "Meldungen filtern"
        case .changes: "Änderungen filtern"
        }
    }

    private var filterBinding: Binding<String> {
        let tab = model.sidebar.tab
        return Binding(get: { filters[tab, default: ""] }, set: { filters[tab] = $0 })
    }
}

private struct NoProjectView: View {
    let openProject: () -> Void

    var body: some View {
        EmptyStateView("Kein Projekt geöffnet", systemImage: "folder.badge.questionmark",
                       description: "Einen LaTeX-Projektordner öffnen, um Dateien, Gliederung und Fehler zu sehen.") {
            Button("Projekt öffnen …", action: openProject)
        }
    }
}

private struct SidebarTabBar: View {
    private static let iconSize: CGFloat = 15
    private static let barHeight: CGFloat = 30

    let sidebar: SidebarStore
    let build: BuildStore
    let git: GitStore

    @Environment(\.interfaceScale) private var scale

    var body: some View {
        HStack(spacing: 2) {
            tabButton(.files, symbol: "folder", title: "Dateien")
            tabButton(.outline, symbol: "list.bullet.indent", title: "Gliederung")
            tabButton(.search, symbol: "magnifyingglass", title: "Im Projekt suchen", shortcut: "⇧⌘F")
            tabButton(.issues, symbol: "exclamationmark.triangle", title: "Fehler und Warnungen", badge: badgeCount,
                      badgeColor: build.errorCount > 0 ? .red : .orange)
            if showsChangesTab {
                // ± wie die Diff-Tabs; die Verzweigung gehört zum Branch-Menü in der Toolbar
                tabButton(.changes, symbol: "plus.forwardslash.minus", title: "Änderungen (Git)", badge: git.changeCount,
                          badgeColor: .accentColor)
            }
        }
        .padding(.horizontal, 8)
        .frame(height: Self.barHeight * scale)
    }

    private var badgeCount: Int {
        build.errorCount + build.warningCount
    }

    /// Nur für Git-Repositories; fehlt Git, zeigt der Tab einen Hinweis.
    private var showsChangesTab: Bool {
        switch git.availability {
        case .ready, .unavailable: true
        case .unknown, .notRepository: false
        }
    }

    private func tabButton(
        _ tab: SidebarTab, symbol: String, title: String, shortcut: String? = nil, badge: Int = 0, badgeColor: Color = .orange
    ) -> some View {
        let isSelected = sidebar.tab == tab
        return Button {
            sidebar.tab = tab
        } label: {
            Image(systemName: symbol)
                .scaledFont(size: Self.iconSize)
                .symbolVariant(isSelected ? .fill : .none)
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(alignment: .topTrailing) {
                    TabBadge(count: badge, color: badgeColor, textColor: badgeColor == .orange ? .black : .white)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Kürzel nur im Tooltip: VoiceOver läse die Zeichen einzeln vor
        .help(shortcut.map { "\(title) (\($0))" } ?? title)
        .accessibilityLabel(title)
    }
}

private struct TabBadge: View {
    /// macOS-Minimum für Text
    private static let fontSize: CGFloat = 10

    let count: Int
    let color: Color
    /// Auf Orange erreicht Weiß nur 2,2:1, Schwarz 7,7:1
    let textColor: Color

    var body: some View {
        if count > 0 {
            Text(count < 100 ? "\(count)" : "99+")
                .scaledFont(size: Self.fontSize, weight: .bold)
                .monospacedDigit()
                .foregroundStyle(textColor)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(Capsule().fill(color))
                .offset(x: -6, y: 2)
        }
    }
}

/// Kennzahlen des Projekts; ein Klick wechselt zum passenden Tab.
private struct SidebarStatistics: View {
    let project: ProjectStore
    let outline: OutlineStore
    let build: BuildStore
    let sidebar: SidebarStore

    var body: some View {
        VStack(spacing: 3) {
            row("Dateien", value: "\(project.fileCount)", tab: .files)
            row("Abschnitte", value: "\(outline.entries.count)", tab: .outline)
            row("Meldungen", value: issueSummary, tab: .issues)
                .help("Meldungen des letzten Builds. Boxen: Zeilen, die zu breit oder zu locker gesetzt sind")
        }
        .scaledFont(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var issueSummary: String {
        switch build.status {
        case .idle: return "nicht kompiliert"
        case .running: return "kompiliert …"
        case .cancelled: return "abgebrochen"
        case .unavailable: return "MacTeX fehlt"
        case .succeeded, .failed:
            let warnings = build.warningCount == 1 ? "1 Warnung" : "\(build.warningCount) Warnungen"
            let boxes = build.badBoxCount == 1 ? "1 Box" : "\(build.badBoxCount) Boxen"
            return "\(build.errorCount) Fehler · \(warnings) · \(boxes)"
        }
    }

    private func row(_ title: String, value: String, tab: SidebarTab) -> some View {
        Button {
            sidebar.tab = tab
        } label: {
            HStack {
                Text(title).foregroundStyle(.secondary)
                Spacer()
                Text(value)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Filter ohne Treffer (statt einer leeren Liste)
struct NoFilterMatches: View {
    let filter: String

    var body: some View {
        EmptyStateView("Keine Treffer", systemImage: "magnifyingglass", description: "Nichts passt zu „\(filter)“.")
    }
}

private struct SidebarFilterField: View {
    @Binding var text: String
    let placeholder: String
    /// Nur im Dateibaum: Schalter „Build-Dateien zeigen“ im Menü des Filtersymbols
    var showsBuildFiles: Binding<Bool>?

    var body: some View {
        HStack(spacing: 4) {
            icon
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
            if !text.isEmpty {
                Button("Filter löschen", systemImage: "xmark.circle.fill") { text = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
            }
        }
        .scaledFont(.callout)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private var icon: some View {
        if let showsBuildFiles {
            Menu {
                Toggle("Build-Dateien zeigen", isOn: showsBuildFiles)
            } label: {
                Image(systemName: "line.3.horizontal.decrease.circle" + (showsBuildFiles.wrappedValue ? ".fill" : ""))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .foregroundStyle(showsBuildFiles.wrappedValue ? Color.accentColor : .secondary)
            .help("Filteroptionen: Hilfsdateien von LaTeX (.aux, .log, .synctex.gz …) \(showsBuildFiles.wrappedValue ? "verbergen" : "zeigen")")
            .accessibilityLabel("Filteroptionen")
        } else {
            Image(systemName: "line.3.horizontal.decrease.circle").foregroundStyle(.secondary)
        }
    }
}
