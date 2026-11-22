import SwiftUI

/// Seitenleisten-Ansicht „Suchen“ (⇧⌘F): Suchfeld mit Optionen, optional Ersetzen, Treffer nach Datei.
struct SearchListView: View {
    let model: AppModel

    @FocusState private var queryIsFocused: Bool

    private var search: SearchStore { model.search }

    var body: some View {
        VStack(spacing: 0) {
            SearchFields(model: model, queryIsFocused: $queryIsFocused)
            Divider()
            results
        }
        .onChange(of: search.focusRequest) { _, _ in queryIsFocused = true }
        .onAppear { if search.query.isEmpty { queryIsFocused = true } }
    }

    @ViewBuilder
    private var results: some View {
        if search.query.isEmpty {
            EmptyStateView("Im Projekt suchen", systemImage: "magnifyingglass",
                           description: "Suchbegriff eingeben. Alle Texte und Literaturdateien werden durchsucht, auch ungespeicherte.")
        } else if search.result.hits.isEmpty {
            if search.isSearching {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyStateView("Keine Treffer", systemImage: "magnifyingglass", description: "Nichts passt zu „\(search.query)“.")
            }
        } else {
            List {
                ForEach(search.result.groups, id: \.file) { group in
                    Section {
                        ForEach(group.hits) { hit in
                            SearchHitRow(model: model, hit: hit)
                        }
                    } header: {
                        SearchFileHeader(model: model, file: group.file, hits: group.hits)
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }
}

private struct SearchFields: View {
    let model: AppModel
    var queryIsFocused: FocusState<Bool>.Binding

    var body: some View {
        @Bindable var search = model.search
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Button(search.showsReplace ? "Ersetzen ausblenden" : "Ersetzen einblenden",
                       systemImage: search.showsReplace ? "chevron.down" : "chevron.right") {
                    search.showsReplace.toggle()
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                TextField("Im Projekt suchen", text: $search.query)
                    .textFieldStyle(.roundedBorder)
                    .focused(queryIsFocused)
                    .onSubmit { search.scheduleSearch(immediately: true) }
                OptionToggle(title: "Aa", help: "Groß-/Kleinschreibung beachten", isOn: $search.options.caseSensitive)
                OptionToggle(title: "ab", help: "Nur ganze Wörter", isOn: $search.options.wholeWord)
            }
            if search.showsReplace {
                HStack(spacing: 4) {
                    Color.clear.frame(width: 18, height: 1)
                    TextField("Ersetzen durch", text: $search.replacement)
                        .textFieldStyle(.roundedBorder)
                    Button("Alle ersetzen") { Task { await model.replaceAllHits() } }
                        .disabled(search.result.hits.isEmpty)
                        .help("Alle Treffer ersetzen: als ungespeicherte Änderung in den Tabs, mit ⌘Z rückgängig")
                }
            }
            summary
            if let notice = search.notice {
                HStack(alignment: .top, spacing: 4) {
                    Text(notice).foregroundStyle(.orange)
                    Spacer(minLength: 0)
                    Button("Hinweis schließen", systemImage: "xmark") { search.notice = nil }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                }
                .scaledFont(.caption)
            }
        }
        .scaledFont(.callout)
        .padding(8)
    }

    @ViewBuilder
    private var summary: some View {
        let search = model.search
        if !search.query.isEmpty, !search.result.hits.isEmpty {
            let hits = search.result.hits.count
            Text((search.result.isTruncated ? "mehr als \(hits) Treffer" : hits == 1 ? "1 Treffer" : "\(hits) Treffer")
                + " in \(search.result.fileCount) \(search.result.fileCount == 1 ? "Datei" : "Dateien")")
                .scaledFont(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct OptionToggle: View {
    let title: String
    let help: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(title, isOn: $isOn)
            .toggleStyle(.button)
            .buttonStyle(.borderless)
            .font(.system(.callout, design: .monospaced))
            .foregroundStyle(isOn ? Color.accentColor : .secondary)
            .background(RoundedRectangle(cornerRadius: 4).fill(isOn ? Color.accentColor.opacity(0.15) : .clear))
            .help(help)
    }
}

private struct SearchFileHeader: View {
    let model: AppModel
    let file: URL
    let hits: [SearchHit]

    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 6) {
            Text(relativePath)
                .scaledFont(.subheadline, weight: .semibold)
                .lineLimit(1)
                .truncationMode(.head)
            Text("\(hits.count)").foregroundStyle(.secondary).scaledFont(.caption)
            Spacer(minLength: 0)
            if isHovering, model.search.showsReplace {
                Button("In Datei ersetzen", systemImage: "arrow.right.circle") { Task { await model.replace(hits) } }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help("Alle Treffer in dieser Datei ersetzen")
            }
        }
        .onHover { isHovering = $0 }
    }

    private var relativePath: String {
        guard let root = model.project.rootURL?.standardizedFileURL.path, file.path.hasPrefix(root + "/") else {
            return file.lastPathComponent
        }
        return String(file.path.dropFirst(root.count + 1))
    }
}

private struct SearchHitRow: View {
    private static let numberWidth: CGFloat = 34

    let model: AppModel
    let hit: SearchHit

    @Environment(\.interfaceScale) private var scale
    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 6) {
            Button { model.openHit(hit) } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(hit.line)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .frame(width: Self.numberWidth * scale, alignment: .trailing)
                    Text(highlighted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if isHovering, model.search.showsReplace {
                Button("Diesen Treffer ersetzen", systemImage: "arrow.right.circle") { Task { await model.replace([hit]) } }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help("Nur diesen Treffer ersetzen")
            }
        }
        .scaledFont(.callout)
        .onHover { isHovering = $0 }
        .help("\(hit.file.lastPathComponent), Zeile \(hit.line)")
    }

    private var highlighted: AttributedString {
        var text = AttributedString(hit.excerpt)
        if let range = Range(hit.excerptRange, in: hit.excerpt), let target = Range(range, in: text) {
            text[target].inlinePresentationIntent = .stronglyEmphasized
            text[target].backgroundColor = Color.yellow.opacity(0.4)
        }
        return text
    }
}
