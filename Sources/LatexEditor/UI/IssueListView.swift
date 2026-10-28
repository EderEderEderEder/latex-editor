import AppKit
import SwiftUI

/// Fehler, Warnungen und Box-Warnungen des letzten Builds. Klick springt zur Zeile.
struct IssueListView: View {
    let model: AppModel
    let filter: String

    var body: some View {
        VStack(spacing: 0) {
            content
                .frame(maxHeight: .infinity)
            Divider()
            HStack {
                Button("Protokoll anzeigen", systemImage: "doc.text.magnifyingglass") { model.build.isLogVisible = true }
                    .disabled(model.build.rawLog.isEmpty)
                Spacer()
                if let duration = model.build.lastDuration {
                    Text(Self.formatted(duration))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .help("Dauer des letzten Builds")
                }
            }
            .buttonStyle(.borderless)
            .scaledFont(.callout)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
        }
    }

    @ViewBuilder
    private var content: some View {
        if case let .unavailable(message) = model.build.status {
            EmptyStateView("Kompilieren nicht möglich", systemImage: "exclamationmark.triangle", description: message)
        } else if model.build.issues.isEmpty, !hasHints {
            EmptyStateView(emptyTitle, systemImage: emptySymbol, description: emptyDescription)
        } else if filteredIssues.isEmpty, filteredLabels.isEmpty, filteredSources.isEmpty, filteredDuplicates.isEmpty, filteredAcronyms.isEmpty, !filter.isEmpty {
            NoFilterMatches(filter: filter)
        } else {
            List {
                if !filteredIssues.isEmpty || hasHints {
                    Section {
                        if model.build.issues.isEmpty {
                            Label(emptyTitle, systemImage: emptySymbol).foregroundStyle(.secondary).scaledFont(.callout)
                        }
                        ForEach(filteredIssues) { issue in
                            IssueRow(issue: issue, canOpen: model.canOpen(issue), isSelected: issue.id == model.build.selectedIssueID,
                                     open: model.openIssue)
                        }
                    } header: {
                        if hasHints { Text("Meldungen beim Kompilieren").scaledFont(.subheadline, weight: .semibold) }
                    }
                }
                if hasHints { hints }
            }
            .listStyle(.sidebar)
        }
    }

    // MARK: Hinweise (kein Fehler, nur aufgeräumt wäre schöner)

    private var hasHints: Bool {
        !model.referenceChecks.unusedLabels.isEmpty || !model.referenceChecks.unusedSources.isEmpty
            || !model.referenceChecks.duplicateLabels.isEmpty || !model.referenceChecks.unusedAcronyms.isEmpty
    }

    private var filteredAcronyms: [AcronymEntry] {
        guard !filter.isEmpty else { return model.referenceChecks.unusedAcronyms }
        return model.referenceChecks.unusedAcronyms.filter {
            $0.key.localizedCaseInsensitiveContains(filter) || $0.summary.localizedCaseInsensitiveContains(filter)
        }
    }

    private var filteredDuplicates: [LabelEntry] {
        guard !filter.isEmpty else { return model.referenceChecks.duplicateLabels }
        return model.referenceChecks.duplicateLabels.filter { $0.label.localizedCaseInsensitiveContains(filter) }
    }

    private var filteredLabels: [LabelEntry] {
        guard !filter.isEmpty else { return model.referenceChecks.unusedLabels }
        return model.referenceChecks.unusedLabels.filter { $0.label.localizedCaseInsensitiveContains(filter) }
    }

    private var filteredSources: [BibEntry] {
        guard !filter.isEmpty else { return model.referenceChecks.unusedSources }
        return model.referenceChecks.unusedSources.filter {
            $0.key.localizedCaseInsensitiveContains(filter) || $0.title.localizedCaseInsensitiveContains(filter)
        }
    }

    @ViewBuilder
    private var hints: some View {
        Section {
            if !filteredDuplicates.isEmpty {
                hintGroup("duplicates", title: "Doppelte Labels (\(filteredDuplicates.count))") {
                    ForEach(filteredDuplicates, id: \.self) { entry in
                        HintRow(title: entry.label, detail: "\(entry.file.lastPathComponent):\(entry.line)") {
                            Task { await model.editor.open(entry.file, line: entry.line) }
                        }
                    }
                }
            }
            if !filteredLabels.isEmpty {
                hintGroup("labels", title: "Ungenutzte Labels (\(filteredLabels.count))") {
                    ForEach(filteredLabels) { entry in
                        HintRow(title: entry.label, detail: "\(entry.file.lastPathComponent):\(entry.line)") {
                            Task { await model.editor.open(entry.file, line: entry.line) }
                        }
                    }
                }
            }
            if !filteredAcronyms.isEmpty {
                hintGroup("acronyms", title: "Ungenutzte Abkürzungen (\(filteredAcronyms.count))") {
                    ForEach(filteredAcronyms, id: \.self) { entry in
                        HintRow(title: entry.key, detail: entry.summary) {
                            Task { await model.editor.open(entry.file, line: entry.line) }
                        }
                    }
                }
            }
            if !filteredSources.isEmpty {
                hintGroup("sources", title: "Nicht zitierte Quellen (\(filteredSources.count))") {
                    ForEach(filteredSources) { entry in
                        HintRow(title: entry.key, detail: entry.title) {
                            guard let file = entry.file else { return }
                            Task { await model.editor.open(file, line: entry.line) }
                        }
                    }
                }
            }
        } header: {
            Text("Hinweise").scaledFont(.subheadline, weight: .semibold)
                .help("Kein Fehler beim Kompilieren: doppelte Labels (LaTeX warnt), ungenutzte Labels und nicht zitierte Quellen.")
        }
    }

    private func hintGroup<Content: View>(_ id: String, title: String, @ViewBuilder content: @escaping () -> Content) -> some View {
        let sidebar = model.sidebar
        // Bei aktivem Filter immer aufgeklappt, sonst sähe man die Treffer nicht
        let expanded = Binding(
            get: { !filter.isEmpty || sidebar.expandedHintGroups.contains(id) },
            set: { if $0 { sidebar.expandedHintGroups.insert(id) } else { sidebar.expandedHintGroups.remove(id) } }
        )
        return DisclosureGroup(isExpanded: expanded) { content() } label: { Text(title).scaledFont(.callout) }
    }

    private var filteredIssues: [BuildIssue] {
        guard !filter.isEmpty else { return model.build.issues }
        return model.build.issues.filter {
            $0.message.localizedCaseInsensitiveContains(filter)
                || ($0.fileURL?.lastPathComponent.localizedCaseInsensitiveContains(filter) ?? false)
        }
    }

    private var emptyTitle: String {
        model.build.status == .succeeded ? "Keine Meldungen" : "Noch nicht kompiliert"
    }

    private var emptySymbol: String {
        model.build.status == .succeeded ? "checkmark.circle" : "hammer"
    }

    private var emptyDescription: String {
        model.build.status == .succeeded ? "Der letzte Build lief ohne Fehler und Warnungen." : "Mit ⌘B kompilieren."
    }

    /// Mit deutschem Komma, z. B. „3,9 s“
    static func formatted(_ duration: Duration) -> String {
        let seconds = Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
        return seconds.formatted(.number.precision(.fractionLength(1)).locale(Locale(identifier: "de_AT"))) + " s"
    }
}

private struct HintRow: View {
    let title: String
    let detail: String
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 6) {
                Text(title).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                Text(detail).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            }
            .scaledFont(.callout)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct IssueRow: View {
    let issue: BuildIssue
    let canOpen: Bool
    let isSelected: Bool
    let open: (BuildIssue) -> Void

    var body: some View {
        // Nicht `.disabled`: Das graut auch den Text aus. Meldungen aus Paketen bleiben lesbar, öffnen aber nichts.
        Button {
            if canOpen || issue.fileURL == nil { open(issue) }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: symbol)
                    .foregroundStyle(color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(issue.message)
                        .lineLimit(3)
                    if let location {
                        Text(location)
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            // `.sidebar`-Listen ignorieren die vererbte Schrift, deshalb an jeder Zeile
            .scaledFont(.body)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(isSelected ? Color.accentColor.opacity(0.15).clipShape(RoundedRectangle(cornerRadius: 5)) : nil)
        .help((issue.detail ?? issue.message) + (canOpen ? "" : "\n\nStammt aus einem Paket außerhalb des Projekts."))
    }

    private var location: String? {
        guard let file = issue.fileURL else { return nil }
        let name = file.lastPathComponent
        return issue.line.map { "\(name):\($0)" } ?? name
    }

    private var symbol: String {
        switch issue.severity {
        case .error: "xmark.octagon.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .badBox: "rectangle.compress.vertical"
        }
    }

    private var color: Color {
        switch issue.severity {
        case .error: .red
        case .warning: .orange
        case .badBox: .yellow
        }
    }
}

/// Rohes Protokoll des Kompilierens in einer schreibgeschützten NSTextView (schnell auch bei mehreren MB).
struct BuildLogSheet: View {
    let build: BuildStore

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Protokoll des Kompilierens").font(.headline)
                Spacer()
                Button("Schließen") { build.isLogVisible = false }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(10)
            Divider()
            LogTextView(text: build.rawLog)
        }
        .frame(minWidth: 700, idealWidth: 900, minHeight: 450, idealHeight: 650)
    }
}

private struct LogTextView: NSViewRepresentable {
    private static let fontSize: CGFloat = 11

    let text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSTextView.scrollableTextView()
        guard let textView = scrollView.documentView as? NSTextView else { return scrollView }
        textView.isEditable = false
        textView.isRichText = false
        textView.font = .monospacedSystemFont(ofSize: Self.fontSize, weight: .regular)
        textView.textContainerInset = NSSize(width: 8, height: 8)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView, textView.string != text else { return }
        textView.string = text
        textView.scrollToEndOfDocument(nil)
    }
}
