import SwiftUI

struct PDFPane: View {
    let model: AppModel

    private var store: PDFPreviewStore { model.pdf }

    var body: some View {
        VStack(spacing: 0) {
            if let url = store.pdfURL {
                PDFKitView(store: store, url: url, reloadToken: store.reloadToken)
            } else {
                EmptyStateView(
                    "Kein PDF vorhanden",
                    systemImage: "doc.richtext",
                    description: missingHint
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            PDFStatusBar(model: model)
        }
    }

    private var missingHint: String {
        guard let expected = store.expectedURL else { return "Es ist keine Hauptdatei bekannt." }
        return "\(expected.lastPathComponent) erscheint hier, sobald die Hauptdatei kompiliert wurde."
    }
}

private struct PDFStatusBar: View {
    private static let separatorHeight: CGFloat = 14

    let model: AppModel
    @Environment(\.interfaceScale) private var scale

    private var store: PDFPreviewStore { model.pdf }
    private var synctex: SyncTeXStore { model.synctex }

    var body: some View {
        HStack(spacing: 4) {
            Button("Verkleinern", systemImage: "minus.magnifyingglass", action: store.zoomOut)
            Text("\(store.zoomPercent) %")
                .monospacedDigit()
                .frame(minWidth: 44)
            Button("Vergrößern", systemImage: "plus.magnifyingglass", action: store.zoomIn)
            // Mit kurzem Text: ↔ und der Pfeil allein ließen sich als „Teilen“/„Senden“ missverstehen
            Button("Breite", systemImage: "arrow.left.and.right", action: store.zoomToFitWidth)
                .labelStyle(.titleAndIcon)
                .help("An die Breite anpassen")
            Divider().frame(height: Self.separatorHeight * scale)
            Toggle("Folgen", systemImage: "location", isOn: followCursor)
                .labelStyle(.titleAndIcon)
                .toggleStyle(.button)
                .symbolVariant(synctex.followCursor ? .fill : .none)
                .foregroundStyle(synctex.followCursor ? Color.accentColor : .secondary)
                .help("PDF folgt Cursor: Das PDF scrollt zur Stelle, an der du schreibst. ⌘J springt einmalig, ⌘-Klick ins PDF springt in den Text.")
            Divider().frame(height: Self.separatorHeight * scale)
            marksButton
            Spacer()
            Text(pageLabel)
                .monospacedDigit()
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .bottomBarStyle(scale: scale)
        .disabled(store.pdfURL == nil)
    }

    /// „Markierungen“ mit Anzahl; ein Warnsymbol, solange Markierungen nicht zugeordnet sind
    private var marksButton: some View {
        let unplaced = model.marks.resolutions.values.filter { $0 == .orphaned }.count
        return Button { store.isMarkListShown.toggle() } label: {
            Label("Markierungen", systemImage: unplaced > 0 ? "exclamationmark.triangle.fill" : "highlighter")
            if !model.marks.marks.isEmpty { Text("\(model.marks.marks.count)").monospacedDigit() }
        }
        .labelStyle(.titleAndIcon)
        .foregroundStyle(unplaced > 0 ? Color.orange : .secondary)
        .help(unplaced > 0 ? "\(unplaced) Markierung(en) lassen sich keiner Stelle im Text mehr zuordnen" : "Markierungen und Notizen im PDF")
        .popover(isPresented: Binding(get: { store.isMarkListShown }, set: { store.isMarkListShown = $0 }), arrowEdge: .top) {
            MarkListView(
                store: model.marks, pdf: store,
                reveal: { model.revealMark($0) }, edit: { id in
                    store.isMarkListShown = false
                    model.revealMark(id)
                    model.showMarkPopover(id)
                },
                remove: { model.removeMarks([$0]) },
                reassign: { id in Task { await model.reassignMark(id) } }
            )
        }
    }

    private var followCursor: Binding<Bool> {
        Binding(get: { synctex.followCursor }, set: { synctex.followCursor = $0 })
    }

    private var pageLabel: String {
        store.pageCount > 0 ? "Seite \(store.currentPage) von \(store.pageCount)" : ""
    }
}
