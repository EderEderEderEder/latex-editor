import SwiftUI

// MARK: - Gestaltungsbausteine

/// Gruppe zusammengehöriger Einstellungen.
struct SettingsCard<Content: View>: View {
    let title: String?
    let content: Content

    init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    /// Wie ein gruppiertes Systemformular: Titel über dem Kasten (nicht in GROSSBUCHSTABEN), Kasten in der Farbe der
    /// Bedienelemente auf dem Fensterhintergrund
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title)
                    .font(.headline)
                    .padding(.leading, 4)
            }
            VStack(alignment: .leading, spacing: 10) { content }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.separator))
        }
    }
}

/// Zeile mit festem Beschriftungsbereich links.
private let settingLabelWidth: CGFloat = 112

struct SettingRow<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .foregroundStyle(.secondary)
                .frame(width: settingLabelWidth, alignment: .trailing)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct SettingsStack<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) { content }
    }
}

struct CaptionCard: View {
    @Binding var caption: String
    @Binding var labelOverride: String
    @Binding var placement: FloatPlacement
    let automaticLabel: String
    /// Nur wo der Schalter allein die Beschriftung betrifft (Bild); bei Tabellen gilt er auch für die Zellen
    var escapeText: Binding<Bool>?

    var body: some View {
        SettingsCard("Beschriftung") {
            SettingRow("Text") {
                TextField("", text: $caption, prompt: Text("z. B. Ergebnisse der Messung"))
                    .textFieldStyle(.roundedBorder)
            }
            if let escapeText {
                SettingRow("") {
                    Toggle("Sonderzeichen maskieren", isOn: escapeText)
                }
            }
            SettingRow("Label") {
                TextField("", text: $labelOverride, prompt: Text(automaticLabel.isEmpty ? "wird aus dem Text erzeugt" : automaticLabel))
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
            }
            SettingRow("Platzierung") {
                Picker("", selection: $placement) {
                    ForEach(FloatPlacement.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
            }
        }
    }
}

struct CodeEditorField: View {
    @Binding var text: String
    let minimumHeight: CGFloat

    var body: some View {
        TextEditor(text: $text)
            .font(.system(.body, design: .monospaced))
            .scrollContentBackground(.hidden)
            .padding(6)
            .frame(minHeight: minimumHeight)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
    }
}
