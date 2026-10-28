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
    @AppStorage(ViewMode.storageKey) private var viewMode = ViewMode.split
    @AppStorage(EditorSettings.Key.showsColumnGuide) private var showsColumnGuide = false
    @AppStorage(EditorSettings.Key.showsStickyHeading) private var showsStickyHeading = true

    /// Schalter der Ansicht: Wert speichern und den Editor benachrichtigen (wie im Einstellungsfenster)
    private func viewSetting(_ binding: Binding<Bool>) -> Binding<Bool> {
        Binding(get: { binding.wrappedValue }, set: {
            binding.wrappedValue = $0
            EditorSettings.didChange(affectsText: false)
        })
    }

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
            editorCommand("Verwendungen anzeigen", #selector(LatexTextView.showUsages(_:)), key: "u", modifiers: [.command, .option])
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
            Divider()
            // ⌘Z gilt im Dateibaum ebenfalls; hier auch mit dem Fokus im Editor
            Button(model.fileActions.undoTitle.map { "„\($0)“ rückgängig machen" } ?? "Dateioperation rückgängig machen") {
                model.undoFileOperation()
            }
            .keyboardShortcut("z", modifiers: [.command, .option])
            .disabled(model.fileActions.undoTitle == nil)
            Button(model.fileActions.redoTitle.map { "„\($0)“ wiederholen" } ?? "Dateioperation wiederholen") {
                model.redoFileOperation()
            }
            .keyboardShortcut("z", modifiers: [.command, .option, .shift])
            .disabled(model.fileActions.redoTitle == nil)
        }
        // Die App druckt nicht: ⌘P gehört „Schnell öffnen“
        CommandGroup(replacing: .printItem) {}
        CommandGroup(after: .sidebar) {
            Divider()
            // Jeder Toolbar-Befehl auch im Menü (HIG `toolbars.md › Desktop`)
            ForEach(Array(ViewMode.allCases.enumerated()), id: \.element) { index, mode in
                Toggle(mode.title, isOn: Binding(get: { viewMode == mode }, set: { if $0 { viewMode = mode } }))
                    .keyboardShortcut(KeyEquivalent(Character(String(index + 1))))
            }
            Divider()
            SidebarTabCommands(model: model)
            Divider()
            Toggle("Spaltenhilfslinie", isOn: viewSetting($showsColumnGuide))
            Toggle("Aktuellen Abschnitt oben anzeigen", isOn: viewSetting($showsStickyHeading))
            Menu("Einklappen") {
                editorCommand("Zuklappen", #selector(LatexTextView.foldAtCursor(_:)), key: .leftArrow, modifiers: [.command, .option])
                editorCommand("Aufklappen", #selector(LatexTextView.unfoldAtCursor(_:)), key: .rightArrow, modifiers: [.command, .option])
                editorCommand("Alles zuklappen", #selector(LatexTextView.foldAllRegions(_:)), key: .leftArrow, modifiers: [.command, .option, .shift])
                editorCommand("Alles aufklappen", #selector(LatexTextView.unfoldAllRegions(_:)), key: .rightArrow, modifiers: [.command, .option, .shift])
            }
            Menu("PDF") {
                Button("Vergrößern") { model.pdf.zoomIn() }
                Button("Verkleinern") { model.pdf.zoomOut() }
                Button("An Breite anpassen") { model.pdf.zoomToFitWidth() }
            }
            .disabled(model.pdf.pdfURL == nil)
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
            Button("Bildbibliothek …") { model.presentImageLibrary() }
                .keyboardShortcut("i", modifiers: [.command, .option])
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
        }
        // Eigene Befehle in eigenen Menüs (HIG `the-menu-bar.md › App-specific menus`)
        CommandMenu("Kompilieren") {
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
            Divider()
            Toggle("Beim Speichern kompilieren", isOn: Binding(
                get: { model.build.compileOnSave },
                set: { model.build.compileOnSave = $0 }
            ))
            Button("Protokoll anzeigen") { model.build.isLogVisible = true }
            Button("Hilfsdateien löschen …") { Task { await model.cleanBuildFiles() } }
                .disabled(model.project.mainFileURL == nil || model.build.status == .running)
        }
        CommandMenu("Git") {
            GitCommands(model: model)
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

/// Seitenleisten-Tabs im Menü Darstellung, mit ⌥⌘1 bis ⌥⌘5
private struct SidebarTabCommands: View {
    let model: AppModel

    var body: some View {
        ForEach(Array(SidebarTab.allCases.enumerated()), id: \.element) { index, tab in
            Button(tab.menuTitle) { model.sidebar.tab = tab }
                .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: [.command, .option])
                .disabled(model.project.rootURL == nil || (tab == .changes && !model.git.isReady))
        }
    }
}

/// Menü Git: dieselben Befehle wie das Branch-Menü in der Toolbar und der Änderungen-Tab
private struct GitCommands: View {
    let model: AppModel

    private var git: GitStore { model.git }

    var body: some View {
        Group { items }.disabled(!git.isReady)
    }

    @ViewBuilder
    private var items: some View {
        Button("Änderungen anzeigen") { model.sidebar.tab = .changes }
        Button("Committen …") { commit() }
            .disabled(git.isBusy)
        Divider()
        Menu("Branch wechseln") {
            ForEach(git.branches, id: \.self) { name in
                Toggle(name, isOn: Binding(get: { name == git.branch.head }, set: { _ in Task { await model.switchBranch(to: name) } }))
            }
        }
        .disabled(git.branches.isEmpty || git.isBusy)
        Button("Neuer Branch …") { git.isNamingNewBranch = true }
            .disabled(git.isBusy)
        Divider()
        Button("Abrufen") { Task { await model.fetchFromRemote() } }
            .disabled(!git.hasRemote || git.isBusy)
        Button("Pull") { Task { await model.pullFromRemote() } }
            .disabled(!git.hasRemote || git.branch.upstream == nil || git.isBusy)
        Button("Push") { Task { await model.pushToRemote() } }
            .disabled(!git.hasRemote || git.branch.head == nil || git.isBusy)
    }

    /// Ohne Nachricht erst zum Änderungen-Tab (dort steht das Feld), sonst wie ⌘↩ dort
    private func commit() {
        model.sidebar.tab = .changes
        guard !git.trimmedCommitMessage.isEmpty else { return }
        Task { await model.commitChanges() }
    }
}
