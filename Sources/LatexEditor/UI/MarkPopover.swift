import AppKit
import Observation
import SwiftUI

struct MarkPopoverActions {
    let recolor: (MarkColor) -> Void
    let setComment: (String) -> Void
    let remove: () -> Void
}

/// Der Text im Kommentarfeld; erst beim Schließen des Popovers wird er übernommen (ein Rückgängig-Schritt, nicht einer je Buchstabe)
@MainActor
@Observable
final class MarkDraft {
    var text: String

    init(text: String) {
        self.text = text
    }
}

/// Popover an einer Markierung: Farbe, Kommentar, Entfernen
struct MarkPopoverView: View {
    private static let width: CGFloat = 290
    private static let editorHeight: CGFloat = 76
    private static let swatchSize: CGFloat = 18
    private static let excerptLength = 90

    let store: MarkStore
    let id: UUID
    let draft: MarkDraft
    let actions: MarkPopoverActions
    let close: () -> Void
    @FocusState private var isEditing: Bool

    var body: some View {
        if let mark = store.marks.first(where: { $0.id == id }) {
            VStack(alignment: .leading, spacing: 10) {
                Text(title(of: mark)).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                editor
                HStack(spacing: 8) {
                    ForEach(MarkColor.allCases, id: \.self) { color in swatch(color, isSelected: color == mark.color) }
                    Spacer()
                    Button("Markierung entfernen", systemImage: "trash") {
                        actions.remove()
                        close()
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help(mark.kind == .note ? "Notiz entfernen" : "Markierung entfernen")
                }
            }
            .padding(12)
            .frame(width: Self.width)
            .onAppear { isEditing = true }
        }
    }

    private func title(of mark: PDFMark) -> String {
        let page = "Seite \(mark.pageHint)"
        guard mark.kind == .highlight else { return "Notiz · \(page)" }
        let excerpt = mark.text.replacingOccurrences(of: "\n", with: " ")
        return excerpt.count > Self.excerptLength ? "„\(excerpt.prefix(Self.excerptLength))…“" : "„\(excerpt)“"
    }

    private var editor: some View {
        TextEditor(text: Binding(get: { draft.text }, set: { draft.text = $0 }))
            .font(.body)
            .focused($isEditing)
            .scrollContentBackground(.hidden)
            .padding(4)
            .frame(height: Self.editorHeight)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
            .overlay(alignment: .topLeading) {
                if draft.text.isEmpty {
                    Text("Kommentar").foregroundStyle(.tertiary).padding(.horizontal, 9).padding(.vertical, 12).allowsHitTesting(false)
                }
            }
            .accessibilityLabel("Kommentar")
    }

    private func swatch(_ color: MarkColor, isSelected: Bool) -> some View {
        Button { actions.recolor(color) } label: {
            Circle()
                .fill(Color(nsColor: color.baseColor))
                .frame(width: Self.swatchSize, height: Self.swatchSize)
                .overlay { if isSelected { Image(systemName: "checkmark").font(.caption2.bold()).foregroundStyle(.black.opacity(0.7)) } }
        }
        .buttonStyle(.plain)
        .help(color.title)
        .accessibilityLabel(color.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Zeigt das Popover einer Markierung (nur eines zugleich). Beim Schließen wird der Kommentar übernommen.
@MainActor
final class MarkPopoverPresenter: NSObject, NSPopoverDelegate {
    private var popover: NSPopover?
    private(set) var draft: MarkDraft?
    private var commit: ((String) -> Void)?
    private(set) var shownID: UUID?

    func present(markID: UUID, store: MarkStore, from view: NSView, at rect: NSRect, actions: MarkPopoverActions) {
        guard let mark = store.marks.first(where: { $0.id == markID }) else { return }
        if shownID == markID { return }
        close()
        let draft = MarkDraft(text: mark.comment)
        let popover = NSPopover()
        popover.behavior = .transient
        popover.delegate = self
        popover.contentViewController = NSHostingController(rootView: MarkPopoverView(
            store: store, id: markID, draft: draft, actions: actions, close: { [weak self] in self?.close() }
        ))
        self.popover = popover
        self.draft = draft
        commit = actions.setComment
        shownID = markID
        popover.show(relativeTo: rect, of: view, preferredEdge: .maxX)
    }

    func close() {
        popover?.close()
        finish()
    }

    func popoverDidClose(_ notification: Notification) {
        finish()
    }

    /// Kommentar übernehmen und aufräumen (kann zweimal kommen: `close()` und das Delegate)
    private func finish() {
        let text = draft?.text
        let commit = commit
        popover = nil
        draft = nil
        self.commit = nil
        shownID = nil
        if let text { commit?(text) }
    }
}
