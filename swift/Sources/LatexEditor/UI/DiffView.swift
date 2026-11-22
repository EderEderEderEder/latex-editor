import SwiftUI

/// Leiste über dem Diff: Datei, Seite (Umschalter, wenn es beide gibt), Zahl der Zeilen, Hinweis auf
/// ungespeicherte Änderungen und „Datei öffnen“.
struct DiffHeader: View {
    private static let height: CGFloat = 26
    private static let separatorHeight: CGFloat = 14

    let model: AppModel
    let url: URL

    @Environment(\.interfaceScale) private var scale

    private var git: GitStore { model.git }
    private var presentation: DiffPresentation? { git.diffs[url] }
    private var hasStaged: Bool { git.change(for: url, staged: true) != nil }
    private var hasUnstaged: Bool { git.change(for: url, staged: false) != nil }

    var body: some View {
        HStack(spacing: 8) {
            // Der Dateiname kürzt sich zuletzt
            Text(url.lastPathComponent).fontWeight(.semibold).lineLimit(1).layoutPriority(1)
            side
            counts
            if hasUnsavedChanges {
                // Kurz, damit die Knöpfe rechts auch bei schmalem Fenster Platz haben; Erklärung im Tooltip
                Label("Ungespeichert", systemImage: "exclamationmark.circle")
                    .scaledFont(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize()
                    .help("Der Diff zeigt den gespeicherten Stand. Ungespeicherte Änderungen erscheinen nach ⌘S.")
            }
            Spacer(minLength: 8)
            Button("Datei öffnen") { Task { await model.editor.open(url, asPreview: false) } }
                .buttonStyle(.borderless)
                .fixedSize()
                .disabled(!FileManager.default.fileExists(atPath: url.path))
            Divider().frame(height: Self.separatorHeight * scale)
            // Abgesetzt und rot: anders als „Datei öffnen“ verwirft das Änderungen (mit Rückfrage und Rückgängig)
            Button("Zurücksetzen …", systemImage: "arrow.uturn.backward") { Task { await model.resetToLastCommit(file: url) } }
                .buttonStyle(.borderless)
                .foregroundStyle(.red)
                .fixedSize()
                .disabled(git.isBusy || git.changes(for: url).contains { $0.kind == .conflicted })
                .help("Datei auf den Stand des letzten Commits zurücksetzen …")
        }
        .scaledFont(.callout)
        .padding(.horizontal, 10)
        .frame(height: Self.height * scale)
        .background(.bar)
    }

    @ViewBuilder
    private var side: some View {
        if hasStaged && hasUnstaged {
            Picker("Seite", selection: sideBinding) {
                Text("Nicht bereitgestellt").tag(false)
                Text("Bereitgestellt").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.small)
            .fixedSize()
        } else if let presentation {
            // Darf sich kürzen, damit der Dateiname sichtbar bleibt
            Text(presentation.showsStaged ? "Bereitgestellt" : "Nicht bereitgestellt")
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var sideBinding: Binding<Bool> {
        Binding(get: { presentation?.showsStaged ?? false }, set: { git.selectSide(staged: $0, for: url) })
    }

    @ViewBuilder
    private var counts: some View {
        if case let .loaded(diff)? = presentation?.state, case .text = diff.content, diff.addedCount + diff.removedCount > 0 {
            HStack(spacing: 4) {
                Text("+\(diff.addedCount)").foregroundStyle(.green)
                Text("−\(diff.removedCount)").foregroundStyle(.red)
            }
            .monospacedDigit()
            .fixedSize()
        }
    }

    private var hasUnsavedChanges: Bool {
        presentation?.showsStaged == false && model.editor.session(for: url)?.isDirty == true
    }
}

/// Diff einer Datei untereinander: entfernte Zeilen rot, neue grün, geänderte Wörter kräftiger;
/// lange unveränderte Bereiche eingeklappt.
struct DiffView: View {
    let git: GitStore
    let url: URL

    var body: some View {
        state
            // Immer die ganze Fläche füllen: Der Editor liegt darunter und darf nicht durchscheinen
            // (Hinweise wie „Keine inhaltlichen Änderungen“ wären sonst nur so groß wie ihr Text).
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: EditorTheme.background))
    }

    @ViewBuilder
    private var state: some View {
        switch git.diffs[url]?.state {
        case nil, .loading?:
            ProgressView()
                .controlSize(.small)
        case let .failed(message)?:
            EmptyStateView("Diff nicht verfügbar", systemImage: "exclamationmark.triangle", description: message)
        case let .loaded(diff)?:
            content(of: diff)
        }
    }

    /// Aufgeklappte Bereiche liegen im Store, damit jeder Diff-Tab sie beim Wechseln behält.
    private var expandedBinding: Binding<Set<Int>> {
        Binding(get: { git.diffs[url]?.expanded ?? [] }, set: { git.setExpanded($0, for: url) })
    }

    @ViewBuilder
    private func content(of diff: FileDiff) -> some View {
        switch diff.content {
        case .binary:
            EmptyStateView("Binärdatei geändert", systemImage: "photo",
                           description: "Für Bilder und andere Binärdateien gibt es keinen Textvergleich.")
        case .conflict:
            EmptyStateView("Merge-Konflikt", systemImage: "exclamationmark.triangle",
                           description: "Die Datei enthält einen Konflikt. „Datei öffnen“, um ihn im Editor zu lösen.")
        case .tooLarge:
            EmptyStateView("Datei zu groß", systemImage: "doc.badge.ellipsis",
                           description: "Dateien über \(FileDiff.maximumBytes / 1024 / 1024) MB werden nicht verglichen.")
        case let .text(lines) where diff.addedCount == 0 && diff.removedCount == 0:
            EmptyStateView(
                lines.isEmpty ? "Noch kein Inhalt gespeichert" : "Keine inhaltlichen Änderungen",
                systemImage: lines.isEmpty ? "doc" : "equal.circle",
                description: lines.isEmpty
                    ? "Die Datei ist auf der Platte leer. Ungespeicherter Text erscheint hier erst nach dem Speichern (⌘S)."
                    : "Geändert haben sich z. B. nur die Dateirechte."
            )
        case let .text(lines):
            DiffLinesView(lines: lines, expanded: expandedBinding)
        }
    }
}

private struct DiffLinesView: View {
    private static let minimumNumberDigits = 3
    private static let digitWidth: CGFloat = 8
    private static let numberPadding: CGFloat = 10

    let lines: [DiffLine]
    @Binding var expanded: Set<Int>
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        let rows = DiffLayout.rows(for: lines, expanded: expanded)
        let numberWidth = self.numberWidth
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { row in
                    switch row {
                    case let .line(index):
                        DiffLineRow(line: lines[index], numberWidth: numberWidth)
                    case let .collapsed(start, count):
                        CollapsedRow(count: count) { expanded.insert(start) }
                    }
                }
            }
            .padding(.vertical, 4)
        }
        .background(Color(nsColor: EditorTheme.background))
    }

    private var numberWidth: CGFloat {
        let largest = lines.last.map { max($0.oldNumber ?? 0, $0.newNumber ?? 0) } ?? 0
        let digits = max(Self.minimumNumberDigits, String(largest).count)
        return (CGFloat(digits) * Self.digitWidth + Self.numberPadding) * scale
    }
}

private struct DiffLineRow: View {
    private static let lineOpacity = 0.13
    private static let wordOpacity = 0.35
    private static let signWidth: CGFloat = 18

    let line: DiffLine
    let numberWidth: CGFloat
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            number(line.oldNumber)
            number(line.newNumber)
            Text(sign)
                .foregroundStyle(tint ?? .secondary)
                .frame(width: Self.signWidth * scale)
            Text(attributedText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        // Wie im Editor: dessen Schrift folgt demselben Zoom
        .font(Font(EditorAppearance.font(for: Double(scale))))
        .padding(.trailing, 8)
        .background(tint.map { $0.opacity(Self.lineOpacity) } ?? .clear)
    }

    private func number(_ value: Int?) -> some View {
        Text(value.map(String.init) ?? "")
            .foregroundStyle(.tertiary)
            .frame(width: numberWidth, alignment: .trailing)
    }

    private var tint: Color? {
        switch line.kind {
        case .context: nil
        case .removed: .red
        case .added: .green
        }
    }

    private var sign: String {
        switch line.kind {
        case .context: ""
        case .removed: "−"
        case .added: "+"
        }
    }

    private var attributedText: AttributedString {
        var result = AttributedString()
        for segment in line.segments {
            var part = AttributedString(segment.text)
            if segment.isChanged, let tint { part.backgroundColor = tint.opacity(Self.wordOpacity) }
            result += part
        }
        // Leere Zeilen behalten ihre Höhe
        return result.characters.isEmpty ? AttributedString(" ") : result
    }
}

private struct CollapsedRow: View {
    let count: Int
    let expand: () -> Void

    var body: some View {
        Button(action: expand) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.up.and.down")
                Text(count == 1 ? "1 unveränderte Zeile" : "\(count) unveränderte Zeilen")
                Spacer()
            }
            .scaledFont(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity)
            .background(Color.secondary.opacity(0.08))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Aufklappen")
    }
}
