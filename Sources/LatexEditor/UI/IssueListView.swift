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
                Button("Log anzeigen", systemImage: "doc.text.magnifyingglass") { model.build.isLogVisible = true }
                    .disabled(model.build.rawLog.isEmpty)
                Spacer()
                if let duration = model.build.lastDuration {
                    Text(String(format: "%.1f s", Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .help("Dauer des letzten Builds")
                }
            }
            .buttonStyle(.borderless)
            .font(.callout)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
        }
    }

    @ViewBuilder
    private var content: some View {
        if case let .unavailable(message) = model.build.status {
            ContentUnavailableView("Kompilieren nicht möglich", systemImage: "exclamationmark.triangle", description: Text(message))
        } else if model.build.issues.isEmpty {
            ContentUnavailableView(emptyTitle, systemImage: emptySymbol, description: Text(emptyDescription))
        } else {
            List(filteredIssues) { issue in
                IssueRow(issue: issue, projectRoot: model.project.rootURL, open: open)
            }
            .listStyle(.sidebar)
        }
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

    private func open(_ issue: BuildIssue) {
        guard let file = issue.fileURL else {
            model.build.isLogVisible = true
            return
        }
        Task { await model.editor.open(file, line: issue.line) }
    }
}

private struct IssueRow: View {
    let issue: BuildIssue
    let projectRoot: URL?
    let open: (BuildIssue) -> Void

    var body: some View {
        Button {
            open(issue)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: symbol)
                    .foregroundStyle(color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(issue.message)
                        .lineLimit(3)
                    if let location {
                        Text(location)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canOpen)
        .help(issue.detail ?? issue.message)
    }

    /// Nur Dateien im Projekt öffnen; Meldungen aus Paketen (TeX-Live-Pfade) bleiben Info.
    private var canOpen: Bool {
        guard let file = issue.fileURL else { return true }
        guard let projectRoot else { return false }
        return file.path.hasPrefix(projectRoot.path + "/")
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

/// Rohes Build-Log in einer schreibgeschützten NSTextView (schnell auch bei mehreren MB).
struct BuildLogSheet: View {
    let build: BuildStore

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Build-Log").font(.headline)
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
