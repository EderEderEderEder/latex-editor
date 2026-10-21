import AppKit
import CoreServices
import SwiftUI
import Foundation
import Testing
@testable import LatexEditor

@Suite("Gemeinsame LaTeX-Regeln: Kommentare, Maskierung, Dateien")
struct LatexSourceTests {
    @Test("Kommentarbeginn: % ja, \\% nein, \\\\% ja (Zeilenumbruch + Kommentar)")
    func commentStart() {
        func start(_ line: String) -> Int? {
            LatexComments.commentStart(in: line).map { line.distance(from: line.startIndex, to: $0) }
        }
        #expect(start("Text % Kommentar") == 5)
        #expect(start("50\\,\\% Rabatt") == nil)
        #expect(start("Ende\\\\% Kommentar") == 6)
        #expect(start("\\\\\\% kein Kommentar") == nil)
        #expect(start("ohne") == nil)
    }

    @Test("Maskieren: gleiche UTF-16-Länge, Kommentar endet auch bei \\r\\n")
    func masking() {
        let text = "😀 a % weg 😀\r\nbleibt % weg\n\\% bleibt"
        let masked = LatexComments.masking(text)
        #expect(masked.utf16.count == text.utf16.count)
        #expect(masked.contains("bleibt") && !masked.contains("weg"))
        #expect(masked.hasSuffix("\\% bleibt"), "Escaptes % bleibt")
        #expect(masked.contains("\r\nbleibt"), "Bei \\r\\n beginnt eine neue Zeile")
    }

    @Test("Schnelle Prüfung an einer Position stimmt mit dem Kommentarbeginn überein")
    func positionCheck() {
        let line = "a \\% b % c" as NSString
        #expect(!LatexComments.isInComment(line, lineStart: 0, location: 5))
        #expect(LatexComments.isInComment(line, lineStart: 0, location: 9))
    }

    @Test("Die Byte-Variante der Gliederung folgt derselben Regel", arguments: [
        "Text % Kommentar", "50\\% Rabatt", "Ende\\\\% Kommentar", "\\\\\\% nein", "kein Kommentar", "%", "\\section{A}% x",
    ])
    func outlineAgrees(line: String) {
        let viaString = LatexComments.commentStart(in: line).map { line.utf8.distance(from: line.utf8.startIndex, to: $0) }
        #expect(OutlineParser.commentStart(in: Array(line.utf8)) == viaString)
    }

    @Test("\\verb mit % versteckt nicht mehr den Rest der Zeile")
    func verbBeforeComments() {
        let keys = LatexReferences.scan("Mit \\verb|%| siehe \\ref{fig:a}.").map(\.key)
        #expect(keys == ["fig:a"])
        #expect(LatexReferences.scan("% \\verb|x| \\ref{weg}").isEmpty, "Im Kommentar zählt weiter nichts")
    }

    @Test("Dateien: UTF-8, sonst Latin-1 (mit Kodierung zum Zurückschreiben)")
    func decoding() throws {
        let latin1 = try #require("Größe".data(using: .isoLatin1))
        #expect(ProjectText.decode(latin1)?.text == "Größe")
        #expect(ProjectText.decode(latin1)?.encoding == .isoLatin1)
        #expect(ProjectText.decode(Data("Größe".utf8))?.encoding == .utf8)
    }
}

@Suite("Dateiereignisse: Wann der Baum neu geladen wird")
struct FileEventTreeTests {
    private let created = FSEventStreamEventFlags(kFSEventStreamEventFlagItemCreated | kFSEventStreamEventFlagItemIsFile)
    private let renamed = FSEventStreamEventFlags(kFSEventStreamEventFlagItemRenamed | kFSEventStreamEventFlagItemIsFile)
    private let modified = FSEventStreamEventFlags(kFSEventStreamEventFlagItemModified | kFSEventStreamEventFlagItemIsFile)

    private func changesTree(_ path: String, _ flags: FSEventStreamEventFlags, inTree: Bool, exists: Bool) -> Bool {
        FileEvent(path: path, flags: flags).changesTree(isInTree: { _ in inTree }, exists: { _ in exists })
    }

    @Test("Build-Hilfsdateien und Inhaltsänderungen nie; atomares Speichern einer vorhandenen Datei nicht")
    func noReload() {
        for name in ["main.aux", "main.log", "main.fls", "main.synctex.gz", "main.bbl", "main.run.xml"] {
            #expect(!changesTree("/p/\(name)", created, inTree: false, exists: true), "\(name)")
        }
        #expect(!changesTree("/p/kapitel.tex", renamed, inTree: true, exists: true), "⌘S ersetzt die Datei per Umbenennen")
        #expect(!changesTree("/p/kapitel.tex", modified, inTree: true, exists: true))
    }

    @Test("Neue, gelöschte und umbenannte Dateien im Baum sowie Ordner schon")
    func reload() {
        #expect(changesTree("/p/neu.tex", created, inTree: false, exists: true))
        #expect(changesTree("/p/weg.tex", renamed, inTree: true, exists: false))
        #expect(changesTree("/p/bild.png", created, inTree: false, exists: true))
        let folder = FSEventStreamEventFlags(kFSEventStreamEventFlagItemCreated | kFSEventStreamEventFlagItemIsDir)
        #expect(changesTree("/p/kapitel", folder, inTree: false, exists: true))
    }
}

@Suite("Index und Prüfungen: nur bei echter Änderung", .serialized)
@MainActor
struct IndexChangeTests {
    @Test("Gleicher Index nach erneutem Lesen meldet sich nicht")
    func unchangedIndexIsQuiet() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", "\\documentclass{report}\n\\label{a}\n")
        let provider = CompletionProvider()
        var notifications = 0
        provider.onIndexChanged = { notifications += 1 }

        await provider.reload(files: [main], projectRoot: project.root, mainFile: main)
        await provider.reload(files: [main], projectRoot: project.root, mainFile: main)
        #expect(notifications == 1)
        try project.write("main.tex", "\\documentclass{report}\n\\label{a}\n\\label{b}\n")
        await provider.reload(files: [main], projectRoot: project.root, mainFile: main)
        #expect(notifications == 2)
    }

    @Test("Ein neuer Index prüft Verweise neu, Schreibhinweise nur nach einer Textänderung")
    func hintsOnlyAfterTextChange() async throws {
        let store = ReferenceCheckStore()
        var labels: Set<String> = []
        store.knownLabels = { labels }
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/index-\(UUID().uuidString).tex"), text: "Das das \\ref{x}.")
        store.schedule(session, immediately: true)
        await store.waitUntilIdle()
        #expect(store.problems(for: session.url).map(\.key) == ["x"])
        #expect(store.hints(for: session.url).map(\.kind) == [.repeatedWord])

        labels = ["x"]
        store.indexChanged(.empty, isLoaded: true, openSessions: [session])
        await store.waitUntilIdle()
        #expect(store.problems(for: session.url).isEmpty, "Verweise neu geprüft")
        #expect(store.hints(for: session.url).map(\.kind) == [.repeatedWord], "Hinweise unverändert übernommen")

        session.textStorage.replaceCharacters(in: NSRange(location: 0, length: 4), with: "")
        store.schedule(session, immediately: true)
        await store.waitUntilIdle()
        #expect(store.hints(for: session.url).isEmpty, "Nach der Textänderung neu berechnet")
    }
}

@Suite("Sicherung: Fehler werden gemeldet", .serialized)
@MainActor
struct RecoveryFailureTests {
    @Test("Schlägt das Schreiben fehl, kommt genau eine Meldung pro Fehlerserie")
    func reportsOnce() async throws {
        let blocker = try TemporaryProject()
        defer { blocker.remove() }
        let notADirectory = try blocker.write("datei", "kein Ordner")
        let store = RecoveryStore(directory: notADirectory.appendingPathComponent("Wiederherstellung"))
        var messages: [String] = []
        store.onWriteFailure = { messages.append($0) }
        let backup = RecoveryBackup(path: "/tmp/kapitel.tex", savedAt: Date(), text: "Text")

        await store.write(backup)
        await store.write(backup)
        #expect(messages.count == 1)
        #expect(messages.first?.contains("kapitel.tex") == true)

        store.directory = blocker.url("ok")
        await store.write(backup)
        store.directory = notADirectory.appendingPathComponent("Wiederherstellung")
        await store.write(backup)
        #expect(messages.count == 2, "Nach einem Erfolg wird ein neuer Fehler wieder gemeldet")
    }
}

@Suite("Eigenes AppModel")
@MainActor
struct SeparateAppModelTests {
    @Test("Eine eigene Instanz entsteht unabhängig vom gemeinsamen Modell und wird vollständig freigegeben")
    func instanceIsReleased() {
        weak var released: AppModel?
        do {
            let model = AppModel()
            released = model
            #expect(model !== AppModel.shared)
        }
        #expect(released == nil, "Kein Speicherzyklus: Beobachter und Rückrufe halten das Modell nicht fest")
    }
}

@Suite("Umgebungspaar ohne Maskieren des ganzen Dokuments")
struct EnvironmentPairSearchTests {
    @Test("Auskommentierte \\begin/\\end zählen nicht; großes Dokument bleibt schnell (Rechtsklick auf dem Main-Thread)")
    func commentsAndSpeed() {
        let filler = String(repeating: "Ein Absatz mit Text und \\emph{Betonung}.\n", count: 5_000)
        let text = "\\begin{itemize}\n% \\end{itemize}\n\\item a\n" + filler + "\\end{itemize}\n" as NSString
        let clock = ContinuousClock()
        var pair: EnvironmentPair?
        let duration = clock.measure { pair = EnvironmentNames.pair(at: 8, in: text) }
        #expect(pair?.end.location == text.range(of: "\\end{itemize}", options: .backwards).location + 5)
        #expect(EnvironmentNames.pair(at: text.range(of: "\\end{itemize}", options: .backwards).location + 6, in: text)?.begin.location == 7)
        #expect(EnvironmentNames.pair(at: text.range(of: "% \\end").location + 4, in: text) == nil, "Im Kommentar kein Paar")
        // vorher wurde dafür das ganze Dokument maskiert
        print("⏱ Umgebungspaar über 205.000 Zeichen: \(duration)")
        #expect(duration < .milliseconds(100), "\(duration)")
    }
}

@Suite("Einstellungen: nur Nötiges neu", .serialized)
@MainActor
struct SettingsNotificationTests {
    @Test("Ansichts-Einstellungen lösen kein Neu-Setzen der Schrift aller Dateien aus")
    func viewOnlyChange() {
        var fontChanges = 0
        var viewChanges = 0
        let center = NotificationCenter.default
        let tokens = [
            center.addObserver(forName: EditorAppearance.fontDidChange, object: nil, queue: nil) { _ in fontChanges += 1 },
            center.addObserver(forName: EditorSettings.viewDidChange, object: nil, queue: nil) { _ in viewChanges += 1 },
        ]
        defer { tokens.forEach(center.removeObserver) }
        EditorSettings.didChange(affectsText: false)
        #expect(fontChanges == 0 && viewChanges == 1)
        EditorSettings.didChange(affectsText: true)
        #expect(fontChanges == 1 && viewChanges == 1)
    }

    @Test("Ein Editor meldet seine Beobachter beim Freigeben ab und wird freigegeben")
    func coordinatorReleases() {
        weak var released: EditorCoordinator?
        // AppKit gibt beim Aufbau Objekte per Autorelease zurück; erst das Leeren des Pools zeigt, ob etwas hängen bleibt
        autoreleasepool {
            let coordinator = EditorCoordinator()
            _ = coordinator.makeScrollView()
            released = coordinator
        }
        #expect(released == nil)
        NotificationCenter.default.post(name: EditorSettings.viewDidChange, object: nil)
    }
}

@Suite("Teiler zwischen Editor und PDF")
struct WorkspaceSplitTests {
    private typealias Split = WorkspaceSplit<EmptyView, EmptyView>

    @Test("Breite folgt dem Anteil, beide Seiten behalten ihre Mindestbreite; zu schmal: halb-halb")
    func widths() {
        let minimums: (leading: CGFloat, trailing: CGFloat) = (320, 280)
        #expect(Split.leadingWidth(fraction: 0.5, total: 1_000, minimums: minimums) == 500)
        #expect(Split.leadingWidth(fraction: 0.1, total: 1_000, minimums: minimums) == 320)
        #expect(Split.leadingWidth(fraction: 0.95, total: 1_000, minimums: minimums) == 720)
        #expect(Split.leadingWidth(fraction: 0.8, total: 500, minimums: minimums) == 250)
        #expect(Split.grabWidth >= 12, "Deutlich breiter als der Teiler von HSplitView")
    }
}
