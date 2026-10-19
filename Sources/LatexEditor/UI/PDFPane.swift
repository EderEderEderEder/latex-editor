import SwiftUI

struct PDFPane: View {
    let store: PDFPreviewStore
    let synctex: SyncTeXStore

    var body: some View {
        VStack(spacing: 0) {
            if let url = store.pdfURL {
                PDFKitView(store: store, url: url, reloadToken: store.reloadToken)
            } else {
                ContentUnavailableView(
                    "Kein PDF vorhanden",
                    systemImage: "doc.richtext",
                    description: Text(missingHint)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            PDFStatusBar(store: store, synctex: synctex)
        }
    }

    private var missingHint: String {
        guard let expected = store.expectedURL else { return "Es ist keine Hauptdatei bekannt." }
        return "\(expected.lastPathComponent) erscheint hier, sobald die Hauptdatei kompiliert wurde."
    }
}

private struct PDFStatusBar: View {
    let store: PDFPreviewStore
    let synctex: SyncTeXStore

    var body: some View {
        HStack(spacing: 4) {
            Button("Verkleinern", systemImage: "minus.magnifyingglass", action: store.zoomOut)
            Text("\(store.zoomPercent) %")
                .monospacedDigit()
                .frame(minWidth: 44)
            Button("Vergrößern", systemImage: "plus.magnifyingglass", action: store.zoomIn)
            Button("Breite anpassen", systemImage: "arrow.left.and.right", action: store.zoomToFitWidth)
            Divider().frame(height: 14)
            Toggle("PDF folgt Cursor", systemImage: "location", isOn: followCursor)
                .toggleStyle(.button)
                .symbolVariant(synctex.followCursor ? .fill : .none)
                .foregroundStyle(synctex.followCursor ? Color.accentColor : .secondary)
                .help("PDF folgt Cursor: Das PDF scrollt zur Stelle, an der du schreibst. ⌘J springt einmalig, ⌘-Klick ins PDF springt in den Text.")
            Spacer()
            Text(pageLabel)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .font(.callout)
        .padding(.horizontal, 10)
        .frame(height: 28)
        .disabled(store.pdfURL == nil)
        .background(.bar)
    }

    private var followCursor: Binding<Bool> {
        Binding(get: { synctex.followCursor }, set: { synctex.followCursor = $0 })
    }

    private var pageLabel: String {
        store.pageCount > 0 ? "Seite \(store.currentPage) von \(store.pageCount)" : ""
    }
}
