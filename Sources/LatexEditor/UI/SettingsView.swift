import AppKit
import SwiftUI

/// Fenster „Einstellungen“ (⌘,) im Aufbau der Systemeinstellungen: links Suche und Bereiche mit farbigen Symbolen, rechts
/// eine Kopfkarte (Symbol, Titel, Beschreibung) und gruppierte Zeilen. Änderungen gelten sofort, jeder Bereich hat
/// „Standard wiederherstellen“. Die Werte liegen in UserDefaults unter denselben Schlüsseln wie bei den Menüs.
struct SettingsView: View {
    private static let size = NSSize(width: 780, height: 600)
    private static let sidebarWidth: CGFloat = 215

    let model: AppModel

    /// Öffnet mit dem zuletzt gewählten Bereich (HIG `settings.md › Desktop`)
    @AppStorage("settingsPane") private var paneID = SettingsPane.appearance.rawValue
    @State private var query = ""

    private var pane: SettingsPane { SettingsPane(rawValue: paneID) ?? .appearance }

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(Self.sidebarWidth)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            SettingsDetail(pane: pane, model: model)
                .navigationTitle(pane.title)
        }
        .frame(width: Self.size.width, height: Self.size.height)
    }

    private var sidebar: some View {
        List(selection: selection) {
            ForEach(SettingsPane.Group.allCases, id: \.self) { group in
                let panes = group.panes.filter { $0.matches(query) }
                if !panes.isEmpty {
                    Section {
                        ForEach(panes) { pane in
                            Label {
                                Text(pane.title)
                            } icon: {
                                SettingsIcon(pane: pane, size: SettingsIcon.sidebarSize)
                            }
                            .tag(pane)
                        }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .searchable(text: $query, placement: .sidebar, prompt: "Suchen")
        .overlay {
            if !SettingsPane.allCases.contains(where: { $0.matches(query) }) {
                Text("Keine Treffer").foregroundStyle(.secondary)
            }
        }
    }

    private var selection: Binding<SettingsPane?> {
        Binding(get: { pane }, set: { if let pane = $0 { paneID = pane.rawValue } })
    }
}

/// Die Bereiche der Einstellungen, mit Symbol, Farbe, Beschreibung und Suchbegriffen
enum SettingsPane: String, CaseIterable, Identifiable {
    case appearance
    case editor
    case spelling
    case writing
    case build
    case pdf

    enum Group: CaseIterable {
        case text
        case output

        var panes: [SettingsPane] {
            switch self {
            case .text: [.appearance, .editor, .spelling, .writing]
            case .output: [.build, .pdf]
            }
        }
    }

    var id: String { rawValue }

    var title: String {
        switch self {
        case .appearance: "Darstellung"
        case .editor: "Editor"
        case .spelling: "Rechtschreibung"
        case .writing: "Schreibhilfen"
        case .build: "Kompilieren"
        case .pdf: "PDF"
        }
    }

    var symbol: String {
        switch self {
        case .appearance: "paintbrush.fill"
        case .editor: "character.cursor.ibeam"
        case .spelling: "textformat.abc.dottedunderline"
        case .writing: "wand.and.stars"
        case .build: "hammer.fill"
        case .pdf: "doc.richtext.fill"
        }
    }

    var tint: Color {
        switch self {
        case .appearance: .blue
        case .editor: .gray
        case .spelling: .purple
        case .writing: .orange
        case .build: .indigo
        case .pdf: .red
        }
    }

    var summary: String {
        switch self {
        case .appearance: "Farbschema, Schrift und Zeilenabstand des Editors sowie Zeilennummern und aktuelle Zeile."
        case .editor: "Zeilenumbruch, Einrückung und Breite von Tabulatoren."
        case .spelling: "Rechtschreibprüfung und Sprache. Fachwörter aus Mathematik, Informatik und Physik gelten als bekannt."
        case .writing: "Vervollständigung, Klammern, Groß- und Kleinschreibung und Hinweise zur Typografie."
        case .build: "Wann kompiliert und gespeichert wird."
        case .pdf: "Wie das PDF dem Text folgt."
        }
    }

    /// Bezeichnungen der Einstellungen im Bereich: Die Suche findet auch sie, nicht nur den Titel
    private var keywords: [String] {
        switch self {
        case .appearance: ["Farbschema", "Schema", "Schriftart", "Schriftgröße", "Zeilenabstand", "Zeilennummern", "Aktuelle Zeile", "Farben", "Theme"]
        case .editor: ["Zeilen umbrechen", "Umbruch", "Einrückung", "Tabulator", "Leerzeichen", "Tabbreite"]
        case .spelling: ["Rechtschreibung prüfen", "Sprache", "Deutsch", "Englisch", "Österreich", "Fachwörter", "Wörterbuch"]
        case .writing: ["Vervollständigen", "Autovervollständigung", "Klammern", "Groß", "Kleinschreibung", "Autokorrektur", "Schreibhinweise", "Typografie"]
        case .build: ["Kompilieren", "Speichern", "Beim Verlassen", "latexmk", "MacTeX"]
        case .pdf: ["PDF folgt Cursor", "Folgen", "SyncTeX"]
        }
    }

    func matches(_ query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return true }
        return ([title] + keywords).contains { $0.localizedCaseInsensitiveContains(trimmed) }
    }
}

/// Weißes Symbol auf einem farbigen, abgerundeten Quadrat wie in den Systemeinstellungen
struct SettingsIcon: View {
    static let sidebarSize: CGFloat = 22
    static let headerSize: CGFloat = 64
    private static let cornerRatio: CGFloat = 0.225
    private static let symbolRatio: CGFloat = 0.55

    let pane: SettingsPane
    let size: CGFloat

    var body: some View {
        Image(systemName: pane.symbol)
            .font(.system(size: size * Self.symbolRatio, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * Self.cornerRatio, style: .continuous)
                    .fill(pane.tint.gradient)
            )
            .accessibilityHidden(true)
    }
}

/// Rechte Seite: Kopfkarte und die Einstellungen des Bereichs als gruppiertes Formular
struct SettingsDetail: View {
    let pane: SettingsPane
    let model: AppModel

    var body: some View {
        Form {
            Section {
                VStack(spacing: 8) {
                    SettingsIcon(pane: pane, size: SettingsIcon.headerSize)
                    Text(pane.title).font(.title.weight(.bold))
                    Text(pane.summary)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            content
        }
        .formStyle(.grouped)
        .id(pane)
    }

    @ViewBuilder
    private var content: some View {
        switch pane {
        case .appearance: AppearanceSettings()
        case .editor: EditorBehaviorSettings()
        case .spelling: SpellingSettings()
        case .writing: WritingSettings()
        case .build: BuildSettings(model: model)
        case .pdf: PDFSettings(model: model)
        }
    }
}
