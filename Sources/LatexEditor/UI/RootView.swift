import SwiftUI

enum ViewMode: String, CaseIterable {
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
    private static let editorMinWidth: CGFloat = 320
    private static let pdfMinWidth: CGFloat = 280
    private static let sidebarWidths = (min: CGFloat(200), ideal: CGFloat(270), max: CGFloat(450))

    let model: AppModel

    @AppStorage("viewMode") private var viewMode = ViewMode.split
    /// Nur für die Breite der Seitenleiste; die Views lesen den Zoom aus der Umgebung
    @AppStorage(InterfaceZoom.key) private var zoom = InterfaceZoom.standard
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var isCreatingBranch = false
    @State private var newBranchName = ""

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(
                    min: Self.sidebarWidths.min * zoom, ideal: Self.sidebarWidths.ideal * zoom, max: Self.sidebarWidths.max * zoom
                )
        } detail: {
            workspace
        }
        .interfaceZoomRoot()
        .navigationTitle(model.project.rootURL?.lastPathComponent ?? "LatexEditor")
        .toolbar { toolbarContent }
        .task { await model.restoreLastProject() }
        .sheet(isPresented: logBinding) { BuildLogSheet(build: model.build) }
        .sheet(item: promptBinding) { prompt in NameSheet(model: model, prompt: prompt) }
        .sheet(item: labelRenameBinding) { prompt in LabelRenameSheet(model: model, prompt: prompt) }
        .alert("Hinweis", isPresented: noticeBinding) {
            Button("OK") { model.fileActions.notice = nil }
        } message: {
            Text(model.fileActions.notice ?? "")
        }
        .sheet(item: paletteBinding) { palette in
            switch palette {
            case .quickOpen: QuickOpenSheet(model: model)
            case .goToLine: GoToLineSheet(model: model)
            }
        }
        .alert("Datei", isPresented: fileErrorBinding) {
            Button("OK") { model.fileActions.errorMessage = nil }
        } message: {
            Text(model.fileActions.errorMessage ?? "")
        }
        .sheet(isPresented: insertBinding) {
            InsertSheet(
                store: model.insertion, canInsert: model.editor.canInsert,
                insert: { Task { await model.performInsert() } }
            )
        }
        .alert("Neuer Branch", isPresented: $isCreatingBranch) {
            TextField("Name, z. B. kapitel-3", text: $newBranchName)
            Button("Anlegen und wechseln") { Task { await model.createBranch(named: newBranchName) } }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Der Branch beginnt beim aktuellen Stand; nicht committete Änderungen kommen mit.")
        }
        .alert("Git", isPresented: gitErrorBinding) {
            Button("OK") { model.git.errorMessage = nil }
        } message: {
            Text(model.git.errorMessage ?? "")
        }
        .alert("Fehler", isPresented: errorBinding) {
            Button("OK") { model.editor.errorMessage = nil }
        } message: {
            Text(model.editor.errorMessage ?? "")
        }
    }

    private var workspace: some View {
        HSplitView {
            if viewMode != .pdfOnly {
                EditorPane(model: model)
                    .frame(minWidth: Self.editorMinWidth, maxWidth: .infinity, maxHeight: .infinity)
            }
            if viewMode != .editorOnly {
                PDFPane(store: model.pdf, synctex: model.synctex)
                    .frame(minWidth: Self.pdfMinWidth, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // HSplitView übernimmt sonst nur die ideale Höhe seiner Inhalte und wird vertikal zentriert.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
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
                BranchMenu(model: model) {
                    newBranchName = ""
                    isCreatingBranch = true
                }
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

    private var promptBinding: Binding<NamePrompt?> {
        Binding(get: { model.fileActions.prompt }, set: { model.fileActions.prompt = $0 })
    }

    private var labelRenameBinding: Binding<LabelRenamePrompt?> {
        Binding(get: { model.fileActions.labelRename }, set: { model.fileActions.labelRename = $0 })
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
