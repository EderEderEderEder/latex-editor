import AppKit
import Foundation
import Testing
@testable import LatexEditor

/// Ersetzt Nachfragen und Papierkorb, damit nichts Modales blockiert und nie der echte Papierkorb benutzt wird.
@MainActor
struct Sandbox {
    let model = AppModel.shared
    let project: TemporaryProject
    let trashFolder: TemporaryProject
    private(set) var trashed: [URL] = []

    init() throws {
        project = try TemporaryProject()
        trashFolder = try TemporaryProject()
    }

    func install(updateChoice: ReferenceUpdateChoice = .update, trashConfirmation: Bool = true) {
        model.confirmReferenceUpdate = { _, _ in updateChoice }
        model.confirmTrash = { _, _ in trashConfirmation }
        let folder = trashFolder.root
        model.fileActions.undoManagerOverride = UndoManager()
        model.moveToTrash = { url in
            let target = folder.appendingPathComponent(url.lastPathComponent)
            try FileManager.default.moveItem(at: url, to: target)
            return target
        }
    }

    func cleanUp() {
        model.fileActions.undoManagerOverride = nil
        project.remove()
        trashFolder.remove()
    }

    func text(_ relativePath: String) throws -> String {
        try String(contentsOf: project.url(relativePath), encoding: .utf8)
    }
}

func makeThesis(_ sandbox: Sandbox) throws {
    try sandbox.project.write("main.tex", """
        \\documentclass{report}
        \\graphicspath{{images/}}
        \\begin{document}
        \\include{chapters/einleitung}
        \\include{chapters/schluss}
        \\end{document}
        """)
    try sandbox.project.write("chapters/einleitung.tex", "\\chapter{Einleitung}\n\\includegraphics{logo.png}\nSiehe \\input{chapters/schluss}\n")
    try sandbox.project.write("chapters/schluss.tex", "\\chapter{Schluss}\n")
    try sandbox.project.write("images/logo.png", "PNG")
}

extension AppModelSuite {
@Suite("Dateien im Projekt (App-Ebene)")
@MainActor
struct FileActionsTests {
    @Test("Neue Datei: wird angelegt, in einem festen Tab geöffnet, Gerüst optional")
    func newFile() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        try await model.createFile(named: "ausblick", in: sandbox.project.url("chapters"), chapterScaffold: true)

        #expect(try sandbox.text("chapters/ausblick.tex") == "\\chapter{ausblick}\n\n")
        #expect(model.editor.current?.url == sandbox.project.url("chapters/ausblick.tex"))
        #expect(model.editor.tabs.previewFileURL == nil)
        await #expect(throws: FileOperationError.alreadyExists("ausblick.tex")) {
            try await model.createFile(named: "ausblick.tex", in: sandbox.project.url("chapters"), chapterScaffold: false)
        }
    }

    @Test("Umbenennen mit Verweisen: Datei, offene Tabs (mit Änderungen), Verweise in anderen Dateien")
    func renameUpdatesEverything() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        await model.editor.open(sandbox.project.url("chapters/schluss.tex"), asPreview: false)
        let session = try #require(model.editor.current)
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 0), with: "% ungespeichert\n")
        await model.editor.open(sandbox.project.url("chapters/einleitung.tex"), asPreview: false)

        try await model.rename(sandbox.project.url("chapters/schluss.tex"), to: "ausblick")

        let renamed = sandbox.project.url("chapters/ausblick.tex")
        #expect(FileManager.default.fileExists(atPath: renamed.path))
        #expect(!FileManager.default.fileExists(atPath: sandbox.project.url("chapters/schluss.tex").path))
        #expect(model.editor.session(for: renamed) === session, "Sitzung mit Undo-Verlauf zieht um")
        #expect(session.url == renamed)
        #expect(session.isDirty && session.textStorage.string.hasPrefix("% ungespeichert"))
        #expect(model.editor.tabs.fileURLs.contains(renamed))
        #expect(try sandbox.text("main.tex").contains("\\include{chapters/ausblick}"))
        let einleitung = try #require(model.editor.session(for: sandbox.project.url("chapters/einleitung.tex")))
        #expect(einleitung.textStorage.string.contains("\\input{chapters/ausblick}"))
        #expect(!einleitung.isDirty, "vorher unverändert → nach der Anpassung gespeichert")
        #expect(try sandbox.text("chapters/einleitung.tex").contains("\\input{chapters/ausblick}"))
    }

    @Test("Verweise in geschlossenen Latin-1-Dateien werden angepasst und bleiben Latin-1; Schreibfehler werden gemeldet")
    func referenceEditsEncodingAndFailures() async throws {
        let sandbox = try Sandbox()
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: sandbox.project.url("fest").path)
            sandbox.cleanUp()
        }
        try makeThesis(sandbox)
        let latin1 = try #require("\\chapter{Größe}\nSiehe \\input{chapters/schluss}\n".data(using: .isoLatin1))
        try FileManager.default.createDirectory(at: sandbox.project.url("anhang"), withIntermediateDirectories: true)
        try latin1.write(to: sandbox.project.url("anhang/alt.tex"))
        try sandbox.project.write("fest/gesperrt.tex", "\\input{chapters/schluss}\n")
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: sandbox.project.url("fest").path)

        try await model.rename(sandbox.project.url("chapters/schluss.tex"), to: "ausblick")

        let data = try Data(contentsOf: sandbox.project.url("anhang/alt.tex"))
        #expect(String(data: data, encoding: .isoLatin1) == "\\chapter{Größe}\nSiehe \\input{chapters/ausblick}\n")
        #expect(String(data: data, encoding: .utf8) == nil, "Kodierung bleibt Latin-1")
        let message = try #require(model.fileActions.errorMessage)
        #expect(message.contains("gesperrt.tex") && message.contains("von Hand"))
        #expect(!message.contains("alt.tex"))
        model.fileActions.errorMessage = nil
    }

    @Test("Umbenennen ohne Verweise anzupassen („Nur umbenennen“) und Abbrechen")
    func skipAndCancel() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install(updateChoice: .cancel)
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        try await model.rename(sandbox.project.url("chapters/schluss.tex"), to: "ausblick")
        #expect(FileManager.default.fileExists(atPath: sandbox.project.url("chapters/schluss.tex").path), "Abbrechen ändert nichts")

        sandbox.install(updateChoice: .skip)
        try await model.rename(sandbox.project.url("chapters/schluss.tex"), to: "ausblick")
        #expect(FileManager.default.fileExists(atPath: sandbox.project.url("chapters/ausblick.tex").path))
        #expect(try sandbox.text("main.tex").contains("\\include{chapters/schluss}"))
    }

    @Test("Hauptdatei umbenennen: Projekt folgt, Tabs und Gliederung auch")
    func renameMainFile() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        #expect(model.project.mainFileURL == sandbox.project.url("main.tex"))

        try await model.rename(sandbox.project.url("main.tex"), to: "arbeit.tex")
        for _ in 0..<50 where model.project.tree?.collectFiles().contains(where: { $0.url.lastPathComponent == "arbeit.tex" }) != true {
            try await Task.sleep(for: .milliseconds(20))
        }

        #expect(model.project.mainFileURL == sandbox.project.url("arbeit.tex"))
        #expect(model.editor.tabs.fileURLs.contains(sandbox.project.url("arbeit.tex")))
        #expect(model.pdf.expectedURL?.lastPathComponent == "arbeit.pdf")
    }

    @Test("Ordner umbenennen: Tabs darin folgen, Verweise auf alles darin werden angepasst")
    func renameFolder() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        await model.editor.open(sandbox.project.url("chapters/schluss.tex"), asPreview: false)

        try await model.rename(sandbox.project.url("chapters"), to: "kapitel")

        #expect(model.editor.tabs.contains(sandbox.project.url("kapitel/schluss.tex")))
        #expect(model.editor.current?.url == sandbox.project.url("kapitel/schluss.tex"))
        let main = try sandbox.text("main.tex")
        #expect(main.contains("\\include{kapitel/einleitung}") && main.contains("\\include{kapitel/schluss}"))
    }

    @Test("Verschieben per Ziehen: Datei, Tab und Verweise; ungültige Ziele werden abgelehnt")
    func moving() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        try sandbox.project.makeDirectory("anhang")
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        await model.editor.open(sandbox.project.url("chapters/schluss.tex"), asPreview: false)

        await model.move(sandbox.project.url("chapters/schluss.tex"), into: sandbox.project.url("anhang"))
        #expect(FileManager.default.fileExists(atPath: sandbox.project.url("anhang/schluss.tex").path))
        #expect(model.editor.current?.url == sandbox.project.url("anhang/schluss.tex"))
        #expect(try sandbox.text("main.tex").contains("\\include{anhang/schluss}"))

        await model.move(sandbox.project.url("anhang"), into: sandbox.project.url("anhang/unterordner"))
        #expect(model.fileActions.errorMessage != nil)
    }

    @Test("Papierkorb: Tabs schließen, Datei liegt im Ersatz-Papierkorb, Abbrechen ändert nichts")
    func trashing() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        await model.editor.open(sandbox.project.url("chapters/schluss.tex"), asPreview: false)
        let target = sandbox.project.url("chapters/schluss.tex")

        sandbox.install(trashConfirmation: false)
        await model.trash(target)
        #expect(FileManager.default.fileExists(atPath: target.path))
        #expect(model.editor.tabs.contains(target))

        sandbox.install(trashConfirmation: true)
        await model.trash(target)
        #expect(!FileManager.default.fileExists(atPath: target.path))
        #expect(FileManager.default.fileExists(atPath: sandbox.trashFolder.url("schluss.tex").path))
        #expect(!model.editor.tabs.contains(target))
        #expect(model.editor.current != nil, "ein anderer Tab bleibt sichtbar")
    }

    @Test("Papierkorb: Ordner schließt alle seine Tabs; letzter Tab öffnet die Hauptdatei")
    func trashingFolder() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        await model.editor.open(sandbox.project.url("chapters/schluss.tex"), asPreview: false)
        await model.editor.open(sandbox.project.url("chapters/einleitung.tex"), asPreview: false)

        await model.trash(sandbox.project.url("chapters"))

        #expect(model.editor.tabs.fileURLs == [sandbox.project.url("main.tex")])
        #expect(model.editor.current?.url == sandbox.project.url("main.tex"))
    }

    @Test("Papierkorb: Projektordner und Dateien außerhalb sind geschützt")
    func trashGuards() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        let outside = try TemporaryProject()
        defer { outside.remove() }
        let foreign = try outside.write("fremd.tex")

        await model.trash(sandbox.project.root)
        #expect(model.fileActions.errorMessage == FileOperationError.isProjectRoot.errorDescription)
        model.fileActions.errorMessage = nil
        await model.trash(foreign)
        #expect(model.fileActions.errorMessage == FileOperationError.outsideProject.errorDescription)
        #expect(FileManager.default.fileExists(atPath: foreign.path))
    }

    @Test("Duplizieren öffnet die Kopie")
    func duplicating() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        await model.duplicate(sandbox.project.url("chapters/schluss.tex"))
        #expect(model.editor.current?.url == sandbox.project.url("chapters/schluss Kopie.tex"))
    }

    @Test("Dialog: Umbenennen über die Eingabe meldet Fehler zurück und lässt den Dialog offen")
    func commitReportsErrors() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try makeThesis(sandbox)
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)
        model.beginRename(sandbox.project.url("chapters/schluss.tex"))
        let prompt = try #require(model.fileActions.prompt)

        let failure = await model.commit(prompt, name: "einleitung.tex")
        #expect(failure == FileOperationError.alreadyExists("einleitung.tex").errorDescription)
        #expect(model.fileActions.prompt != nil)

        let success = await model.commit(prompt, name: "ausblick")
        #expect(success == nil)
        #expect(model.fileActions.prompt == nil)
        #expect(FileManager.default.fileExists(atPath: sandbox.project.url("chapters/ausblick.tex").path))
    }
}

}

private let canCompile = LatexToolchain.latexmk() != nil

extension AppModelSuite {
@Suite("Umbenennen und danach kompilieren (nur mit MacTeX)", .enabled(if: canCompile))
@MainActor
struct RenameCompileTests {
    @Test("Nach Umbenennen von Kapitel, Bild und Ordner kompiliert das Projekt weiterhin fehlerfrei")
    func compilesAfterRenames() async throws {
        let sandbox = try Sandbox()
        defer { sandbox.cleanUp() }
        try sandbox.project.write("main.tex", """
            \\documentclass{report}
            \\usepackage{graphicx}
            \\graphicspath{{images/}}
            \\begin{document}
            \\include{chapters/eins}
            \\end{document}
            """)
        try sandbox.project.write("chapters/eins.tex", "\\chapter{Eins}\n\\includegraphics[width=2cm]{bild.png}\n")
        let png = try #require(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 20, pixelsHigh: 20, bitsPerSample: 8, samplesPerPixel: 4,
            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )?.representation(using: .png, properties: [:]))
        try FileManager.default.createDirectory(at: sandbox.project.url("images"), withIntermediateDirectories: true)
        try png.write(to: sandbox.project.url("images/bild.png"))
        sandbox.install()
        let model = sandbox.model
        await model.openProject(sandbox.project.root)

        try await model.rename(sandbox.project.url("images/bild.png"), to: "grafik-neu.png")
        try await model.rename(sandbox.project.url("chapters"), to: "kapitel")
        try await model.rename(sandbox.project.url("kapitel/eins.tex"), to: "erstes.tex")

        let main = sandbox.project.url("main.tex")
        let result = try await LatexBuildRunner.run(LatexBuildRequest(mainFile: main))
        let errors = BuildReport.make(from: result, mainFile: main).issues.filter { $0.severity == .error }
        #expect(errors.isEmpty, "Fehler: \(errors.map(\.message))")
        #expect(result.succeeded)
        #expect(try sandbox.text("kapitel/erstes.tex").contains("{grafik-neu.png}"))
    }
}
}
