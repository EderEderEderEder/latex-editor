import SwiftUI

/// Hierarchische Gliederung (Kapitel > Abschnitt > Unterabschnitt). Zeilen sind Buttons statt
/// List-Auswahl, damit ein erneuter Klick auf denselben Eintrag wieder springt.
struct OutlineListView: View {
    let outline: OutlineStore
    let editor: EditorStore
    let sidebar: SidebarStore
    let filter: String
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        if outline.entries.isEmpty {
            EmptyStateView(
                "Keine Gliederung",
                systemImage: "list.bullet.indent",
                description: "Keine \\chapter, \\section oder \\subsection in den eingebundenen Dateien."
            )
        } else if filteredEntries.isEmpty {
            NoFilterMatches(filter: filter)
        } else if filter.isEmpty {
            List {
                ForEach(outline.tree) { node in
                    OutlineNodeView(node: node, context: context)
                }
            }
            .listStyle(.sidebar)
        } else {
            List(filteredEntries) { entry in
                // Ohne Baum zeigt die Einrückung die Ebene
                OutlineRow(entry: entry, isCurrent: entry.id == outline.currentEntryID, open: open)
                    .padding(.leading, CGFloat(entry.level.depth) * Self.filteredIndent * scale)
            }
            .listStyle(.sidebar)
        }
    }

    private static let filteredIndent: CGFloat = 14

    private var filteredEntries: [OutlineEntry] {
        guard !filter.isEmpty else { return outline.entries }
        return outline.entries.filter { $0.title.localizedCaseInsensitiveContains(filter) }
    }

    /// Im Store, damit Zugeklapptes einen Tabwechsel der Seitenleiste übersteht
    private var context: OutlineNodeView.Context {
        let collapsed = Binding(get: { sidebar.collapsedOutlineEntries }, set: { sidebar.collapsedOutlineEntries = $0 })
        return OutlineNodeView.Context(currentEntryID: outline.currentEntryID, collapsed: collapsed, open: open)
    }

    private func open(_ entry: OutlineEntry) {
        Task { await editor.open(entry.fileURL, line: entry.line) }
    }
}

private struct OutlineNodeView: View {
    struct Context {
        let currentEntryID: String?
        let collapsed: Binding<Set<String>>
        let open: (OutlineEntry) -> Void
    }

    let node: OutlineNode
    let context: Context

    var body: some View {
        if let children = node.children {
            DisclosureGroup(isExpanded: isExpanded) {
                ForEach(children) { child in
                    OutlineNodeView(node: child, context: context)
                }
            } label: {
                row
            }
        } else {
            row
        }
    }

    private var row: some View {
        OutlineRow(entry: node.entry, isCurrent: node.id == context.currentEntryID, open: context.open)
    }

    private var isExpanded: Binding<Bool> {
        let id = node.id
        let collapsed = context.collapsed
        return Binding(
            get: { !collapsed.wrappedValue.contains(id) },
            set: { expanded in
                if expanded { collapsed.wrappedValue.remove(id) } else { collapsed.wrappedValue.insert(id) }
            }
        )
    }
}

private struct OutlineRow: View {
    let entry: OutlineEntry
    let isCurrent: Bool
    let open: (OutlineEntry) -> Void

    var body: some View {
        Button {
            open(entry)
        } label: {
            HStack(spacing: 6) {
                Text(entry.title.isEmpty ? "(ohne Titel)" : entry.title)
                    .scaledFont(entry.level == .chapter ? .body : .callout, weight: weight)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isCurrent ? Color.accentColor : Color.primary)
        .listRowBackground(isCurrent ? Color.accentColor.opacity(0.12).clipShape(RoundedRectangle(cornerRadius: 5)) : nil)
        .help("\(entry.level.title): \(entry.fileURL.lastPathComponent), Zeile \(entry.line)")
    }

    private var weight: Font.Weight {
        isCurrent || entry.level == .chapter ? .semibold : .regular
    }
}

extension OutlineEntry.Level {
    var title: String {
        switch self {
        case .chapter: "Kapitel"
        case .section: "Abschnitt"
        case .subsection: "Unterabschnitt"
        }
    }

    /// Einrückung in der gefilterten (flachen) Liste
    var depth: Int {
        switch self {
        case .chapter: 0
        case .section: 1
        case .subsection: 2
        }
    }
}
