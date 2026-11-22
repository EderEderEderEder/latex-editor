import AppKit
import Foundation
import Testing
@testable import LatexEditor

private let canCompileTemplate = LatexToolchain.latexmk() != nil && DemoProject.exists

private func writePNG(to url: URL) throws {
    let size = 40
    let representation = try #require(NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ))
    let png = try #require(representation.representation(using: .png, properties: [:]))
    try png.write(to: url)
}

@Suite("Einfügen: kompiliert im Demo-Projekt im Stil der HgbThesis (nur mit MacTeX)", .serialized, .enabled(if: canCompileTemplate))
struct InsertionCompileTests {
    @Test("Alle Bausteine zusammen kompilieren ohne Fehler; Verweise und Zitat lösen auf")
    func compilesAllBlocks() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        try DemoProject.copy(to: project.root)

        // Bild von außerhalb des Projekts („Downloads“): wird nach images/ kopiert (Leerzeichen, Umlaut im Namen)
        let downloads = try TemporaryProject()
        defer { downloads.remove() }
        let download = downloads.url("Mein Bild (Größe).png")
        try writePNG(to: download)
        try project.write("hgbreferences.bib", "@book{knuth1984, author={Knuth, Donald}, title={The {TeX}book}, year={1984}, publisher={Addison-Wesley}}\n")

        let store = await MainActor.run { InsertStore(defaults: temporaryDefaults()) }
        let main = project.url("main.tex")
        let chapter = project.url("chapters/einleitung.tex")
        let catalogFiles = [main, chapter, project.url("hgbreferences.bib")]
        await MainActor.run {
            store.present(kind: .table, selectedText: "", root: project.root, files: catalogFiles, mainFile: main)
        }
        await store.waitForCatalog()
        let (blocks, labels): ([String], [String]) = try await MainActor.run {
            var texts: [String] = []

            var table = TableSettings()
            table.fill(fromTabSeparated: "Sprache\tAnteil in %\tNotiz\nC++\t12,5\tschnell & hart\nPython_3\t30\t#1 Wahl")
            table.alignments = [.left, .right, .center]
            table.caption = "Programmiersprachen mit 100 % Sonderzeichen_Test"
            store.table = table
            store.kind = .table
            texts.append(store.generate(imageReference: ""))
            let tableLabel = store.resolvedLabel(for: .table)

            store.image.file = download
            store.image.caption = "Ein Beispielbild"
            store.image.widthPercent = 60
            store.kind = .image
            texts.append(store.generate(imageReference: try store.prepareImageReference()))
            let imageLabel = store.resolvedLabel(for: .image)

            for language in CodeLanguage.all {
                store.code = CodeSettings(language: language, content: "x = 1 % kein Kommentar\nprint(x)", caption: "Code in \(language.title)")
                store.kind = .code
                texts.append(store.generate(imageReference: ""))
            }
            store.code = CodeSettings(language: CodeLanguage.default, content: "y = 2", asFloat: false, lineNumbers: false)
            texts.append(store.generate(imageReference: ""))

            store.equation = EquationSettings(kind: .align, content: "a &= b + c \\\\\nd &= e", labelOverride: "eq:summe")
            store.kind = .equation
            texts.append(store.generate(imageReference: ""))
            store.equation = EquationSettings(kind: .equationStar, content: "E = mc^2")
            texts.append(store.generate(imageReference: ""))

            store.list = ListSettings(kind: .enumerate, items: ["Eins", "Zwei", ""])
            store.kind = .list
            texts.append(store.generate(imageReference: ""))
            return (texts, [tableLabel, imageLabel])
        }

        let imageName = project.url("images/Mein-Bild-Groesse.png")
        #expect(FileManager.default.fileExists(atPath: imageName.path), "Bild wurde nicht nach images/ kopiert")
        #expect(blocks[1].contains("{Mein-Bild-Groesse.png}"), "graphicspath der Vorlage wird berücksichtigt: \(blocks[1])")

        let sentence = "Siehe Abbildung~\\ref{\(labels[1])}, Tabelle~\\ref{\(labels[0])} und \\cite[S.~12]{knuth1984}.\n"
        try appendToChapter(chapter, blocks: blocks, sentence: sentence)

        let result = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        let report = BuildReport.make(from: result, mainFile: main)
        let errors = report.issues.filter { $0.severity == .error }
        #expect(errors.isEmpty, "Fehler: \(errors.map { "\($0.fileURL?.lastPathComponent ?? "-"):\($0.line ?? 0) \($0.message)" })")
        #expect(result.succeeded)
        let undefined = report.issues.filter { $0.message.contains("undefined") && $0.severity == .warning }
        #expect(labels.allSatisfy { label in undefined.allSatisfy { !$0.message.contains(label) } },
                "Verweise müssen auflösen: \(undefined.map(\.message))")
        let citations = report.issues.filter { $0.message.contains("knuth1984") }
        #expect(citations.isEmpty, "Zitat muss auflösen: \(citations.map(\.message))")
        print("⏱ Demo-Vorlage mit allen Bausteinen kompiliert in \(String(format: "%.1f", result.duration.milliseconds / 1000)) s")
    }

    private func appendToChapter(_ chapter: URL, blocks: [String], sentence: String) throws {
        var text = try String(contentsOf: chapter, encoding: .utf8)
        text += "\n" + blocks.joined(separator: "\n") + "\n" + sentence
        try text.write(to: chapter, atomically: true, encoding: .utf8)
    }
}
