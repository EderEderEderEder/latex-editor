import AppKit
import Observation
import SwiftUI

/// Zustand der Liste „Verwendungen anzeigen“: lädt im Hintergrund und trennt Definition von Verwendungen.
@MainActor
@Observable
final class UsageListModel {
    let subject: RenameSubject
    private(set) var entries: [UsageEntry] = []
    private(set) var isLoading = true

    init(subject: RenameSubject) {
        self.subject = subject
    }

    func load(using loader: (RenameSubject) async -> [UsageEntry]) async {
        entries = await loader(subject)
        isLoading = false
    }

    var definitions: [UsageEntry] { entries.filter(\.isDefinition) }

    /// Verwendungen, nach Datei gruppiert (Reihenfolge der Dateien wie geliefert)
    var usesByFile: [(file: URL, entries: [UsageEntry])] {
        var order: [URL] = []
        var groups: [URL: [UsageEntry]] = [:]
        for entry in entries where !entry.isDefinition {
            if groups[entry.file] == nil { order.append(entry.file) }
            groups[entry.file, default: []].append(entry)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }

    var uses: Int { entries.count { !$0.isDefinition } }

    var summary: String {
        if isLoading { return "Suche …" }
        guard !entries.isEmpty else { return "Keine Stellen gefunden" }
        let files = Set(entries.map(\.file)).count
        let places = uses == 1 ? "1 Verwendung" : "\(uses) Verwendungen"
        return "\(places) in \(files) \(files == 1 ? "Datei" : "Dateien")" + (definitions.isEmpty ? ", keine Definition im Projekt" : "")
    }
}

/// Popover am Text: Wo wird dieser Name definiert und verwendet? Klick auf eine Zeile springt dorthin und schließt es.
struct UsageListView: View {
    private static let width: CGFloat = 460
    private static let maximumHeight: CGFloat = 360
    private static let numberWidth: CGFloat = 34

    let model: UsageListModel
    let open: (UsageEntry) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            content
        }
        .frame(width: Self.width)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.subject.displayName).font(.headline).lineLimit(1).truncationMode(.middle)
            Text(model.summary).font(.callout).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var content: some View {
        if model.isLoading {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(20)
        } else if model.entries.isEmpty {
            Text("Der Name kommt in keiner .tex- oder .bib-Datei des Projekts vor.")
                .font(.callout).foregroundStyle(.secondary).padding(12)
        } else {
            List {
                if !model.definitions.isEmpty {
                    Section("Definition") { rows(model.definitions) }
                }
                ForEach(model.usesByFile, id: \.file) { group in
                    Section(group.file.lastPathComponent) { rows(group.entries) }
                }
            }
            .listStyle(.plain)
            .frame(height: min(Self.maximumHeight, CGFloat(model.entries.count + model.usesByFile.count + 2) * 28))
        }
    }

    private func rows(_ entries: [UsageEntry]) -> some View {
        ForEach(entries) { entry in
            Button { open(entry) } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(entry.line)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: Self.numberWidth, alignment: .trailing)
                    Text(Self.highlighted(entry))
                        .font(.system(.callout, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("\(entry.file.lastPathComponent), Zeile \(entry.line)")
            .accessibilityLabel("\(entry.file.lastPathComponent), Zeile \(entry.line): \(entry.excerpt)")
        }
    }

    /// Der Treffer fett, der Rest in der Grundfarbe
    private static func highlighted(_ entry: UsageEntry) -> AttributedString {
        var text = AttributedString(entry.excerpt)
        guard let match = entry.matchInExcerpt, let range = Range(match, in: entry.excerpt),
              let attributedRange = Range(range, in: text) else { return text }
        text[attributedRange].font = .system(.callout, design: .monospaced).weight(.bold)
        return text
    }
}

/// Zeigt die Liste als Popover am Text (nur eines zugleich, es schließt bei Klick daneben oder auf eine Zeile).
@MainActor
final class UsagePopoverPresenter: NSObject, NSPopoverDelegate {
    private var popover: NSPopover?

    func present(
        subject: RenameSubject, from view: NSView, at rect: NSRect,
        loader: @escaping (RenameSubject) async -> [UsageEntry], open: @escaping (UsageEntry) -> Void
    ) {
        popover?.close()
        let model = UsageListModel(subject: subject)
        let popover = NSPopover()
        popover.behavior = .transient
        popover.delegate = self
        popover.contentViewController = NSHostingController(rootView: UsageListView(model: model) { [weak self] entry in
            self?.popover?.close()
            open(entry)
        })
        self.popover = popover
        popover.show(relativeTo: rect, of: view, preferredEdge: .maxY)
        Task { await model.load(using: loader) }
    }

    func popoverDidClose(_ notification: Notification) {
        popover = nil
    }
}
