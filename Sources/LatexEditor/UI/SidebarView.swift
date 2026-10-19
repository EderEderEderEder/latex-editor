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
                SidebarStatistics(project: model.project, outline: model.outline, build: model.build)
                Divider()
                content
                    .frame(maxHeight: .infinity)
                Divider()
                SidebarFilterField(text: filterBinding)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        let filter = filters[model.sidebar.tab, default: ""]
        switch model.sidebar.tab {
        case .files: FileTreeView(model: model, filter: filter)
        case .outline: OutlineListView(outline: model.outline, editor: model.editor, filter: filter)
        case .issues: IssueListView(model: model, filter: filter)
        case .changes: ChangesListView(model: model, filter: filter)
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
        ContentUnavailableView {
            Label("Kein Projekt geöffnet", systemImage: "folder.badge.questionmark")
        } description: {
            Text("Einen LaTeX-Projektordner öffnen, um Dateien, Gliederung und Fehler zu sehen.")
        } actions: {
            Button("Projekt öffnen …", action: openProject)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct SidebarTabBar: View {
    private static let iconSize: CGFloat = 15
    private static let barHeight: CGFloat = 30

    let sidebar: SidebarStore
    let build: BuildStore
    let git: GitStore

    var body: some View {
        HStack(spacing: 2) {
            tabButton(.files, symbol: "folder", title: "Dateien")
            tabButton(.outline, symbol: "list.bullet.indent", title: "Gliederung")
            tabButton(.issues, symbol: "exclamationmark.triangle", title: "Fehler und Warnungen", badge: badgeCount,
                      badgeColor: build.errorCount > 0 ? .red : .orange)
            if showsChangesTab {
                tabButton(.changes, symbol: "arrow.triangle.branch", title: "Änderungen (Git)", badge: git.changeCount,
                          badgeColor: .accentColor)
            }
        }
        .padding(.horizontal, 8)
        .frame(height: Self.barHeight)
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

    private func tabButton(_ tab: SidebarTab, symbol: String, title: String, badge: Int = 0, badgeColor: Color = .orange) -> some View {
        let isSelected = sidebar.tab == tab
        return Button {
            sidebar.tab = tab
        } label: {
            Image(systemName: symbol)
                .font(.system(size: Self.iconSize))
                .symbolVariant(isSelected ? .fill : .none)
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(alignment: .topTrailing) { TabBadge(count: badge, color: badgeColor) }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
    }
}

private struct TabBadge: View {
    let count: Int
    let color: Color

    var body: some View {
        if count > 0 {
            Text(count < 100 ? "\(count)" : "99+")
                .font(.system(size: 9, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(Capsule().fill(color))
                .offset(x: -6, y: 2)
        }
    }
}

private struct SidebarStatistics: View {
    let project: ProjectStore
    let outline: OutlineStore
    let build: BuildStore

    var body: some View {
        VStack(spacing: 3) {
            row("Dateien", value: "\(project.fileCount)")
            row("Abschnitte", value: "\(outline.entries.count)")
            row("Meldungen", value: issueSummary)
        }
        .font(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var issueSummary: String {
        switch build.status {
        case .idle: return "–"
        case .running: return "kompiliert …"
        case .unavailable: return "MacTeX fehlt"
        case .succeeded, .failed:
            return "\(build.errorCount) Fehler · \(build.warningCount) Warn. · \(build.badBoxCount) Box"
        }
    }

    private func row(_ title: String, value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit()
        }
    }
}

private struct SidebarFilterField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .foregroundStyle(.secondary)
            TextField("Filtern", text: $text)
                .textFieldStyle(.plain)
            if !text.isEmpty {
                Button("Filter löschen", systemImage: "xmark.circle.fill") { text = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
            }
        }
        .font(.callout)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
    }
}
