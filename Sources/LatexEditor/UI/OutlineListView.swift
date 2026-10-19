import SwiftUI

/// Hierarchische Gliederung (Kapitel > Abschnitt > Unterabschnitt). Zeilen sind Buttons statt
/// List-Auswahl, damit ein erneuter Klick auf denselben Eintrag wieder springt.
struct OutlineListView: View {
    let outline: OutlineStore
    let editor: EditorStore
    let filter: String

    @State private var collapsed: Set<String> = []

    var body: some View {
        if outline.entries.isEmpty {
            ContentUnavailableView(
                "Keine Gliederung",
                systemImage: "list.bullet.indent",
                description: Text("Keine \\chapter, \\section oder \\subsection in den eingebundenen Dateien.")
            )
        } else if filter.isEmpty {
            List {
                ForEach(outline.tree) { node in
                    OutlineNodeView(node: node, context: context)
                }
            }
            .listStyle(.sidebar)
        } else {
            List(filteredEntries) { entry in
                OutlineRow(entry: entry, isCurrent: entry.id == outline.currentEntryID, open: open)
            }
            .listStyle(.sidebar)
        }
    }

    private var filteredEntries: [OutlineEntry] {
        outline.entries.filter { $0.title.localizedCaseInsensitiveContains(filter) }
    }

    private var context: OutlineNodeView.Context {
        OutlineNodeView.Context(currentEntryID: outline.currentEntryID, collapsed: $collapsed, open: open)
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
                LevelBadge(level: entry.level)
                Text(entry.title.isEmpty ? "(ohne Titel)" : entry.title)
                    .font(font)
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

    private var font: Font {
        let base: Font = entry.level == .chapter ? .body : .callout
        return isCurrent || entry.level == .chapter ? base.weight(.semibold) : base
    }
}

private struct LevelBadge: View {
    private static let width: CGFloat = 22

    let level: OutlineEntry.Level

    var body: some View {
        Text(level.shortTitle)
            .font(.system(size: 9, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
            .frame(width: Self.width)
            .padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 3).strokeBorder(.tertiary))
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

    var shortTitle: String {
        switch self {
        case .chapter: "K"
        case .section: "§"
        case .subsection: "§§"
        }
    }
}
