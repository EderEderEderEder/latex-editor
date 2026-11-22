import SwiftUI

/// ⌘P: Dateiname tippen, ↑↓ wählen, ↩ öffnen. Unscharfe Suche über alle Texte und Literaturdateien des Projekts.
struct QuickOpenSheet: View {
    private static let width: CGFloat = 520
    private static let listHeight: CGFloat = 320

    let model: AppModel

    @State private var query = ""
    @State private var selection = 0
    @FocusState private var isFocused: Bool

    private var results: [QuickOpenCandidate] {
        QuickOpenMatcher.rank(model.palette.candidates, query: query)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Datei öffnen …", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($isFocused)
                    .onSubmit(openSelection)
                    .onChange(of: query) { _, _ in selection = 0 }
            }
            .padding(12)
            Divider()
            list
        }
        .frame(width: Self.width)
        .onAppear { isFocused = true }
        .onKeyPress(.downArrow) { move(1) }
        .onKeyPress(.upArrow) { move(-1) }
        .onExitCommand { model.palette.active = nil }
    }

    @ViewBuilder
    private var list: some View {
        let results = results
        if results.isEmpty {
            Text("Keine passende Datei")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: Self.listHeight / 2)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(results.enumerated()), id: \.offset) { index, candidate in
                            QuickOpenRow(candidate: candidate, isSelected: index == selection)
                                .contentShape(Rectangle())
                                .onTapGesture { open(candidate) }
                        }
                    }
                    .padding(6)
                }
                .frame(height: Self.listHeight)
                .onChange(of: selection) { _, index in proxy.scrollTo(index) }
            }
        }
    }

    private func move(_ offset: Int) -> KeyPress.Result {
        let count = results.count
        guard count > 0 else { return .handled }
        selection = min(max(selection + offset, 0), count - 1)
        return .handled
    }

    private func openSelection() {
        let results = results
        guard results.indices.contains(selection) else { return }
        open(results[selection])
    }

    private func open(_ candidate: QuickOpenCandidate) {
        model.palette.active = nil
        Task { await model.editor.open(candidate.url) }
    }
}

private struct QuickOpenRow: View {
    let candidate: QuickOpenCandidate
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: FileKind(url: candidate.url).symbolName)
                .foregroundStyle(isSelected ? .white : Color.accentColor)
                .frame(width: 18)
            Text(candidate.fileName).lineLimit(1)
            if !candidate.folder.isEmpty {
                Text(candidate.folder)
                    .font(.callout)
                    .foregroundStyle(isSelected ? AnyShapeStyle(.white.opacity(0.8)) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 0)
            if candidate.isOpen {
                Image(systemName: "circle.fill")
                    .font(.system(size: 6))
                    .foregroundStyle(isSelected ? AnyShapeStyle(.white.opacity(0.8)) : AnyShapeStyle(.secondary))
                    .help("Offen")
            }
        }
        .foregroundStyle(isSelected ? .white : .primary)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 6).fill(isSelected ? Color.accentColor : .clear))
    }
}

/// ⌘L: Zeilennummer eingeben, ↩ springt dorthin (zu große Nummern gehen ans Dateiende).
struct GoToLineSheet: View {
    let model: AppModel

    @State private var text = ""
    @FocusState private var isFocused: Bool

    private var lineCount: Int { model.editor.current?.lineIndex.lineCount ?? 0 }
    private var line: Int? { Int(text.trimmingCharacters(in: .whitespaces)).flatMap { $0 > 0 ? $0 : nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Gehe zu Zeile").font(.headline)
            HStack {
                TextField("Zeilennummer", text: $text)
                    .textFieldStyle(.roundedBorder)
                    .focused($isFocused)
                    .onSubmit(go)
                Text("von \(lineCount)").foregroundStyle(.secondary).monospacedDigit()
            }
            HStack {
                Spacer()
                Button("Abbrechen") { model.palette.active = nil }
                    .keyboardShortcut(.cancelAction)
                Button("Springen", action: go)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(line == nil)
            }
        }
        .padding(16)
        .frame(width: 320)
        .onAppear { isFocused = true }
    }

    private func go() {
        guard let line else { return }
        model.palette.active = nil
        Task { await model.goToLine(line) }
    }
}
