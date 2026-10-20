import AppKit
import SwiftUI

/// Fenster „Einstellungen“ (⌘,). Änderungen gelten sofort; jeder Reiter hat „Standard wiederherstellen“.
/// Die Werte liegen in UserDefaults unter denselben Schlüsseln wie bei den Menüs (diese bleiben synchron).
struct SettingsView: View {
    private static let width: CGFloat = 560

    let model: AppModel

    var body: some View {
        TabView {
            AppearanceSettings()
                .tabItem { Label("Darstellung", systemImage: "paintbrush") }
            EditorBehaviorSettings()
                .tabItem { Label("Editor", systemImage: "character.cursor.ibeam") }
            WritingSettings()
                .tabItem { Label("Schreiben", systemImage: "pencil") }
            BuildSettings(model: model)
                .tabItem { Label("Kompilieren & PDF", systemImage: "hammer") }
        }
        .frame(width: Self.width)
    }
}

// MARK: - Darstellung

private struct AppearanceSettings: View {
    private static let previewHeight: CGFloat = 170

    @AppStorage(EditorSettings.Key.appearance) private var appearance = AppAppearance.system
    @AppStorage(EditorSettings.Key.colorScheme) private var colorScheme = EditorColorScheme.standard
    @AppStorage(EditorSettings.Key.fontFamily) private var fontFamily = EditorSettings.systemFontFamily
    @AppStorage(EditorSettings.Key.fontSize) private var fontSize = EditorSettings.defaultFontSize
    @AppStorage(EditorSettings.Key.lineSpacing) private var lineSpacing = LineSpacing.normal
    @AppStorage(EditorSettings.Key.showsLineNumbers) private var showsLineNumbers = true
    @AppStorage(EditorSettings.Key.highlightsCurrentLine) private var highlightsCurrentLine = true

    @State private var families: [String] = []

    var body: some View {
        Form {
            Section {
                SettingsPreview()
                    .frame(height: Self.previewHeight)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: .separatorColor)))
            }
            Section {
                Picker("Erscheinungsbild", selection: $appearance) {
                    ForEach(AppAppearance.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                Picker("Farbschema", selection: $colorScheme) {
                    ForEach(EditorColorScheme.allCases) { scheme in
                        HStack { ColorSwatch(scheme: scheme); Text(scheme.title) }.tag(scheme)
                    }
                }
            }
            Section {
                Picker("Schriftart", selection: $fontFamily) {
                    Text("SF Mono (System)").tag(EditorSettings.systemFontFamily)
                    Divider()
                    ForEach(families, id: \.self) { Text($0).tag($0) }
                }
                Picker("Schriftgröße", selection: $fontSize) {
                    ForEach(EditorSettings.fontSizes, id: \.self) { Text("\(Int($0)) pt").tag($0) }
                }
                Picker("Zeilenabstand", selection: $lineSpacing) {
                    ForEach(LineSpacing.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            } footer: {
                Text("⌘+ und ⌘− vergrößern Editor und Oberfläche zusätzlich (Menü Darstellung).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Toggle("Zeilennummern anzeigen", isOn: $showsLineNumbers)
                Toggle("Aktuelle Zeile hervorheben", isOn: $highlightsCurrentLine)
            }
            ResetButton(keys: EditorSettings.Key.appearanceTab)
        }
        .formStyle(.grouped)
        .task { families = EditorSettings.monospacedFamilies() }
        .onChange(of: appearance) { EditorSettings.didChange() }
        .onChange(of: colorScheme) { EditorSettings.didChange() }
        .onChange(of: fontFamily) { EditorSettings.didChange() }
        .onChange(of: fontSize) { EditorSettings.didChange() }
        .onChange(of: lineSpacing) { EditorSettings.didChange() }
        .onChange(of: showsLineNumbers) { EditorSettings.didChange() }
        .onChange(of: highlightsCurrentLine) { EditorSettings.didChange() }
    }
}

/// Drei Farbpunkte des Schemas (Befehl, Argument, Mathe) auf seinem Hintergrund
private struct ColorSwatch: View {
    private static let dotSize: CGFloat = 7

    let scheme: EditorColorScheme
    @Environment(\.colorScheme) private var systemScheme

    var body: some View {
        let palette = scheme.palette(dark: systemScheme == .dark)
        HStack(spacing: 2) {
            ForEach([palette.command, palette.argument, palette.math], id: \.self) { hex in
                Circle().fill(Color(nsColor: EditorTheme.rgb(hex))).frame(width: Self.dotSize, height: Self.dotSize)
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 3).fill(palette.background.map { Color(nsColor: EditorTheme.rgb($0)) }
            ?? Color(nsColor: .textBackgroundColor)))
    }
}

// MARK: - Editor

private struct EditorBehaviorSettings: View {
    @AppStorage(EditorSettings.Key.wrapsLines) private var wrapsLines = true
    @AppStorage(EditorSettings.Key.indentation) private var indentation = Indentation.tab
    @AppStorage(EditorSettings.Key.tabWidth) private var tabWidth = EditorSettings.defaultTabWidth
    @AppStorage(EditorSettings.Key.checksSpelling) private var checksSpelling = true
    @AppStorage(EditorSettings.Key.spellingLanguage) private var spellingLanguage = SpellingLanguage.austrianGerman

    var body: some View {
        Form {
            Section {
                Toggle("Zeilen umbrechen", isOn: $wrapsLines)
            } footer: {
                Text("Aus: lange Zeilen laufen weiter, der Editor scrollt waagerecht.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Picker("Einrückung", selection: $indentation) {
                    ForEach(Indentation.allCases) { Text($0.title).tag($0) }
                }
                Picker("Tabbreite", selection: $tabWidth) {
                    ForEach(EditorSettings.tabWidths, id: \.self) { Text("\($0) Zeichen").tag($0) }
                }
            } footer: {
                Text("Einrückung gilt für Tab-Taste, ⌘], Enter und das Einfügen-Menü. Die HgbThesis nutzt Tabulatoren.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Toggle("Rechtschreibung prüfen", isOn: $checksSpelling)
                Picker("Sprache", selection: $spellingLanguage) {
                    ForEach(SpellingLanguage.allCases) { Text($0.title).tag($0) }
                }
                .disabled(!checksSpelling)
            }
            ResetButton(keys: EditorSettings.Key.editorTab)
        }
        .formStyle(.grouped)
        .onChange(of: wrapsLines) { EditorSettings.didChange() }
        .onChange(of: indentation) { EditorSettings.didChange() }
        .onChange(of: tabWidth) { EditorSettings.didChange() }
        .onChange(of: checksSpelling) { EditorSettings.didChange() }
        .onChange(of: spellingLanguage) { EditorSettings.didChange() }
    }
}

// MARK: - Schreiben

private struct WritingSettings: View {
    private static let keys = [CompletionSettings.automaticKey, LatexTextView.autoPairKey, Capitalization.automaticKey, WritingHints.enabledKey]

    @AppStorage(CompletionSettings.automaticKey) private var automaticCompletion = true
    @AppStorage(LatexTextView.autoPairKey) private var autoPairBrackets = true
    @AppStorage(Capitalization.automaticKey) private var autoCapitalize = true
    @AppStorage(WritingHints.enabledKey) private var showsWritingHints = true

    var body: some View {
        Form {
            Section {
                Toggle("Automatisch vervollständigen", isOn: $automaticCompletion)
                Toggle("Klammern automatisch schließen", isOn: $autoPairBrackets)
                Toggle("Groß-/Kleinschreibung automatisch korrigieren", isOn: $autoCapitalize)
                Toggle("Schreibhinweise anzeigen", isOn: $showsWritingHints)
            } footer: {
                Text("Vervollständigen von Hand: ⌃Leertaste. Schreibhinweise sind blau gepunktet unterstrichen.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ResetButton(keys: Self.keys)
        }
        .formStyle(.grouped)
    }
}

// MARK: - Kompilieren & PDF

private struct BuildSettings: View {
    let model: AppModel

    @AppStorage(AppModel.saveOnDeactivateKey) private var saveOnDeactivate = false

    var body: some View {
        Form {
            Section {
                Toggle("Beim Speichern kompilieren", isOn: Binding(
                    get: { model.build.compileOnSave }, set: { model.build.compileOnSave = $0 }
                ))
                Toggle("PDF folgt Cursor", isOn: Binding(
                    get: { model.synctex.followCursor }, set: { model.synctex.followCursor = $0 }
                ))
                Toggle("Beim Verlassen der App speichern", isOn: $saveOnDeactivate)
            } footer: {
                Text("„PDF folgt Cursor“ gibt es auch in der PDF-Leiste („Folgen“) und im Menü Darstellung.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("Standard wiederherstellen") {
                    model.build.compileOnSave = true
                    model.synctex.followCursor = false
                    saveOnDeactivate = false
                }
            }
        }
        .formStyle(.grouped)
    }
}

private struct ResetButton: View {
    let keys: [String]

    var body: some View {
        HStack {
            Spacer()
            Button("Standard wiederherstellen") { EditorSettings.reset(keys) }
        }
    }
}

// MARK: - Vorschau

/// Ein echter, schreibgeschützter Editor mit Beispieltext: zeigt Schema, Schrift, Abstand, Zeilennummern und
/// aktuelle Zeile genau so, wie sie im Editor erscheinen.
private struct SettingsPreview: NSViewRepresentable {
    static let sample = """
        \\section{Einleitung}
        \\label{sec:einleitung}
        Siehe Abbildung~\\ref{fig:ablauf} und \\cite{knuth1984}.
        Die Formel $E = mc^2$ steht im Text. % Kommentar
        \\begin{itemize}
        \t\\item Erster Punkt
        \\end{itemize}
        """

    func makeCoordinator() -> PreviewCoordinator {
        PreviewCoordinator()
    }

    func makeNSView(context: Context) -> NSScrollView {
        context.coordinator.makeView()
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {}

    @MainActor
    final class PreviewCoordinator {
        private let editor = EditorCoordinator()
        private let session = DocumentSession(url: URL(fileURLWithPath: "/Vorschau.tex"), text: SettingsPreview.sample)
        private var observer: NSObjectProtocol?

        func makeView() -> NSScrollView {
            let scrollView = editor.makeScrollView()
            editor.update(session: session, jump: nil, insert: nil)
            (scrollView.documentView as? NSTextView)?.isEditable = false
            // Die Vorschau gehört keinem Tab: Schrift und Abstand des Beispieltexts selbst nachziehen
            observer = NotificationCenter.default.addObserver(forName: EditorAppearance.fontDidChange, object: nil, queue: .main) {
                [weak self] _ in MainActor.assumeIsolated { self?.session.applyEditorFont() }
            }
            return scrollView
        }
    }
}
