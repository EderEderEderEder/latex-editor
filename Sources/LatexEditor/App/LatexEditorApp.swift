import AppKit
import SwiftUI

@main
struct LatexEditorApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("LatexEditor", id: "main") {
            RootView(model: AppModel.shared)
        }
        .defaultSize(width: 1400, height: 860)
        .commands { AppCommands(model: AppModel.shared) }

        Settings {
            SettingsView(model: AppModel.shared)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        EditorSettings.applyAppearance()
        NSApp.activate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        AppModel.shared.confirmUnsavedChanges() ? .terminateNow : .terminateCancel
    }
}

struct AppCommands: Commands {
    let model: AppModel

    @AppStorage(InterfaceZoom.key) private var zoom = InterfaceZoom.standard

    var body: some Commands {
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Vervollständigen") { model.editor.requestCompletion() }
                .keyboardShortcut(" ", modifiers: .control)
                .disabled(!model.editor.canInsert)
            Divider()
            Button("Umbenennen …") { model.beginRename() }
                .keyboardShortcut("r", modifiers: [.command, .option])
                .disabled(model.editor.current == nil)
            Button("Im Projekt suchen …") { model.presentProjectSearch() }
                .keyboardShortcut("f", modifiers: [.command, .shift])
                .disabled(model.project.rootURL == nil)
            Button("Gehe zu Zeile …") { model.presentGoToLine() }
                .keyboardShortcut("l")
                .disabled(model.editor.current == nil)
            editorCommand("Kommentar ein/aus", #selector(LatexTextView.toggleComment(_:)), key: "/")
            editorCommand("Einrücken", #selector(LatexTextView.indentLines(_:)), key: "]")
            editorCommand("Ausrücken", #selector(LatexTextView.outdentLines(_:)), key: "[")
            editorCommand("Zeilen nach oben", #selector(LatexTextView.moveLinesUp(_:)), key: .upArrow, modifiers: .option)
            editorCommand("Zeilen nach unten", #selector(LatexTextView.moveLinesDown(_:)), key: .downArrow, modifiers: .option)
            editorCommand("Zeilen verdoppeln", #selector(LatexTextView.duplicateLines(_:)), key: .downArrow, modifiers: [.option, .shift])
            editorCommand("Zeilen löschen", #selector(LatexTextView.deleteLines(_:)), key: "k", modifiers: [.command, .shift])
        }
        CommandMenu("Format") {
            // ⌘B ist „Kompilieren“, deshalb Fett mit ⇧⌘B
            editorCommand("Fett (\\textbf)", #selector(LatexTextView.formatBold(_:)), key: "b", modifiers: [.command, .shift])
            editorCommand("Hervorheben (\\emph)", #selector(LatexTextView.formatEmphasis(_:)), key: "i")
            editorCommand("Schreibmaschine (\\texttt)", #selector(LatexTextView.formatMonospace(_:)), key: "t", modifiers: [.command, .shift])
        }
        CommandGroup(after: .toolbar) {
            // Editor und Oberfläche gemeinsam (Dialoge bleiben in Systemgröße)
            Button("Vergrößern") { InterfaceZoom.zoomIn() }
                .keyboardShortcut("+")
                .disabled(zoom >= InterfaceZoom.steps[InterfaceZoom.steps.count - 1])
            Button("Verkleinern") { InterfaceZoom.zoomOut() }
                .keyboardShortcut("-")
                .disabled(zoom <= InterfaceZoom.steps[0])
            Button("Originalgröße") { InterfaceZoom.reset() }
                .keyboardShortcut("0", modifiers: [.command, .option])
                .disabled(zoom == InterfaceZoom.standard)
        }
        CommandGroup(replacing: .newItem) {
            Button("Projekt öffnen …") { model.chooseProject() }
                .keyboardShortcut("o")
            RecentProjectsMenu(model: model, recent: model.recentProjects)
            Divider()
            Button("Neue Datei …") { model.beginNewFile() }
                .keyboardShortcut("n")
                .disabled(model.project.rootURL == nil)
            Button("Neuer Ordner …") { model.beginNewFolder() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(model.project.rootURL == nil)
            Divider()
            Button("Schnell öffnen …") { model.presentQuickOpen() }
                .keyboardShortcut("p")
                .disabled(model.project.rootURL == nil)
        }
        // Die App druckt nicht: ⌘P gehört „Schnell öffnen“
        CommandGroup(replacing: .printItem) {}
        CommandGroup(after: .sidebar) {
            Divider()
            Button("Im PDF zeigen") { model.showCursorInPDF() }
                .keyboardShortcut("j")
            Toggle("PDF folgt Cursor", isOn: Binding(
                get: { model.synctex.followCursor },
                set: { model.synctex.followCursor = $0 }
            ))
            Divider()
            Button("Nächster Tab") { model.editor.activateNextTab() }
                .keyboardShortcut("]", modifiers: [.command, .shift])
            Button("Vorheriger Tab") { model.editor.activatePreviousTab() }
                .keyboardShortcut("[", modifiers: [.command, .shift])
        }
        CommandMenu("Einfügen") {
            Button("Einfügeoptionen …") { model.presentInsert() }
                .keyboardShortcut("i", modifiers: [.command, .shift])
                .disabled(model.project.rootURL == nil)
            Divider()
            ForEach(InsertionKind.allCases) { kind in
                Button(kind.title) { model.presentInsert(kind) }
                    .disabled(!model.canPresentInsert(kind))
            }
        }
        CommandGroup(replacing: .saveItem) {
            Button("Speichern") { model.editor.saveCurrent() }
                .keyboardShortcut("s")
            Button("Alle speichern") { model.editor.saveAll() }
                .keyboardShortcut("s", modifiers: [.command, .option])
            Divider()
            Button("Tab schließen") { model.closeActiveTab() }
                .keyboardShortcut("w")
                .disabled(model.editor.tabs.isEmpty)
            Button("Alle Tabs schließen") { model.closeAllTabs() }
                .keyboardShortcut("w", modifiers: [.command, .option])
                .disabled(model.editor.tabs.isEmpty)
            Button("Fenster schließen") { NSApp.keyWindow?.performClose(nil) }
                .keyboardShortcut("w", modifiers: [.command, .shift])
            Divider()
            Button("Kompilieren") { model.compile() }
                .keyboardShortcut("b")
                .disabled(model.project.mainFileURL == nil)
            Button("Kompilieren abbrechen") { model.build.cancelBuild() }
                .keyboardShortcut(".")
                .disabled(model.build.status != .running)
            // Pfeiltasten statt F8/⌘': F8 ist auf Mac-Tastaturen oft Play, ⌘' liegt auf deutscher Tastatur auf ⇧#
            Button("Nächste Meldung") { model.showAdjacentIssue(1) }
                .keyboardShortcut(.downArrow, modifiers: [.command, .option])
                .disabled(model.build.issues.isEmpty)
            Button("Vorherige Meldung") { model.showAdjacentIssue(-1) }
                .keyboardShortcut(.upArrow, modifiers: [.command, .option])
                .disabled(model.build.issues.isEmpty)
            Toggle("Beim Speichern kompilieren", isOn: Binding(
                get: { model.build.compileOnSave },
                set: { model.build.compileOnSave = $0 }
            ))
            Button("Build-Log anzeigen") { model.build.isLogVisible = true }
            Button("Hilfsdateien löschen …") { Task { await model.cleanBuildFiles() } }
                .disabled(model.project.mainFileURL == nil || model.build.status == .running)
        }
    }
}

extension AppCommands {
    /// Menübefehl für den Editor mit dem Fokus (über die Responder-Kette)
    private func editorCommand(_ title: String, _ action: Selector, key: KeyEquivalent,
                               modifiers: EventModifiers = .command) -> some View {
        Button(title) { NSApp.sendAction(action, to: nil, from: nil) }
            .keyboardShortcut(key, modifiers: modifiers)
            .disabled(model.editor.current == nil)
    }
}

private struct RecentProjectsMenu: View {
    let model: AppModel
    let recent: RecentProjectsStore

    var body: some View {
        Menu("Zuletzt geöffnet") {
            ForEach(recent.paths, id: \.self) { path in
                Button(URL(fileURLWithPath: path).lastPathComponent) { model.openRecent(path) }
                    .help(path)
            }
            Divider()
            Button("Liste löschen") { recent.clear() }
        }
        .disabled(recent.paths.isEmpty)
    }
}
