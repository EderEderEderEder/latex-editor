import SwiftUI

/// „Umbenennen“: neuer Name mit Prüfung und Zahl der betroffenen Stellen.
struct RenameSheet: View {
    let model: AppModel
    let prompt: RenamePrompt

    @State private var newName: String
    @State private var summary: String?
    @FocusState private var isFocused: Bool

    init(model: AppModel, prompt: RenamePrompt) {
        self.model = model
        self.prompt = prompt
        _newName = State(initialValue: prompt.scope.oldName)
    }

    private var scope: RenameScope { prompt.scope }

    private var message: String? {
        model.renameProblem(newName, for: scope)
    }

    private var title: String {
        switch scope {
        case let .project(subject): "\(subject.kindName) umbenennen"
        case .pair: "Umgebung umbenennen"
        }
    }

    private var explanation: String {
        let name = scope.oldName
        switch scope {
        case .pair:
            return "Nur dieses \\begin{\(name)} und das passende \\end{\(name)}"
        case let .project(subject):
            switch subject.kind {
            case .label: return "\\label{\(name)} und alle Verweise darauf im Projekt"
            case .citation: return "Der Eintrag „\(name)“ in der Literaturdatei und alle Zitate (\\cite …) im Projekt"
            case .acronym: return "Die Definition von „\(name)“ und alle Verwendungen (\\ac, \\gls …) im Projekt"
            case .command: return "Die Definition von \\\(name) und alle Aufrufe im Projekt"
            case .environment: return "Die Definition und alle \\begin{\(name)} … \\end{\(name)} im Projekt"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            Text(explanation)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            TextField("Neuer Name", text: $newName)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
                .focused($isFocused)
                .onSubmit(rename)
            Group {
                if let message, newName != scope.oldName {
                    Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                } else if let summary {
                    Label(summary, systemImage: "doc.text.magnifyingglass").foregroundStyle(.secondary)
                } else {
                    Text(" ")
                }
            }
            .font(.callout)
            .frame(minHeight: 18, alignment: .leading)
            Text("Die Änderungen landen als ungespeicherte Änderung in den betroffenen Tabs (⌘Z nimmt sie zurück, ⌘S speichert).")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Abbrechen") { model.fileActions.rename = nil }
                    .keyboardShortcut(.cancelAction)
                Button("Umbenennen", action: rename)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(message != nil)
            }
        }
        .padding(20)
        .frame(width: 460)
        .onAppear {
            isFocused = true
            DispatchQueue.main.async { (NSApp.keyWindow?.firstResponder as? NSTextView)?.selectAll(nil) }
        }
        .task { summary = await model.renameSummary(for: scope) }
    }

    private func rename() {
        guard message == nil else { return }
        let scope = scope
        let name = newName
        model.fileActions.rename = nil
        Task { await model.rename(scope, to: name) }
    }
}
