import AppKit
import SwiftUI

/// Zoom von Oberfläche und Editor (⌘+ / ⌘− / ⌥⌘0, Menü Darstellung), gemerkt in den Einstellungen.
/// macOS skaliert SwiftUI-Schriften nicht selbst (`dynamicTypeSize` wirkt dort nicht), deshalb rechnen die
/// Views des Hauptfensters Schriften und Maße mit `interfaceScale` um. Dialoge bleiben in Systemgröße.
enum InterfaceZoom {
    static let key = "interfaceZoom"
    static let steps: [Double] = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2]
    static let standard = 1.0
    /// Frühere Einstellung (nur die Editorschrift in Punkt)
    private static let legacyFontSizeKey = "editorFontSize"

    static var current: Double {
        (UserDefaults.standard.object(forKey: key) as? Double).map(nearestStep(to:)) ?? standard
    }

    static func zoomIn() { set(step(from: current, by: 1)) }
    static func zoomOut() { set(step(from: current, by: -1)) }
    static func reset() { set(standard) }

    static func set(_ factor: Double) {
        let value = nearestStep(to: factor)
        guard value != current else { return }
        UserDefaults.standard.set(value, forKey: key)
        NotificationCenter.default.post(name: EditorAppearance.fontDidChange, object: nil)
    }

    /// Übernimmt eine früher eingestellte Editorschrift als nächstgelegene Zoomstufe (einmalig beim Start).
    static func migrateLegacySetting(defaults: UserDefaults = .standard) {
        guard let legacy = defaults.object(forKey: legacyFontSizeKey) as? Double else { return }
        defaults.removeObject(forKey: legacyFontSizeKey)
        guard defaults.object(forKey: key) == nil else { return }
        defaults.set(nearestStep(to: legacy / Double(EditorAppearance.defaultFontSize)), forKey: key)
    }

    /// Nächste Stufe in die Richtung von `offset`; an den Enden bleibt es bei der äußersten.
    static func step(from factor: Double, by offset: Int) -> Double {
        let index = steps.firstIndex(of: nearestStep(to: factor)) ?? 0
        return steps[min(max(index + offset, 0), steps.count - 1)]
    }

    static func nearestStep(to factor: Double) -> Double {
        steps.min { abs($0 - factor) < abs($1 - factor) } ?? standard
    }

    /// Systemgröße einer Textart in Punkt (z. B. `.callout` = 12 pt unter macOS)
    static func pointSize(of style: Font.TextStyle) -> CGFloat {
        let systemStyle: NSFont.TextStyle = switch style {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
        return NSFont.preferredFont(forTextStyle: systemStyle).pointSize
    }
}

/// Ohne `@Entry`: Das Makro-Plugin fehlt bei reinen Command Line Tools.
private struct InterfaceScaleKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1
}

extension EnvironmentValues {
    /// Zoomfaktor der Oberfläche (1 = Systemgröße), gesetzt von `interfaceZoomRoot()`
    var interfaceScale: CGFloat {
        get { self[InterfaceScaleKey.self] }
        set { self[InterfaceScaleKey.self] = newValue }
    }
}

extension View {
    /// An der Wurzel eines Fensters (Hauptfenster, Vervollständigung): liest den Zoom und gibt ihn weiter.
    func interfaceZoomRoot() -> some View {
        modifier(InterfaceZoomRoot())
    }

    /// Wie `.font(.callout)`, aber mal Zoom
    func scaledFont(_ style: Font.TextStyle, weight: Font.Weight? = nil, design: Font.Design = .default) -> some View {
        let defaultWeight: Font.Weight = style == .headline ? .bold : .regular
        return modifier(ScaledFont(size: InterfaceZoom.pointSize(of: style), weight: weight ?? defaultWeight, design: design))
    }

    /// Feste Punktgröße mal Zoom (z. B. Symbole)
    func scaledFont(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: design))
    }
}

private struct InterfaceZoomRoot: ViewModifier {
    @AppStorage(InterfaceZoom.key) private var factor = InterfaceZoom.standard

    func body(content: Content) -> some View {
        content.environment(\.interfaceScale, CGFloat(InterfaceZoom.nearestStep(to: factor)))
    }
}

private struct ScaledFont: ViewModifier {
    @Environment(\.interfaceScale) private var scale
    let size: CGFloat
    let weight: Font.Weight
    let design: Font.Design

    func body(content: Content) -> some View {
        content.font(.system(size: size * scale, weight: weight, design: design))
    }
}

/// Leerer Zustand wie `ContentUnavailableView`, dessen Schriften sich nicht anpassen lassen, aber mit Zoom.
struct EmptyStateView<Actions: View>: View {
    private static var symbolSize: CGFloat { 34 }
    private static var spacing: CGFloat { 8 }
    private static var padding: CGFloat { 16 }

    @Environment(\.interfaceScale) private var scale
    let title: String
    let systemImage: String
    let description: String?
    let actions: Actions

    init(_ title: String, systemImage: String, description: String? = nil, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.systemImage = systemImage
        self.description = description
        self.actions = actions()
    }

    var body: some View {
        VStack(spacing: Self.spacing * scale) {
            Image(systemName: systemImage)
                .scaledFont(size: Self.symbolSize)
                .foregroundStyle(.secondary)
            Text(title)
                .scaledFont(.title3, weight: .semibold)
            if let description {
                Text(description)
                    .scaledFont(.callout)
                    .foregroundStyle(.secondary)
            }
            actions
        }
        .multilineTextAlignment(.center)
        .padding(Self.padding * scale)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension EmptyStateView where Actions == EmptyView {
    init(_ title: String, systemImage: String, description: String? = nil) {
        self.init(title, systemImage: systemImage, description: description) { EmptyView() }
    }
}
