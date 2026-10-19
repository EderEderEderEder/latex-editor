import SwiftUI

/// Namenseingabe für „Neue Datei“, „Neuer Ordner“ und „Umbenennen“, mit Prüfung beim Tippen.
struct NameSheet: View {
    let model: AppModel
    let prompt: NamePrompt

    @State private var name: String
    @State private var chapterScaffold = false
    @State private var serverMessage: String?
    @FocusState private var isFocused: Bool

    init(model: AppModel, prompt: NamePrompt) {
        self.model = model
        self.prompt = prompt
        _name = State(initialValue: prompt.initialName)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 26))
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(prompt.title).font(.headline)
                    Text(locationText).font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
            }
            TextField("", text: $name, prompt: Text(placeholder))
                .textFieldStyle(.roundedBorder)
                .focused($isFocused)
                .onSubmit(commit)
            if prompt.kind == .newFile, showsScaffoldOption {
                Toggle("Mit Kapitelüberschrift (\\chapter{…})", isOn: $chapterScaffold)
            }
            Label(message ?? " ", systemImage: message == nil ? "" : "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.red)
                .frame(minHeight: 18, alignment: .leading)
            HStack {
                Spacer()
                Button("Abbrechen") { model.fileActions.prompt = nil }
                    .keyboardShortcut(.cancelAction)
                Button(prompt.actionTitle, action: commit)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(validationMessage != nil)
            }
        }
        .padding(20)
        .frame(width: 440)
        .onAppear {
            isFocused = true
            selectBaseName()
        }
        .onChange(of: name) { _, _ in serverMessage = nil }
    }

    private var symbol: String {
        switch prompt.kind {
        case .newFile: "doc.badge.plus"
        case .newFolder: "folder.badge.plus"
        case .rename: "pencil"
        }
    }

    private var placeholder: String {
        switch prompt.kind {
        case .newFile: "z. B. einleitung (Endung .tex wird ergänzt)"
        case .newFolder: "Ordnername"
        case .rename: "Neuer Name"
        }
    }

    private var locationText: String {
        let root = model.project.rootURL?.standardizedFileURL.path ?? ""
        let path = prompt.kind == .rename ? prompt.target.deletingLastPathComponent().path : prompt.target.path
        let relative = path.hasPrefix(root) ? String(path.dropFirst(root.count)) : path
        return "in " + (relative.isEmpty ? "Projektordner" : String(relative.dropFirst()))
    }

    private var showsScaffoldOption: Bool {
        let ext = URL(fileURLWithPath: name).pathExtension.lowercased()
        return ext.isEmpty || ext == "tex"
    }

    private var message: String? {
        serverMessage ?? (name.isEmpty ? nil : validationMessage)
    }

    /// Prüft den Namen live (Syntax und Kollision), ohne etwas zu ändern.
    private var validationMessage: String? {
        do {
            switch prompt.kind {
            case .newFile:
                let fileName = try FileOperations.newFileName(from: name)
                _ = try FileOperations.destination(for: fileName, in: prompt.target)
            case .newFolder:
                _ = try FileOperations.destination(for: try FileOperations.validateName(name), in: prompt.target)
            case .rename:
                let fileName = try FileOperations.renamedFileName(from: name, original: prompt.target)
                _ = try FileOperations.destination(
                    for: fileName, in: prompt.target.deletingLastPathComponent(), replacing: prompt.target
                )
            }
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func commit() {
        guard validationMessage == nil else { return }
        let scaffold = chapterScaffold
        let entered = name
        Task {
            serverMessage = await model.commit(prompt, name: entered, chapterScaffold: scaffold)
        }
    }

    /// Beim Umbenennen ist nur der Name vor der Endung markiert.
    private func selectBaseName() {
        guard prompt.kind == .rename else { return }
        DispatchQueue.main.async {
            guard let editor = NSApp.keyWindow?.firstResponder as? NSTextView else { return }
            let length = (name as NSString).deletingPathExtension.count
            editor.setSelectedRange(NSRange(location: 0, length: length))
        }
    }
}
