import SwiftUI

/// Editor | PDF nebeneinander mit verschiebbarem Teiler. Eigener Teiler statt `HSplitView`: Dessen Greiffläche ist nur
/// ein bis zwei Punkte breit und lässt sich nicht vergrößern. Hier ist sie eine eigene Spalte (`grabWidth`) zwischen den
/// Seiten mit einer dünnen Linie in der Mitte. **Nicht als Überlagerung über Editor/PDF**: Deren AppKit-Ansichten
/// (NSTextView, PDFView) fangen die Mausklicks vor SwiftUI ab, übrig blieb dann kaum ein Punkt.
///
/// **Auch „Nur Editor“ und „Nur PDF“ laufen hierüber**: Beide Seiten bleiben immer im Baum, die nicht gezeigte wird mit
/// ihrer letzten Breite aus dem sichtbaren Bereich geschoben und ausgeblendet. Vorher entstanden Editor und PDF beim
/// Wechsel der Ansicht neu – SwiftUI legt dabei die neue Ansicht an, bevor es die alte abbaut (gemessen) –, und das PDF
/// begann wieder auf Seite 1. So bleiben Seite, Zoom, Scrollposition und Auswahl einfach erhalten.
struct WorkspaceSplit<Leading: View, Trailing: View>: View {
    /// Breiten und Verschiebung der Seiten für eine Ansicht (reine Rechnung, getestet)
    struct Layout: Equatable {
        var leadingWidth: CGFloat
        var trailingWidth: CGFloat
        var offset: CGFloat
        var showsLeading: Bool
        var showsTrailing: Bool
    }

    static var grabWidth: CGFloat { 14 }
    /// Anteil der linken Seite beim Öffnen (wie bisher etwa halb-halb)
    static var initialFraction: Double { 0.5 }

    let mode: ViewMode
    let leadingMinWidth: CGFloat
    let trailingMinWidth: CGFloat
    @ViewBuilder let leading: Leading
    @ViewBuilder let trailing: Trailing

    @State private var fraction = WorkspaceSplit.initialFraction
    @Environment(\.interfaceScale) private var scale

    var body: some View {
        GeometryReader { geometry in
            let grab = Self.grabWidth * scale
            let available = max(geometry.size.width - grab, 0)
            let leadingWidth = Self.leadingWidth(fraction: fraction, total: available, minimums: (leadingMinWidth, trailingMinWidth))
            let layout = Self.layout(mode: mode, total: geometry.size.width, grab: grab, splitLeading: leadingWidth)
            HStack(spacing: 0) {
                pane(leading, width: layout.leadingWidth, isShown: layout.showsLeading)
                pane(handle(width: grab, available: available, leadingWidth: leadingWidth), width: grab, isShown: mode == .split)
                pane(trailing, width: layout.trailingWidth, isShown: layout.showsTrailing)
            }
            .offset(x: layout.offset)
            .frame(width: geometry.size.width, alignment: .leading)
            .clipped()
        }
    }

    /// Ausgeblendet bleibt die Seite im Baum (keine neue NSTextView/PDFView). Deckkraft 0 wirkt nur auf SwiftUI-Teile;
    /// NSTextView und PDFView zeichneten weiter und fingen Klicks (die links verschobene lag unter der Seitenleiste),
    /// deshalb blenden sie sich über `isWorkspacePaneShown` selbst aus (`isHidden`).
    private func pane<Content: View>(_ content: Content, width: CGFloat, isShown: Bool) -> some View {
        content
            .frame(width: width)
            .opacity(isShown ? 1 : 0)
            .allowsHitTesting(isShown)
            .accessibilityHidden(!isShown)
            .environment(\.isWorkspacePaneShown, isShown)
    }

    /// Geteilt: beide nebeneinander. Nur Editor: der Editor über die ganze Breite, das PDF behält seine Breite rechts
    /// außerhalb. Nur PDF: alles um Editor und Teiler nach links verschoben, das PDF über die ganze Breite.
    static func layout(mode: ViewMode, total: CGFloat, grab: CGFloat, splitLeading: CGFloat) -> Layout {
        let splitTrailing = max(total - grab - splitLeading, 0)
        switch mode {
        case .split:
            return Layout(leadingWidth: splitLeading, trailingWidth: splitTrailing, offset: 0, showsLeading: true, showsTrailing: true)
        case .editorOnly:
            return Layout(leadingWidth: total, trailingWidth: splitTrailing, offset: 0, showsLeading: true, showsTrailing: false)
        case .pdfOnly:
            return Layout(leadingWidth: splitLeading, trailingWidth: total, offset: -(splitLeading + grab), showsLeading: false, showsTrailing: true)
        }
    }

    private func handle(width: CGFloat, available: CGFloat, leadingWidth: CGFloat) -> some View {
        Color(nsColor: .windowBackgroundColor)
            .frame(width: width)
            .overlay { Divider() }
            .contentShape(Rectangle())
            .pointerStyle(.columnResize)
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { value in
                        guard available > 0 else { return }
                        if dragStart == nil { dragStart = leadingWidth }
                        fraction = Double(((dragStart ?? leadingWidth) + value.translation.width) / available)
                    }
                    .onEnded { _ in dragStart = nil }
            )
            .accessibilityLabel("Teiler zwischen Editor und PDF")
    }

    @State private var dragStart: CGFloat?

    /// Breite der linken Seite; beide Seiten behalten ihre Mindestbreite, solange der Platz reicht (sonst halb-halb).
    static func leadingWidth(fraction: Double, total: CGFloat, minimums: (leading: CGFloat, trailing: CGFloat)) -> CGFloat {
        guard total > minimums.leading + minimums.trailing else { return (total / 2).rounded() }
        let wanted = CGFloat(fraction) * total
        return min(max(wanted, minimums.leading), total - minimums.trailing).rounded()
    }
}

private struct WorkspacePaneShownKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// `false` in der Seite, die „Nur Editor“ bzw. „Nur PDF“ gerade verbirgt (AppKit-Ansichten setzen dann `isHidden`)
    var isWorkspacePaneShown: Bool {
        get { self[WorkspacePaneShownKey.self] }
        set { self[WorkspacePaneShownKey.self] = newValue }
    }
}
