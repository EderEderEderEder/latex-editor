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
    private static let activeBackgroundOpacity = 0.3
    private static let activeCornerRadius: CGFloat = 5

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
            markingControl
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

    /// Stift mit kleinem Pfeil: Knopf schaltet den Markierungsmodus, das Menü wählt die Farbe
    private var markingControl: some View {
        let color = model.marks.lastColor
        let isOn = store.isMarkingMode
        return Menu {
            ForEach(MarkColor.allCases, id: \.self) { choice in
                Toggle(isOn: Binding(get: { choice == color }, set: { _ in model.chooseMarkColor(choice) })) {
                    Label { Text(choice.title) } icon: { Image(nsImage: choice.swatch) }
                }
            }
        } label: {
            Label("Markierungsmodus", systemImage: "highlighter")
        } primaryAction: {
            model.toggleMarkingMode()
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        // Außen statt im Label: Das Label eines Menüs übernimmt Farbe und Variante nicht. Aktiv: Farbe der Markierung,
        // gefülltes Symbol und getönter Grund (nicht nur die Farbe zeigt es an).
        .symbolVariant(isOn ? .fill : .none)
        .foregroundStyle(isOn ? Color(nsColor: color.iconColor) : .secondary)
        .padding(.horizontal, 3)
        .background(isOn ? Color(nsColor: color.baseColor).opacity(Self.activeBackgroundOpacity) : .clear, in: RoundedRectangle(cornerRadius: Self.activeCornerRadius))
        .help(isOn
              ? "Markierungsmodus ist an (\(color.title)): Ausgewählter Text wird sofort markiert. Klicken beendet ihn, der Pfeil wählt die Farbe."
              : "Markierungsmodus: Danach wird ausgewählter Text sofort markiert. Der Pfeil wählt die Farbe.")
        .accessibilityLabel("Markierungsmodus")
        .accessibilityValue(isOn ? "Ein, \(color.title)" : "Aus")
        .disabled(store.pdfURL == nil)
    }

    /// „Markierungen“ mit Anzahl; ein Warnsymbol, solange Markierungen nicht zugeordnet sind
    private var marksButton: some View {
        let unplaced = model.marks.resolutions.values.filter { $0 == .orphaned }.count
        return Button { store.isMarkListShown.toggle() } label: {
            Label("Markierungen", systemImage: unplaced > 0 ? "exclamationmark.triangle.fill" : "list.bullet.rectangle")
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
                reassign: { id in Task { await model.reassignMark(id) } },
                removeAll: { model.removeAllMarks() }
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
