import AppKit
import SwiftUI
import Testing
@testable import LatexEditor

@Suite("Zoom der Oberfläche")
@MainActor
struct InterfaceZoomTests {
    @Test("Stufen: nächste Stufe, an den Enden bleibt es, Zwischenwerte rasten ein")
    func steps() {
        #expect(InterfaceZoom.step(from: 1, by: 1) == 1.15)
        #expect(InterfaceZoom.step(from: 1, by: -1) == 0.85)
        #expect(InterfaceZoom.step(from: 0.85, by: -1) == 0.85)
        #expect(InterfaceZoom.step(from: 2, by: 1) == 2)
        #expect(InterfaceZoom.nearestStep(to: 1.4) == 1.3)
        #expect(InterfaceZoom.nearestStep(to: 9) == 2)
        #expect(EditorAppearance.fontSize(for: 0.85) == 11)
        #expect(EditorAppearance.fontSize(for: 1.15) == 15)
    }

    @Test("Frühere Editorschrift wird einmalig als Zoomstufe übernommen")
    func migratesLegacyFontSize() throws {
        let defaults = temporaryDefaults()
        defaults.set(17.0, forKey: "editorFontSize")
        InterfaceZoom.migrateLegacySetting(defaults: defaults)
        #expect(defaults.double(forKey: InterfaceZoom.key) == 1.3, "17 pt ≈ 13 pt × 130 %")
        #expect(defaults.object(forKey: "editorFontSize") == nil)

        defaults.set(26.0, forKey: "editorFontSize")
        InterfaceZoom.migrateLegacySetting(defaults: defaults)
        #expect(defaults.double(forKey: InterfaceZoom.key) == 1.3, "Ein schon gesetzter Zoom bleibt")
    }

    @Test("Schrift, leerer Zustand und Tab-Leiste werden bei 150 % größer gezeichnet")
    func viewsGrow() {
        func size(_ view: some View, scale: CGFloat) -> NSSize {
            NSHostingView(rootView: view.environment(\.interfaceScale, scale)).fittingSize
        }
        let text = Text("Einleitung").scaledFont(.callout)
        #expect(size(text, scale: 1.5).height > size(text, scale: 1).height * 1.3)
        let empty = EmptyStateView("Keine Treffer", systemImage: "magnifyingglass", description: "Nichts passt.")
        #expect(size(empty, scale: 1.5).height > size(empty, scale: 1).height * 1.3)
        let tabBar = TabBar(model: AppModel.shared)
        #expect(size(tabBar, scale: 1.5).height == size(tabBar, scale: 1).height * 1.5)
    }
}
