import Foundation
import Testing
@testable import LatexEditor

@Suite("Änderungsmarken")
struct ChangeMarksTests {
    @Test("Neue, geänderte und gelöschte Zeilen")
    func kinds() {
        let marks = ChangeMarks.compute(base: "a\nb\nc\nd\ne\n", current: "a\nB\nc\nneu\nd\n")

        #expect(marks.lines == [2: .modified, 4: .added])
        #expect(marks.deletedAtEnd)
    }

    @Test("Mehr hinzugefügt als entfernt: zuerst geändert, Rest neu")
    func modifiedThenAdded() {
        let marks = ChangeMarks.compute(base: "a\nalt\nz\n", current: "a\nneu1\nneu2\nneu3\nz\n")

        #expect(marks.lines == [2: .modified, 3: .added, 4: .added])
        #expect(!marks.deletedAtEnd)
    }

    @Test("Gelöschte Zeilen markieren die Zeile darunter, am Anfang die erste")
    func deletions() {
        #expect(ChangeMarks.compute(base: "a\nb\nc\n", current: "a\nc\n").lines == [2: .deletedAbove])
        #expect(ChangeMarks.compute(base: "a\nb\nc\n", current: "b\nc\n").lines == [1: .deletedAbove])
    }

    @Test("Gleicher Text: keine Marken; leere Datei aus nichts: keine Marken")
    func unchanged() {
        #expect(ChangeMarks.compute(base: "a\nb\n", current: "a\nb\n").isEmpty)
        #expect(ChangeMarks.compute(base: "", current: "").isEmpty)
        #expect(ChangeMarks.compute(base: "", current: "x\n").lines == [1: .added])
    }
}

@Suite("Externe Änderungen an offenen Dateien")
@MainActor
struct DiskSyncTests {
    private func open(_ contents: String) async throws -> (DocumentSession, TemporaryProject) {
        let project = try TemporaryProject()
        let url = try project.write("datei.tex", contents)
        return (try await DocumentSession.load(url: url), project)
    }

    @Test("Unveränderte Datei lädt still neu, nur der geänderte Teil wird ersetzt, Undo-Verlauf wird geleert")
    func reloadsCleanSession() async throws {
        let (session, project) = try await open("Anfang\nMitte\nEnde\n")
        defer { project.remove() }
        session.undoManager.registerUndo(withTarget: session) { _ in }
        var edits = 0
        session.onEdited = { edits += 1 }
        try project.write("datei.tex", "Anfang\nNeue Mitte\nEnde\n")

        #expect(await session.syncWithDisk() == .reloaded)
        #expect(session.textStorage.string == "Anfang\nNeue Mitte\nEnde\n")
        #expect(!session.isDirty)
        #expect(!session.undoManager.canUndo)
        #expect(edits == 1)
        #expect(session.lineIndex.lineCount == 4)
    }

    @Test("Eigenes Speichern ist keine externe Änderung")
    func ownSaveIsIgnored() async throws {
        let (session, project) = try await open("a\n")
        defer { project.remove() }
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 1), with: "b")
        try session.save()

        #expect(await session.syncWithDisk() == .unchanged)
        #expect(session.textStorage.string == "b\n")
    }

    @Test("Mit ungespeicherten Änderungen: nur Hinweis; „Behalten“ und „Neu laden“")
    func conflictWithUnsavedChanges() async throws {
        let (session, project) = try await open("a\n")
        defer { project.remove() }
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 1), with: "mein")
        try project.write("datei.tex", "von außen\n")

        #expect(await session.syncWithDisk() == .conflict)
        #expect(session.hasExternalChange)
        #expect(session.textStorage.string == "mein\n")

        await session.keepLocalVersion()
        #expect(!session.hasExternalChange)
        #expect(await session.syncWithDisk() == .unchanged, "Derselbe Stand meldet sich nicht erneut")

        try project.write("datei.tex", "noch einmal\n")
        #expect(await session.syncWithDisk(discardingChanges: true) == .reloaded)
        #expect(session.textStorage.string == "noch einmal\n")
        #expect(!session.isDirty && !session.hasExternalChange)
    }

    @Test("Verwerfen ohne Änderung auf der Platte setzt den Editor auf die Platte zurück")
    func discardingWithoutDiskChange() async throws {
        let (session, project) = try await open("a\n")
        defer { project.remove() }
        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 1), with: "x")

        #expect(await session.syncWithDisk(discardingChanges: true) == .reloaded)
        #expect(session.textStorage.string == "a\n")
        #expect(!session.isDirty)
    }

    @Test("Gelöschte Datei wird gemeldet, Latin-1 wird erkannt")
    func missingAndLatin1() async throws {
        let (session, project) = try await open("a\n")
        defer { project.remove() }
        try Data([0x47, 0x72, 0xF6, 0xDF, 0x65, 0x0A]).write(to: project.url("datei.tex"))
        #expect(await session.syncWithDisk() == .reloaded)
        #expect(session.textStorage.string == "Größe\n")

        try FileManager.default.removeItem(at: project.url("datei.tex"))
        #expect(await session.syncWithDisk() == .missing)
    }
}
