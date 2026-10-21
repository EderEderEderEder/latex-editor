import SwiftUI

/// Editor | PDF nebeneinander mit verschiebbarem Teiler. Eigener Teiler statt `HSplitView`: Dessen Greiffläche ist nur
/// ein bis zwei Punkte breit und lässt sich nicht vergrößern. Hier ist sie eine eigene Spalte (`grabWidth`) zwischen den
/// Seiten mit einer dünnen Linie in der Mitte. **Nicht als Überlagerung über Editor/PDF**: Deren AppKit-Ansichten
/// (NSTextView, PDFView) fangen die Mausklicks vor SwiftUI ab, übrig blieb dann kaum ein Punkt.
struct WorkspaceSplit<Leading: View, Trailing: View>: View {
    static var grabWidth: CGFloat { 14 }
    /// Anteil der linken Seite beim Öffnen (wie bisher etwa halb-halb)
    static var initialFraction: Double { 0.5 }

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
            HStack(spacing: 0) {
                leading.frame(width: leadingWidth)
                handle(width: grab, available: available, leadingWidth: leadingWidth)
                trailing.frame(maxWidth: .infinity)
            }
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
