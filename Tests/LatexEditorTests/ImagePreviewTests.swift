import AppKit
import PDFKit
import Testing
@testable import LatexEditor

@Suite("Bildvorschau")
struct ImagePreviewTests {
    private func writePNG(_ url: URL, width: Int, height: Int) throws {
        let bitmap = try #require(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ))
        try #require(bitmap.representation(using: .png, properties: [:])).write(to: url)
    }

    @Test("Raster: Maße und Größe stimmen, die Miniatur ist begrenzt")
    func raster() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try writePNG(project.url("gross.png"), width: 2000, height: 1000)
        let info = try #require(ImagePreviewLoader.load(project.url("gross.png"), maxPixels: 300))
        #expect(info.size == CGSize(width: 2000, height: 1000))
        #expect(info.sizeText == "2000 × 1000 px")
        #expect(!info.isVector)
        #expect(info.byteCount > 0)
        #expect(max(info.image.size.width, info.image.size.height) <= 300)
        #expect(info.image.size.width == 2 * info.image.size.height, "Seitenverhältnis bleibt")
    }

    @Test("PDF: erste Seite als Miniatur, Größe in Punkten")
    func pdf() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let document = PDFDocument()
        let image = NSImage(size: NSSize(width: 200, height: 100), flipped: false) { rect in
            NSColor.red.setFill()
            rect.fill()
            return true
        }
        document.insert(try #require(PDFPage(image: image)), at: 0)
        #expect(document.write(to: project.url("grafik.pdf")))
        let info = try #require(ImagePreviewLoader.load(project.url("grafik.pdf")))
        #expect(info.isVector)
        #expect(info.sizeText.hasSuffix("pt"))
        #expect(info.size.width == 200 && info.size.height == 100)
    }

    @Test("Unlesbar oder keine Datei: nil statt Absturz")
    func unreadable() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try project.write("kaputt.png", "kein Bild")
        #expect(ImagePreviewLoader.load(project.url("kaputt.png")) == nil)
        #expect(ImagePreviewLoader.load(project.url("fehlt.png")) == nil)
    }

    @Test("\\includegraphics-Pfad: relativ zu Basis und \\graphicspath, mit und ohne Endung")
    func resolver() {
        let base = URL(fileURLWithPath: "/p")
        let existing: Set<String> = ["/p/images/logo.png", "/p/bild.jpg", "/p/figs/ablauf.pdf", "/p/figs/ablauf.png"]
        let exists: (URL) -> Bool = { existing.contains($0.path) }
        func resolve(_ path: String) -> String? {
            GraphicsResolver.resolve(path, bases: [base], graphicsDirectories: ["images/", "figs/"], fileExists: exists)?.path
        }
        #expect(resolve("logo") == "/p/images/logo.png", "graphicspath, Endung ergänzt")
        #expect(resolve("logo.png") == "/p/images/logo.png")
        #expect(resolve("bild.jpg") == "/p/bild.jpg")
        #expect(resolve("ablauf") == "/p/figs/ablauf.pdf", "PDF vor PNG, wie LaTeX")
        #expect(resolve("figs/ablauf.png") == "/p/figs/ablauf.png")
        #expect(resolve("fehlt") == nil)
        #expect(resolve("  ") == nil)
    }

    @Test("Pfad an einer Textstelle erkennen; Kommentare und andere Befehle nicht")
    func pathAtLocation() {
        let text = "Vorher\n\\includegraphics[width=\\linewidth]{images/logo}\n% \\includegraphics{kommentar}\n\\input{kapitel}\n" as NSString
        let key = text.range(of: "images/logo")
        let hit = GraphicsResolver.path(at: key.location + 3, in: text)
        #expect(hit?.path == "images/logo")
        #expect(hit?.range == key)
        #expect(GraphicsResolver.path(at: key.location - 3, in: text) == nil, "auf dem Befehl, nicht auf dem Pfad")
        #expect(GraphicsResolver.path(at: text.range(of: "kommentar").location + 1, in: text) == nil)
        #expect(GraphicsResolver.path(at: text.range(of: "kapitel").location + 1, in: text) == nil)
        #expect(GraphicsResolver.path(at: 0, in: "" as NSString) == nil)
    }
}

@Suite("Bildvorschau im Text", .serialized)
@MainActor
struct ImageHoverTests {
    private func windowPoint(forCharacter index: Int, in harness: CompletionHarness) throws -> NSPoint {
        let layoutManager = try #require(harness.textView.layoutManager)
        let container = try #require(harness.textView.textContainer)
        layoutManager.ensureLayout(for: container)
        let glyph = layoutManager.glyphIndexForCharacter(at: index)
        let rect = layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container)
        let origin = harness.textView.textContainerOrigin
        return harness.textView.convert(NSPoint(x: rect.midX + origin.x, y: rect.midY + origin.y), to: nil)
    }

    private func move(_ harness: CompletionHarness, to point: NSPoint) throws {
        harness.textView.mouseMoved(with: try #require(NSEvent.mouseEvent(
            with: .mouseMoved, location: point, modifierFlags: [], timestamp: 0,
            windowNumber: harness.window.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0
        )))
    }

    /// Unter Last kommt die verzögerte Vorschau spät: warten, bis sie da ist (höchstens 5 s)
    private func waitForPreview(_ harness: CompletionHarness) async throws {
        for _ in 0..<250 where harness.textView.shownImagePreviewURL == nil { try await Task.sleep(for: .milliseconds(20)) }
    }

    @Test("Maus ruht auf dem Pfad: Vorschau; Maus daneben, Klick oder Tippen: weg")
    func hover() async throws {
        let text = "Text \\includegraphics[width=5cm]{images/logo} Ende"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        let logo = URL(fileURLWithPath: "/p/images/logo.png")
        harness.textView.imageResolver = { $0 == "images/logo" ? logo : nil }
        let source = text as NSString

        try move(harness, to: try windowPoint(forCharacter: source.range(of: "logo").location + 1, in: harness))
        #expect(harness.textView.shownImagePreviewURL == nil, "erst nach kurzer Ruhe")
        try await waitForPreview(harness)
        #expect(harness.textView.shownImagePreviewURL == logo)

        try move(harness, to: try windowPoint(forCharacter: source.range(of: "Ende").location + 1, in: harness))
        #expect(harness.textView.shownImagePreviewURL == nil, "Maus weg")

        try move(harness, to: try windowPoint(forCharacter: source.range(of: "logo").location + 1, in: harness))
        try await waitForPreview(harness)
        #expect(harness.textView.shownImagePreviewURL == logo)
        harness.textView.insertText("x", replacementRange: NSRange(location: 0, length: 0))
        #expect(harness.textView.shownImagePreviewURL == nil, "Tippen schließt")
    }

    @Test("Unbekannte Datei oder fehlender Auflöser: keine Vorschau")
    func unknown() async throws {
        let text = "\\includegraphics{fehlt}"
        let harness = CompletionHarness(text: text)
        try await harness.start()
        let point = try windowPoint(forCharacter: 18, in: harness)
        try move(harness, to: point)
        try await Task.sleep(for: .milliseconds(800))
        #expect(harness.textView.shownImagePreviewURL == nil, "ohne Auflöser")
        harness.textView.imageResolver = { _ in nil }
        try move(harness, to: point)
        try await Task.sleep(for: .milliseconds(800))
        #expect(harness.textView.shownImagePreviewURL == nil)
    }
}
