import SwiftUI

/// Popover der unteren PDF-Leiste: alle Markierungen und Notizen, nicht zugeordnete zuerst
struct MarkListView: View {
    private static let width: CGFloat = 380
    private static let maximumHeight: CGFloat = 420
    private static let rowHeight: CGFloat = 40

    let store: MarkStore
    let pdf: PDFPreviewStore
    let reveal: (UUID) -> Void
    let edit: (UUID) -> Void
    let remove: (UUID) -> Void
    let reassign: (UUID) -> Void

    private var sections: [MarkListSection] {
        MarkListGrouping.sections(marks: store.marks, resolutions: store.resolutions)
    }

    var body: some View {
        Group {
            if store.marks.isEmpty {
                Text("Noch keine Markierungen. Wähle Text im PDF aus und markiere ihn über Bearbeiten › PDF-Markierung oder den Rechtsklick.")
                    .font(.callout).foregroundStyle(.secondary)
                    .padding(14)
            } else {
                List {
                    ForEach(sections) { section in
                        Section(section.title) {
                            ForEach(section.marks) { mark in row(mark, in: section.kind) }
                        }
                    }
                }
                .listStyle(.plain)
                .frame(height: min(Self.maximumHeight, CGFloat(store.marks.count + sections.count) * Self.rowHeight))
            }
        }
        .frame(width: Self.width)
    }

    private func row(_ mark: PDFMark, in kind: MarkListSection.Kind) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Button { reveal(mark.id) } label: {
                HStack(alignment: .top, spacing: 8) {
                    Circle().fill(Color(nsColor: mark.color.baseColor)).frame(width: 10, height: 10).padding(.top, 5)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title(of: mark)).lineLimit(1).truncationMode(.tail)
                        if !mark.comment.isEmpty {
                            Text(mark.comment).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if kind == .unplaced { unplacedActions(mark) }
        }
        .contextMenu {
            Button("Kommentar bearbeiten …") { edit(mark.id) }.disabled(kind == .unplaced)
            Button("Entfernen") { remove(mark.id) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(mark.color.title), \(title(of: mark))\(mark.comment.isEmpty ? "" : ", Kommentar: \(mark.comment)")")
    }

    private func title(of mark: PDFMark) -> String {
        mark.kind == .note ? "Notiz" : mark.text.replacingOccurrences(of: "\n", with: " ")
    }

    @ViewBuilder
    private func unplacedActions(_ mark: PDFMark) -> some View {
        HStack(spacing: 6) {
            if mark.kind == .highlight {
                Button("Neu zuordnen") { reassign(mark.id) }
                    .disabled(pdf.selectionSegments.isEmpty)
                    .help(pdf.selectionSegments.isEmpty
                          ? "Wähle zuerst im PDF die Textstelle aus, auf die die Markierung jetzt gehört"
                          : "Auf die im PDF ausgewählte Textstelle setzen")
            }
            Button("Entfernen") { remove(mark.id) }
        }
        .controlSize(.small)
    }
}
