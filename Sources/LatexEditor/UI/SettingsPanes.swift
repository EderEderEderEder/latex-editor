import AppKit
import SwiftUI

// Inhalt der Bereiche im Fenster „Einstellungen“ (`SettingsView`): je eine Folge von Abschnitten im gruppierten Formular.

// MARK: - Darstellung

struct AppearanceSettings: View {
    private static let previewHeight: CGFloat = 150

    @AppStorage(EditorSettings.Key.colorScheme) private var colorScheme = EditorColorScheme.standard
    @AppStorage(EditorSettings.Key.fontFamily) private var fontFamily = EditorSettings.systemFontFamily
    @AppStorage(EditorSettings.Key.fontSize) private var fontSize = EditorSettings.defaultFontSize
    @AppStorage(EditorSettings.Key.lineSpacing) private var lineSpacing = LineSpacing.normal
    @AppStorage(EditorSettings.Key.showsLineNumbers) private var showsLineNumbers = true
    @AppStorage(EditorSettings.Key.highlightsCurrentLine) private var highlightsCurrentLine = true

    @State private var families: [String] = []

    var body: some View {
        Section("Vorschau") {
            SettingsPreview()
                .frame(height: Self.previewHeight)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: .separatorColor)))
        }
        Section("Farbschema") {
            SchemePicker(selection: $colorScheme)
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
        } header: {
            Text("Schrift")
        } footer: {
            SettingsFootnote("⌘+ und ⌘− vergrößern Editor und Oberfläche zusätzlich (Menü Darstellung).")
        }
        Section("Anzeige") {
            Toggle("Zeilennummern anzeigen", isOn: $showsLineNumbers)
            Toggle("Aktuelle Zeile hervorheben", isOn: $highlightsCurrentLine)
        }
        ResetSection(keys: EditorSettings.Key.appearanceTab)
            .task { families = EditorSettings.monospacedFamilies() }
            .onChange(of: colorScheme) { EditorSettings.didChange(affectsText: false) }
            .onChange(of: fontFamily) { EditorSettings.didChange(affectsText: true) }
            .onChange(of: fontSize) { EditorSettings.didChange(affectsText: true) }
            .onChange(of: lineSpacing) { EditorSettings.didChange(affectsText: true) }
            .onChange(of: showsLineNumbers) { EditorSettings.didChange(affectsText: false) }
            .onChange(of: highlightsCurrentLine) { EditorSettings.didChange(affectsText: false) }
    }
}

/// Die Farbschemata als kleine Code-Ausschnitte in ihren echten Farben: Man wählt, was man sieht.
private struct SchemePicker: View {
    @Binding var selection: EditorColorScheme

    var body: some View {
        HStack(spacing: 10) {
            ForEach(EditorColorScheme.allCases) { scheme in
                Button { selection = scheme } label: {
                    SchemeCard(scheme: scheme, isSelected: scheme == selection)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(scheme.title)
                .accessibilityAddTraits(scheme == selection ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct SchemeCard: View {
    private static let fontSize: CGFloat = 10
    private static let cardHeight: CGFloat = 54
    private static let cornerRadius: CGFloat = 7

    let scheme: EditorColorScheme
    let isSelected: Bool
    @Environment(\.colorScheme) private var systemScheme

    var body: some View {
        let palette = scheme.palette(dark: systemScheme == .dark)
        VStack(spacing: 5) {
            VStack(alignment: .leading, spacing: 2) {
                Text(sample(palette))
                Text(mathSample(palette))
            }
            .font(.system(size: Self.fontSize, design: .monospaced))
            .padding(8)
            .frame(maxWidth: .infinity, minHeight: Self.cardHeight, alignment: .topLeading)
            .background(color(palette.background) ?? Color(nsColor: .textBackgroundColor),
                        in: RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                    .strokeBorder(isSelected ? Color.accentColor : Color(nsColor: .separatorColor), lineWidth: isSelected ? 2.5 : 1)
            )
            Text(scheme.title)
                .font(.callout)
                .fontWeight(isSelected ? .semibold : .regular)
        }
        .contentShape(Rectangle())
    }

    private func color(_ hex: UInt32?) -> Color? {
        hex.map { Color(nsColor: EditorTheme.rgb($0)) }
    }

    private func sample(_ palette: EditorPalette) -> AttributedString {
        var command = AttributedString("\\ref")
        command.foregroundColor = color(palette.command)
        var open = AttributedString("{")
        open.foregroundColor = color(palette.delimiter)
        var argument = AttributedString("fig:a")
        argument.foregroundColor = color(palette.argument)
        var close = AttributedString("}")
        close.foregroundColor = color(palette.delimiter)
        return command + open + argument + close
    }

    private func mathSample(_ palette: EditorPalette) -> AttributedString {
        var math = AttributedString("$x^2$ ")
        math.foregroundColor = color(palette.math)
        var comment = AttributedString("% Notiz")
        comment.foregroundColor = color(palette.comment)
        return math + comment
    }
}

// MARK: - Editor

struct EditorBehaviorSettings: View {
    @AppStorage(EditorSettings.Key.wrapsLines) private var wrapsLines = true
    @AppStorage(EditorSettings.Key.indentation) private var indentation = Indentation.tab
    @AppStorage(EditorSettings.Key.tabWidth) private var tabWidth = EditorSettings.defaultTabWidth

    var body: some View {
        Section {
            Toggle("Zeilen umbrechen", isOn: $wrapsLines)
        } footer: {
            SettingsFootnote("Aus: Lange Zeilen laufen weiter, der Editor scrollt waagerecht.")
        }
        Section {
            Picker("Einrückung", selection: $indentation) {
                ForEach(Indentation.allCases) { Text($0.title).tag($0) }
            }
            Picker("Tabbreite", selection: $tabWidth) {
                ForEach(EditorSettings.tabWidths, id: \.self) { Text("\($0) Zeichen").tag($0) }
            }
        } footer: {
            SettingsFootnote("Einrückung gilt für Tab-Taste, ⌘], Enter und das Einfügen-Fenster. Die HgbThesis nutzt Tabulatoren.")
        }
        ResetSection(keys: EditorSettings.Key.editorTab)
            .onChange(of: wrapsLines) { EditorSettings.didChange(affectsText: false) }
            .onChange(of: indentation) { EditorSettings.didChange(affectsText: false) }
            .onChange(of: tabWidth) { EditorSettings.didChange(affectsText: true) }
    }
}

// MARK: - Rechtschreibung

struct SpellingSettings: View {
    @AppStorage(EditorSettings.Key.checksSpelling) private var checksSpelling = true
    @AppStorage(EditorSettings.Key.spellingLanguage) private var spellingLanguage = SpellingLanguage.austrianGerman

    var body: some View {
        Section {
            Toggle("Rechtschreibung prüfen", isOn: $checksSpelling)
            Picker("Sprache", selection: $spellingLanguage) {
                ForEach(SpellingLanguage.allCases) { Text($0.title).tag($0) }
            }
            .disabled(!checksSpelling)
        } footer: {
            SettingsFootnote("Befehle, Formeln, Kommentare und Code werden nicht geprüft. Rund "
                + "\(TechnicalVocabulary.standard.wordCount.formatted()) Fachwörter samt Mehrzahl und Zusammensetzungen gelten als richtig.")
        }
        ResetSection(keys: EditorSettings.Key.spellingTab)
            .onChange(of: checksSpelling) { EditorSettings.didChange(affectsText: false) }
            .onChange(of: spellingLanguage) { EditorSettings.didChange(affectsText: false) }
    }
}

// MARK: - Schreibhilfen

struct WritingSettings: View {
    private static let keys = [CompletionSettings.automaticKey, LatexTextView.autoPairKey, Capitalization.automaticKey, WritingHints.enabledKey]

    @AppStorage(CompletionSettings.automaticKey) private var automaticCompletion = true
    @AppStorage(LatexTextView.autoPairKey) private var autoPairBrackets = true
    @AppStorage(Capitalization.automaticKey) private var autoCapitalize = true
    @AppStorage(WritingHints.enabledKey) private var showsWritingHints = true

    var body: some View {
        Section {
            Toggle("Automatisch vervollständigen", isOn: $automaticCompletion)
            Toggle("Klammern automatisch schließen", isOn: $autoPairBrackets)
        } footer: {
            SettingsFootnote("Von Hand vervollständigen: ⌃Leertaste.")
        }
        Section {
            Toggle("Groß-/Kleinschreibung automatisch korrigieren", isOn: $autoCapitalize)
            Toggle("Schreibhinweise anzeigen", isOn: $showsWritingHints)
        } footer: {
            SettingsFootnote("Schreibhinweise sind blau gepunktet unterstrichen, z. B. doppelte Wörter oder „z.B.“ ohne schmales Leerzeichen.")
        }
        ResetSection(keys: Self.keys)
    }
}

// MARK: - Kompilieren

struct BuildSettings: View {
    let model: AppModel

    @AppStorage(AppModel.saveOnDeactivateKey) private var saveOnDeactivate = false

    var body: some View {
        Section {
            Toggle("Beim Speichern kompilieren", isOn: Binding(
                get: { model.build.compileOnSave }, set: { model.build.compileOnSave = $0 }
            ))
            Toggle("Beim Wechsel in eine andere App speichern", isOn: $saveOnDeactivate)
        } footer: {
            SettingsFootnote("Kompilieren von Hand: ⌘B. Alle Befehle stehen im Menü Kompilieren.")
        }
        Section("LaTeX") {
            LabeledContent("latexmk") {
                if LatexToolchain.latexmk() != nil {
                    Label("Gefunden in /Library/TeX/texbin", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.secondary)
                } else {
                    Label("Fehlt – MacTeX installieren", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }
        }
        Section {
            HStack {
                Spacer()
                Button("Standard wiederherstellen") {
                    model.build.compileOnSave = true
                    saveOnDeactivate = false
                }
            }
        }
    }
}

// MARK: - PDF

struct PDFSettings: View {
    let model: AppModel

    var body: some View {
        Section {
            Toggle("PDF folgt Cursor", isOn: Binding(
                get: { model.synctex.followCursor }, set: { model.synctex.followCursor = $0 }
            ))
        } footer: {
            SettingsFootnote("Das PDF scrollt zur Stelle, an der du schreibst. ⌘J springt einmalig dorthin, ⌘-Klick ins PDF springt in den Text. "
                + "Auch als „Folgen“ in der PDF-Leiste.")
        }
        Section {
            HStack {
                Spacer()
                Button("Standard wiederherstellen") { model.synctex.followCursor = false }
            }
        }
    }
}

// MARK: - Bausteine

private struct SettingsFootnote: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// „Standard wiederherstellen“ rechtsbündig, ohne eigene leere Karte
private struct ResetSection: View {
    let keys: [String]

    var body: some View {
        Section {
            HStack {
                Spacer()
                Button("Standard wiederherstellen") { EditorSettings.reset(keys) }
            }
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
        /// Beim Schließen des Fensters abmelden, sonst sammelt sich pro Öffnen ein Beobachter an
        nonisolated(unsafe) private var observer: NSObjectProtocol?

        deinit {
            if let observer { NotificationCenter.default.removeObserver(observer) }
        }

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
