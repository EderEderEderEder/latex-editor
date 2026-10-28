import SwiftUI

enum ViewMode: String, CaseIterable {
    /// UserDefaults-Schlüssel (Toolbar und Menü Darstellung teilen ihn)
    static let storageKey = "viewMode"

    case editorOnly
    case split
    case pdfOnly

    var title: String {
        switch self {
        case .editorOnly: "Nur Editor"
        case .split: "Geteilt"
        case .pdfOnly: "Nur PDF"
        }
    }

    var symbolName: String {
        switch self {
        case .editorOnly: "doc.plaintext"
        case .split: "rectangle.split.2x1"
        case .pdfOnly: "doc.richtext"
        }
    }
}

struct RootView: View {
    private static let editorMinWidth: CGFloat = 180
    private static let pdfMinWidth: CGFloat = 150
    private static let sidebarWidths = (min: CGFloat(200), ideal: CGFloat(270), max: CGFloat(450))

    let model: AppModel

    @AppStorage(ViewMode.storageKey) private var viewMode = ViewMode.split
    /// Nur für die Breite der Seitenleiste; die Views lesen den Zoom aus der Umgebung
    @AppStorage(InterfaceZoom.key) private var zoom = InterfaceZoom.standard
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var newBranchName = ""
    @State private var sidebarPeek = SidebarPeek()

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(
                    min: Self.sidebarWidths.min * zoom, ideal: Self.sidebarWidths.ideal * zoom, max: Self.sidebarWidths.max * zoom
                )
        } detail: {
            workspace.overlay {
                SidebarPeekPanel(model: model, peek: sidebarPeek, width: Self.sidebarWidths.ideal * zoom)
            }
        }
        // Eigener Button (Hover zeigt die eingeklappte Seitenleiste); ⌃⌘S im Menü bleibt beim System
        .toolbar(removing: .sidebarToggle)
        .onChange(of: columnVisibility) { sidebarPeek.dismiss() }
        .interfaceZoomRoot()
        // Nicht der App-Name (HIG `toolbars.md › Titles`)
        .navigationTitle(model.project.rootURL?.lastPathComponent ?? "Kein Projekt")
        .toolbar { toolbarContent }
        .task { await model.restoreLastProject() }
        .onChange(of: model.git.isNamingNewBranch) { if model.git.isNamingNewBranch { newBranchName = "" } }
        .sheet(isPresented: logBinding) { BuildLogSheet(build: model.build) }
        .sheet(item: promptBinding) { prompt in NameSheet(model: model, prompt: prompt) }
        .sheet(item: renameBinding) { prompt in RenameSheet(model: model, prompt: prompt) }
        .alert(AlertText(model.fileActions.notice).title, isPresented: noticeBinding) {
            Button("OK") { model.fileActions.notice = nil }
        } message: {
            Text(AlertText(model.fileActions.notice).detail)
        }
        .sheet(item: paletteBinding) { palette in
            switch palette {
            case .quickOpen: QuickOpenSheet(model: model)
            case .goToLine: GoToLineSheet(model: model)
            case .imageLibrary: ImageLibrarySheet(model: model)
            }
        }
        .alert(AlertText(model.fileActions.errorMessage).title, isPresented: fileErrorBinding) {
            Button("OK") { model.fileActions.errorMessage = nil }
        } message: {
            Text(AlertText(model.fileActions.errorMessage).detail)
        }
        .sheet(isPresented: insertBinding) {
            InsertSheet(
                store: model.insertion, canInsert: model.editor.canInsert,
                insert: { Task { await model.performInsert() } }
            )
        }
        .alert("Neuer Branch", isPresented: newBranchBinding) {
            TextField("Name, z. B. kapitel-3", text: $newBranchName)
            Button("Anlegen und wechseln") { Task { await model.createBranch(named: newBranchName) } }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Der Branch beginnt beim aktuellen Stand; nicht committete Änderungen kommen mit.")
        }
        .alert(AlertText(model.git.errorMessage).title, isPresented: gitErrorBinding) {
            Button("OK") { model.git.errorMessage = nil }
        } message: {
            Text(AlertText(model.git.errorMessage).detail)
        }
        .alert(AlertText(model.editor.errorMessage).title, isPresented: errorBinding) {
            Button("OK") { model.editor.errorMessage = nil }
        } message: {
            Text(AlertText(model.editor.errorMessage).detail)
        }
    }

    private var workspace: some View {
        WorkspaceSplit(mode: viewMode, leadingMinWidth: Self.editorMinWidth, trailingMinWidth: Self.pdfMinWidth) {
            EditorPane(model: model).frame(maxHeight: .infinity)
        } trailing: {
            PDFPane(store: model.pdf, synctex: model.synctex).frame(maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // Der ausgeblendete Editor darf keine Tastatureingaben mehr bekommen
        .onChange(of: viewMode) { if viewMode == .pdfOnly { resignEditorFocus() } }
    }

    private func resignEditorFocus() {
        guard let window = NSApp.keyWindow, window.firstResponder is LatexTextView else { return }
        window.makeFirstResponder(nil)
    }


    private var isSidebarCollapsed: Bool { columnVisibility == .detailOnly }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            SidebarToggleButton(peek: sidebarPeek, isCollapsed: isSidebarCollapsed) {
                columnVisibility = isSidebarCollapsed ? .all : .detailOnly
            }
        }
        ToolbarItem(placement: .principal) {
            Picker("Ansicht", selection: $viewMode) {
                ForEach(ViewMode.allCases, id: \.self) { mode in
                    Label(mode.title, systemImage: mode.symbolName).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .help("Ansichtsmodus")
        }
        // Erst einfügen, wenn es einen Status gibt: Ein unsichtbares Element erschiene in der
        // macOS-26-Toolbar als leere Kapsel.
        if model.git.isReady {
            ToolbarItem(placement: .primaryAction) {
                BranchMenu(model: model) { model.git.isNamingNewBranch = true }
            }
        }
        if model.project.rootURL != nil {
            ToolbarItem(placement: .primaryAction) {
                BuildStatusView(build: model.build, sidebar: model.sidebar)
            }
        }
        ToolbarItem(placement: .primaryAction) {
            InsertMenu(model: model)
        }
        ToolbarItem(placement: .primaryAction) {
            CompileButton(model: model)
        }
    }

    private var newBranchBinding: Binding<Bool> {
        Binding(get: { model.git.isNamingNewBranch }, set: { model.git.isNamingNewBranch = $0 })
    }

    private var promptBinding: Binding<NamePrompt?> {
        Binding(get: { model.fileActions.prompt }, set: { model.fileActions.prompt = $0 })
    }

    private var renameBinding: Binding<RenamePrompt?> {
        Binding(get: { model.fileActions.rename }, set: { model.fileActions.rename = $0 })
    }

    private var noticeBinding: Binding<Bool> {
        Binding(get: { model.fileActions.notice != nil }, set: { if !$0 { model.fileActions.notice = nil } })
    }

    private var paletteBinding: Binding<Palette?> {
        Binding(get: { model.palette.active }, set: { model.palette.active = $0 })
    }

    private var fileErrorBinding: Binding<Bool> {
        Binding(
            get: { model.fileActions.errorMessage != nil },
            set: { if !$0 { model.fileActions.errorMessage = nil } }
        )
    }

    private var gitErrorBinding: Binding<Bool> {
        Binding(
            get: { model.git.errorMessage != nil },
            set: { if !$0 { model.git.errorMessage = nil } }
        )
    }

    private var insertBinding: Binding<Bool> {
        Binding(get: { model.insertion.isPresented }, set: { model.insertion.isPresented = $0 })
    }

    private var logBinding: Binding<Bool> {
        Binding(get: { model.build.isLogVisible }, set: { model.build.isLogVisible = $0 })
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { model.editor.errorMessage != nil },
            set: { if !$0 { model.editor.errorMessage = nil } }
        )
    }

}
