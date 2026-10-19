import SwiftUI

/// „Label umbenennen“: neuer Name mit Prüfung und Zahl der betroffenen Stellen.
struct LabelRenameSheet: View {
    let model: AppModel
    let prompt: LabelRenamePrompt

    @State private var newKey: String
    @State private var summary: String?
    @FocusState private var isFocused: Bool

    init(model: AppModel, prompt: LabelRenamePrompt) {
        self.model = model
        self.prompt = prompt
        _newKey = State(initialValue: prompt.oldKey)
    }

    private var message: String? {
        LabelRenamer.validate(newKey, old: prompt.oldKey, existing: Set(model.completionProvider.allLabels().map(\.label)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Label umbenennen").font(.headline)
            Text("\\label{\(prompt.oldKey)} und alle Verweise darauf im Projekt")
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            TextField("Neuer Name", text: $newKey)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
                .focused($isFocused)
                .onSubmit(rename)
            Group {
                if let message, newKey != prompt.oldKey {
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
                Button("Abbrechen") { model.fileActions.labelRename = nil }
                    .keyboardShortcut(.cancelAction)
                Button("Umbenennen", action: rename)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(message != nil)
            }
        }
        .padding(20)
        .frame(width: 440)
        .onAppear {
            isFocused = true
            // Name ohne Vorsatz markieren ist nicht sinnvoll: alles markieren
            DispatchQueue.main.async { (NSApp.keyWindow?.firstResponder as? NSTextView)?.selectAll(nil) }
        }
        .task { summary = await model.labelRenameSummary(for: prompt.oldKey) }
    }

    private func rename() {
        guard message == nil else { return }
        let old = prompt.oldKey
        let new = newKey
        model.fileActions.labelRename = nil
        Task { await model.renameLabel(old, to: new) }
    }
}
