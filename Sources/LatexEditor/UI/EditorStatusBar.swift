import SwiftUI

/// Schmale Leiste unter dem Editor: Zeile und Spalte, Wörter der Auswahl, der Datei und des Projekts.
struct EditorStatusBar: View {
    private static let height: CGFloat = 22
    private static let spacing: CGFloat = 16
    private static let locale = Locale(identifier: "de_DE")

    let editor: EditorStore
    let counts: WordCountStore
    let session: DocumentSession

    @Environment(\.interfaceScale) private var scale

    private var cursor: CursorInfo? {
        editor.cursor.flatMap { $0.file == session.url ? $0 : nil }
    }

    var body: some View {
        HStack(spacing: Self.spacing) {
            Text(positionText)
                .help("Zeile und Spalte des Cursors (⌘L springt zu einer Zeile)")
            Spacer(minLength: 0)
            if let cursor, cursor.selectedWords > 0 {
                Text("\(Self.wordsText(cursor.selectedWords)) ausgewählt")
            }
            if let words = counts.words(inOpenFile: session.url) {
                Text(Self.wordsText(words))
                    .help("Wörter dieser Datei. Näherung: Fließtext ohne Befehle, Formeln, Kommentare und Code.")
            }
            if let project = counts.projectWords {
                Text("Projekt: \(Self.formatted(project))")
                    .help("Wörter aller Dateien, die das Hauptdokument einbindet (ungespeicherter Text eingerechnet)")
            }
        }
        .monospacedDigit()
        .lineLimit(1)
        .scaledFont(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 10)
        .frame(height: Self.height * scale)
        .background(.bar)
    }

    private var positionText: String { Self.positionText(for: cursor) }

    static func positionText(for cursor: CursorInfo?) -> String {
        guard let cursor else { return "Zeile – · Spalte –" }
        return "Zeile \(cursor.line) · Spalte \(cursor.column)"
    }

    static func wordsText(_ count: Int) -> String {
        count == 1 ? "1 Wort" : "\(formatted(count)) Wörter"
    }

    static func formatted(_ count: Int) -> String {
        count.formatted(.number.locale(locale))
    }
}
