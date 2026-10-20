import Foundation
import Testing
@testable import LatexEditor

/// Fixture: Mini-Dokument mit zwei `\include`-Kapiteln, kompiliert mit MacTeX 2026 in
/// „/tmp/LatexEditor SyncTeX Fixture“ (Pfade in der Datei: `/private/tmp/…/./chapters/zwei.tex`).
/// Referenzwerte stammen von der `synctex`-Kommandozeile (nur als Prüfmaßstab, die App nutzt sie nicht).
private enum Fixture {
    static let directory = "/tmp/LatexEditor SyncTeX Fixture"
    /// Absichtlich über `/tmp` (Symlink) und ohne `./`, um die Pfadnormalisierung zu prüfen.
    static let chapterOne = URL(fileURLWithPath: "\(directory)/chapters/eins.tex")
    static let chapterTwo = URL(fileURLWithPath: "\(directory)/chapters/zwei.tex")

    static func index() throws -> SyncTeXIndex {
        let url = try #require(Bundle.module.url(forResource: "Fixtures/two-chapters.synctex", withExtension: "gz"))
        return try SyncTeXIndex.load(contentsOf: url)
    }

    static func compressedData() throws -> Data {
        let url = try #require(Bundle.module.url(forResource: "Fixtures/two-chapters.synctex", withExtension: "gz"))
        return try Data(contentsOf: url)
    }
}

/// Ergebnis von `synctex view`: Seite, linker Rand, Grundlinie, Breite der Zeilenbox.
private struct ViewReference {
    let file: URL
    let line: Int
    let page: Int
    let left: CGFloat
    let baseline: CGFloat
    let width: CGFloat
}

private let positionTolerance: CGFloat = 0.5

private let viewReferences = [
    ViewReference(file: Fixture.chapterTwo, line: 3, page: 2, left: 133.768356, baseline: 340.838989, width: 343.711060),
    ViewReference(file: Fixture.chapterTwo, line: 5, page: 2, left: 133.768356, baseline: 351.687195, width: 343.711060),
    ViewReference(file: Fixture.chapterTwo, line: 8, page: 3, left: 133.768356, baseline: 136.701797, width: 343.711060),
    ViewReference(file: Fixture.chapterOne, line: 2, page: 1, left: 133.768356, baseline: 313.040497, width: 343.711060)
]

/// Ergebnis von `synctex edit`: Seite und Punkt (bp, oben links) → Datei und Zeile.
private let editReferences: [(page: Int, point: CGPoint, file: URL, line: Int)] = [
    (2, CGPoint(x: 200, y: 339), Fixture.chapterTwo, 3),
    (2, CGPoint(x: 250, y: 351), Fixture.chapterTwo, 5),
    (3, CGPoint(x: 200, y: 136), Fixture.chapterTwo, 8),
    (1, CGPoint(x: 200, y: 311), Fixture.chapterOne, 2)
]

private func samePath(_ lhs: URL?, _ rhs: URL) -> Bool {
    lhs.map { SyncTeXIndex.normalizedPath($0) == SyncTeXIndex.normalizedPath(rhs) } ?? false
}

@Suite("SyncTeX: Einlesen")
struct SyncTeXLoadingTests {
    @Test("gzip wird ohne externe Werkzeuge entpackt")
    func decompressesGzip() throws {
        let text = String(decoding: try Gzip.decompress(Fixture.compressedData()), as: UTF8.self)
        #expect(text.hasPrefix("SyncTeX Version:1"))
        #expect(text.contains("Input:9:/private/tmp/LatexEditor SyncTeX Fixture/./chapters/zwei.tex"))
    }

    @Test("gzip-Kopf mit Dateinamen-Feld wird übersprungen")
    func gzipHeaderWithFileName() throws {
        let original = Data("SyncTeX Version:1\nInput:1:/a.tex\n".utf8)
        let deflated = try (original as NSData).compressed(using: .zlib) as Data
        let header: [UInt8] = [0x1F, 0x8B, 0x08, 0x08, 0, 0, 0, 0, 0, 0x03] + Array("main.synctex\0".utf8)
        let trailer = [UInt8](repeating: 0, count: 8)
        #expect(try Gzip.decompress(Data(header) + deflated + Data(trailer)) == original)
    }

    @Test("Abgeschnittene oder fremde Daten führen zu einem Fehler, nicht zum Absturz")
    func rejectsBrokenData() throws {
        let data = try Fixture.compressedData()
        #expect(throws: SyncTeXError.self) { try Gzip.decompress(data.prefix(data.count / 2)) }
        #expect(throws: SyncTeXError.self) { try Gzip.decompress(Data("kein gzip".utf8)) }
        #expect(throws: SyncTeXError.self) { try SyncTeXIndex.parse(Data()) }
    }

    @Test("Eingabedateien und Seiten werden erkannt")
    func parsesStructure() throws {
        let index = try Fixture.index()
        #expect(index.inputs.count == 12)
        #expect(Set(index.pageRanges.keys) == [1, 2, 3])
        #expect(index.magnification == 1_000)
    }

    @Test("Unkomprimierte .synctex-Dateien werden ebenfalls gelesen")
    func readsPlainText() throws {
        let plain = try Gzip.decompress(Fixture.compressedData())
        let index = try SyncTeXIndex.parse(plain)
        #expect(index.forward(file: Fixture.chapterTwo, line: 3)?.page == 2)
    }
}

@Suite("SyncTeX: Vorwärtssuche (Quelltext → PDF)")
struct SyncTeXForwardTests {
    @Test("Seite und Zeilenbox stimmen mit der synctex-Kommandozeile überein", arguments: viewReferences)
    fileprivate func matchesCommandLine(reference: ViewReference) throws {
        let box = try #require(try Fixture.index().forward(file: reference.file, line: reference.line))
        #expect(box.page == reference.page)
        #expect(abs(box.rect.minX - reference.left) < positionTolerance)
        #expect(abs(box.rect.width - reference.width) < positionTolerance)
        #expect(box.rect.minY <= reference.baseline && reference.baseline <= box.rect.maxY + positionTolerance)
    }

    @Test("Leerzeile führt zur Zeile davor, Zeile hinter dem Ende zur letzten")
    func clampsLines() throws {
        let index = try Fixture.index()
        #expect(index.forward(file: Fixture.chapterTwo, line: 4) == index.forward(file: Fixture.chapterTwo, line: 3))
        #expect(index.forward(file: Fixture.chapterTwo, line: 999)?.page == 3)
        #expect(index.forward(file: Fixture.chapterTwo, line: -5) != nil)
    }

    @Test("Pfade mit ./, Symlink und Leerzeichen werden gleich behandelt")
    func normalizesPaths() throws {
        let index = try Fixture.index()
        let variants = [
            "/private/tmp/LatexEditor SyncTeX Fixture/./chapters/zwei.tex",
            "/tmp/LatexEditor SyncTeX Fixture/chapters/../chapters/zwei.tex",
            "/tmp/LatexEditor SyncTeX Fixture/chapters/zwei.tex"
        ]
        let results = variants.map { index.forward(file: URL(fileURLWithPath: $0), line: 3) }
        #expect(results.allSatisfy { $0 != nil && $0 == results[0] })
    }

    @Test("Unbekannte Datei ergibt kein Ergebnis")
    func unknownFile() throws {
        #expect(try Fixture.index().forward(file: URL(fileURLWithPath: "/gibt/es/nicht.tex"), line: 1) == nil)
    }
}

@Suite("SyncTeX: Rückwärtssuche (PDF → Quelltext)")
struct SyncTeXBackwardTests {
    @Test("Datei und Zeile stimmen mit der synctex-Kommandozeile überein")
    func matchesCommandLine() throws {
        let index = try Fixture.index()
        for reference in editReferences {
            let location = index.backward(page: reference.page, point: reference.point)
            #expect(samePath(location?.file, reference.file), "Seite \(reference.page) \(reference.point)")
            #expect(location?.line == reference.line, "Seite \(reference.page) \(reference.point)")
        }
    }

    @Test("Hin und zurück landet auf derselben Zeile")
    func roundTrip() throws {
        let index = try Fixture.index()
        for (file, line) in [(Fixture.chapterTwo, 3), (Fixture.chapterTwo, 5), (Fixture.chapterTwo, 8), (Fixture.chapterOne, 2)] {
            let box = try #require(index.forward(file: file, line: line))
            let location = index.backward(page: box.page, point: CGPoint(x: box.rect.midX, y: box.rect.midY))
            #expect(samePath(location?.file, file))
            #expect(location.map { abs($0.line - line) <= 1 } == true, "\(file.lastPathComponent):\(line) → \(String(describing: location))")
        }
    }

    @Test("Seite außerhalb des Dokuments ergibt kein Ergebnis")
    func unknownPage() throws {
        let index = try Fixture.index()
        #expect(index.backward(page: 0, point: .zero) == nil)
        #expect(index.backward(page: 99, point: CGPoint(x: 100, y: 100)) == nil)
    }
}

@Suite("SyncTeX: Koordinaten")
struct SyncTeXCoordinateTests {
    @Test("Oben-links (SyncTeX) und unten-links (PDFKit) werden ineinander umgerechnet")
    func convertsCoordinates() {
        let a4 = CGRect(x: 0, y: 0, width: 595, height: 842)
        #expect(SyncTeXCoordinates.pdfRect(from: CGRect(x: 100, y: 200, width: 50, height: 10), mediaBox: a4)
            == CGRect(x: 100, y: 632, width: 50, height: 10))
        #expect(SyncTeXCoordinates.syncTeXPoint(fromPDF: CGPoint(x: 100, y: 632), mediaBox: a4) == CGPoint(x: 100, y: 210))
    }

    @Test("Seiten mit verschobener Media-Box (z. B. Beschnitt)")
    func shiftedMediaBox() {
        let shifted = CGRect(x: 10, y: 20, width: 595, height: 842)
        let pdfRect = SyncTeXCoordinates.pdfRect(from: CGRect(x: 100, y: 200, width: 50, height: 10), mediaBox: shifted)
        #expect(pdfRect == CGRect(x: 110, y: 652, width: 50, height: 10))
        let point = SyncTeXCoordinates.syncTeXPoint(fromPDF: CGPoint(x: pdfRect.minX, y: pdfRect.maxY), mediaBox: shifted)
        #expect(point == CGPoint(x: 100, y: 200))
    }
}

@Suite("SyncTeX: Nachladen")
@MainActor
struct SyncTeXStoreTests {
    @Test("Fehlende oder abgeschnittene Datei (Build läuft) behält die bisherigen Daten")
    func keepsDataWhenFileIsBroken() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex")
        let dataURL = project.url("main.synctex.gz")
        let complete = try Fixture.compressedData()
        try complete.write(to: dataURL)
        let store = SyncTeXStore(defaults: UserDefaults(suiteName: "LatexEditorTests-\(UUID().uuidString)")!)

        store.reload(mainFile: main)
        await store.waitUntilLoaded()
        #expect(store.forward(file: Fixture.chapterTwo, line: 3)?.page == 2)

        try complete.prefix(complete.count / 3).write(to: dataURL)
        store.reload(mainFile: main)
        await store.waitUntilLoaded()
        #expect(store.forward(file: Fixture.chapterTwo, line: 3)?.page == 2)

        try FileManager.default.removeItem(at: dataURL)
        store.reload(mainFile: main)
        await store.waitUntilLoaded()
        #expect(store.forward(file: Fixture.chapterTwo, line: 3)?.page == 2)
    }

    @Test("„PDF folgt Cursor“ ist standardmäßig aus und wird gemerkt")
    func followCursorPreference() {
        let defaults = UserDefaults(suiteName: "LatexEditorTests-\(UUID().uuidString)")!
        let store = SyncTeXStore(defaults: defaults)
        #expect(!store.followCursor)
        store.followCursor = true
        #expect(SyncTeXStore(defaults: defaults).followCursor)
    }
}

// MARK: - Gegenprobe mit echtem MacTeX

private let synctexCommand = URL(fileURLWithPath: "/Library/TeX/texbin/synctex")
private let hasSyncTeXTools = LatexToolchain.latexmk() != nil
    && FileManager.default.isExecutableFile(atPath: synctexCommand.path)

/// Ruft die `synctex`-Kommandozeile auf (nur im Test, als unabhängige Referenz).
private func runSyncTeX(_ arguments: [String], in directory: URL) throws -> [String: String] {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = synctexCommand
    process.arguments = arguments
    process.currentDirectoryURL = directory
    process.standardOutput = pipe
    try process.run()
    let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    process.waitUntilExit()
    var values: [String: String] = [:]
    for line in output.split(separator: "\n") {
        guard let colon = line.firstIndex(of: ":"), values[String(line[..<colon])] == nil else { continue }
        values[String(line[..<colon])] = String(line[line.index(after: colon)...])
    }
    return values
}

@Suite("SyncTeX gegen MacTeX (nur mit MacTeX)", .serialized, .enabled(if: hasSyncTeXTools))
struct SyncTeXIntegrationTests {
    @Test("Frisch kompiliertes Dokument: Vorwärts- und Rückwärtssuche wie die synctex-Kommandozeile")
    func matchesFreshBuild() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("Mit Leerzeichen/main.tex",
                                     "\\documentclass{report}\n\\begin{document}\n\\include{chapters/eins}\n\\include{chapters/zwei}\n\\end{document}\n")
        try project.write("Mit Leerzeichen/chapters/eins.tex", "\\chapter{Eins}\nText im ersten Kapitel.\n")
        let lines = (1...30).map { "Zeile \($0) im zweiten Kapitel mit genug Text für eine eigene Zeile.\n" }.joined(separator: "\n")
        let chapter = try project.write("Mit Leerzeichen/chapters/zwei.tex", "\\chapter{Zwei}\n" + lines)
        let result = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        #expect(result.succeeded)

        let directory = main.deletingLastPathComponent()
        let index = try SyncTeXIndex.load(contentsOf: directory.appendingPathComponent("main.synctex.gz"))
        for line in [2, 21, 45, 59] {
            let reference = try runSyncTeX(["view", "-i", "\(line):0:chapters/zwei.tex", "-o", "main.pdf"], in: directory)
            let box = try #require(index.forward(file: chapter, line: line), "Zeile \(line)")
            #expect(String(box.page) == reference["Page"], "Zeile \(line)")
            let referenceLeft = try #require(reference["h"].flatMap(Double.init))
            #expect(abs(box.rect.minX - referenceLeft) < positionTolerance, "Zeile \(line)")

            let point = CGPoint(x: box.rect.midX, y: box.rect.midY)
            let edit = try runSyncTeX(["edit", "-o", "\(box.page):\(point.x):\(point.y):main.pdf"], in: directory)
            let location = index.backward(page: box.page, point: point)
            #expect(location.map { String($0.line) } == edit["Line"], "Rückwärts Zeile \(line)")
        }
    }
}
