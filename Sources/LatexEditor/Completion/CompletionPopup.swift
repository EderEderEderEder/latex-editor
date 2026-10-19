import AppKit
import SwiftUI

/// Einstellung „Automatisch vervollständigen“ (Menü Bearbeiten).
enum CompletionSettings {
    static let automaticKey = "autoComplete"

    static var isAutomatic: Bool {
        UserDefaults.standard.object(forKey: automaticKey) as? Bool ?? true
    }
}

/// Inhalt der Liste; der Editor steuert die Auswahl über die Tastatur.
@MainActor
@Observable
final class CompletionListModel {
    var items: [CompletionItem] = []
    var selectedIndex = 0
    @ObservationIgnored var onChoose: ((Int) -> Void)?
}

/// Fenster für die Liste: wird nie Key-Window, damit der Editor den Fokus und die Tastatur behält.
final class CompletionPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    init(model: CompletionListModel) {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isFloatingPanel = true
        level = .popUpMenu
        hasShadow = true
        backgroundColor = .clear
        isOpaque = false
        hidesOnDeactivate = true
        contentView = NSHostingView(rootView: CompletionListView(model: model).interfaceZoomRoot())
    }
}

struct CompletionListView: View {
    static let rowHeight: CGFloat = 22
    static let padding: CGFloat = 4
    private static let cornerRadius: CGFloat = 8

    let model: CompletionListModel
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    // Nur eine Identität pro Zeile (ihre Position, die auch `scrollTo` benutzt). Ein zusätzliches
                    // `.id(index)` zur ID des Vorschlags ließ SwiftUI Zeilen verwechseln (Reste früherer Treffer).
                    ForEach(Array(model.items.enumerated()), id: \.offset) { index, item in
                        CompletionRow(item: item, isSelected: index == model.selectedIndex)
                            .contentShape(Rectangle())
                            .onTapGesture { model.onChoose?(index) }
                    }
                }
                .padding(Self.padding * scale)
            }
            .scrollIndicators(.never)
            .onChange(of: model.selectedIndex) { _, index in proxy.scrollTo(index) }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Self.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Self.cornerRadius).strokeBorder(.separator))
    }
}

private struct CompletionRow: View {
    private static let iconWidth: CGFloat = 16
    private static let detailMaximumWidth: CGFloat = 190

    private static let iconSize: CGFloat = 11

    let item: CompletionItem
    let isSelected: Bool
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .scaledFont(size: Self.iconSize)
                .foregroundStyle(isSelected ? .white : color)
                .frame(width: Self.iconWidth * scale)
            Text(title)
                .scaledFont(.callout, design: .monospaced)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            if !item.detail.isEmpty {
                Text(item.detail)
                    .scaledFont(.caption)
                    .foregroundStyle(isSelected ? AnyShapeStyle(.white.opacity(0.85)) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: Self.detailMaximumWidth * scale, alignment: .trailing)
            }
        }
        .foregroundStyle(isSelected ? .white : .primary)
        .padding(.horizontal, 6)
        .frame(height: CompletionListView.rowHeight * scale)
        .background(RoundedRectangle(cornerRadius: 4).fill(isSelected ? Color.accentColor : .clear))
    }

    /// Befehle mit `\` und Gerüst, damit Varianten wie `\cite{…}` und `\cite[…]{…}` unterscheidbar sind.
    private var title: String {
        guard item.kind == .command else { return item.text }
        return "\\" + item.insertion.replacingOccurrences(of: "{}", with: "{…}").replacingOccurrences(of: "[]", with: "[…]")
    }

    private var symbol: String {
        switch item.kind {
        case .command: "chevron.left.forwardslash.chevron.right"
        case .environment: "square.stack.3d.up"
        case .label: "tag"
        case .citation: "books.vertical"
        case .image: "photo"
        case .file: "doc.text"
        case .option: "slider.horizontal.3"
        }
    }

    private var color: Color {
        switch item.kind {
        case .command: .blue
        case .environment: .purple
        case .label: .orange
        case .citation: .brown
        case .image: .green
        case .file: .secondary
        case .option: .teal
        }
    }
}
