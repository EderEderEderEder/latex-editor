import SwiftUI

/// Was das Filtersymbol im Dateibaum einstellt: welche Dateitypen der Baum zeigt (Häkchen = sichtbar) und ob er
/// Build-Hilfsdateien zeigt. Gruppiert nach Art der Datei; jede Endung nennt, wie viele Dateien es gibt.
struct FileFilterMenu: View {
    let project: ProjectStore

    private var sections: [FileTypeSection] {
        FileTypeCatalog.sections(in: project.tree, hidden: project.hiddenFileExtensions)
    }

    private var hiddenCount: Int { project.hiddenFileExtensions.count }
    private var isFiltering: Bool { hiddenCount > 0 || project.showsBuildFiles }

    var body: some View {
        Menu {
            ForEach(sections) { section in
                Section(section.title) {
                    ForEach(section.entries) { entry in
                        Toggle(entryTitle(entry), isOn: visibility(of: entry.fileExtension))
                    }
                }
            }
            Divider()
            Toggle("Build-Dateien zeigen", isOn: showsBuildFiles)
            Button("Alle Dateitypen zeigen", action: project.showAllFileTypes)
                .disabled(hiddenCount == 0)
        } label: {
            Image(systemName: "line.3.horizontal.decrease.circle" + (isFiltering ? ".fill" : ""))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .foregroundStyle(isFiltering ? Color.accentColor : .secondary)
        .help(helpText)
        .accessibilityLabel("Dateitypen filtern")
        .accessibilityValue(accessibilityValue)
    }

    private func entryTitle(_ entry: FileTypeEntry) -> String {
        entry.count > 0 ? "\(entry.title) (\(entry.count))" : entry.title
    }

    /// Häkchen = Typ ist sichtbar
    private func visibility(of fileExtension: String) -> Binding<Bool> {
        Binding(
            get: { !project.hiddenFileExtensions.contains(fileExtension) },
            set: { project.setFileType(fileExtension, hidden: !$0) }
        )
    }

    private var showsBuildFiles: Binding<Bool> {
        Binding(get: { project.showsBuildFiles }, set: { project.showsBuildFiles = $0 })
    }

    private var helpText: String {
        guard hiddenCount > 0 else { return "Dateitypen im Baum ein- und ausblenden" }
        return "\(hiddenCount == 1 ? "Ein Dateityp ist" : "\(hiddenCount) Dateitypen sind") ausgeblendet"
    }

    private var accessibilityValue: String {
        hiddenCount == 0 ? "Alle Dateitypen sichtbar" : "\(hiddenCount) ausgeblendet"
    }
}
