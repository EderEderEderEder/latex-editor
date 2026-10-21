import SwiftUI

// MARK: - Code, Gleichung, Liste

struct CodeSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Darstellung") {
                SettingRow("Sprache") {
                    Picker("", selection: $store.code.language) {
                        ForEach(CodeLanguage.all) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                SettingRow("Optionen") {
                    VStack(alignment: .leading, spacing: 6) {
                        Toggle("Zeilennummern", isOn: $store.code.lineNumbers)
                        Toggle("Als Programm-Float mit Beschriftung", isOn: $store.code.asFloat)
                    }
                }
            }
            if store.code.asFloat {
                CaptionCard(
                    caption: $store.code.caption, labelOverride: $store.code.labelOverride,
                    placement: $store.code.placement, automaticLabel: store.resolvedLabel(for: .code)
                )
            }
            SettingsCard("Code") {
                CodeEditorField(text: $store.code.content, minimumHeight: 130)
            }
        }
    }
}

struct EquationSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Art") {
                SettingRow("Umgebung") {
                    Picker("", selection: $store.equation.kind) {
                        ForEach(EquationKind.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                if store.equation.kind.isNumbered {
                    SettingRow("Label") {
                        TextField("", text: $store.equation.labelOverride, prompt: Text("optional, z. B. eq:einstein"))
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.body, design: .monospaced))
                    }
                }
            }
            SettingsCard("Formel (ohne $ … $)") {
                CodeEditorField(text: $store.equation.content, minimumHeight: 130)
            }
        }
    }
}

struct ListSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Art") {
                SettingRow("Liste") {
                    Picker("", selection: $store.list.kind) {
                        ForEach(ListKind.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                SettingRow("Punkte") {
                    Stepper(value: count, in: 1...ListSettings.maximumItems) {
                        Text("\(store.list.items.count)").monospacedDigit()
                    }
                }
            }
            SettingsCard("Texte (optional)") {
                ForEach(store.list.items.indices, id: \.self) { index in
                    SettingRow("\(index + 1).") {
                        TextField("", text: $store.list.items[index], prompt: Text("Punkt \(index + 1)"))
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }
        }
    }

    private var count: Binding<Int> {
        Binding(get: { store.list.items.count }, set: { store.list.resize(to: $0) })
    }
}

// MARK: - Verweis, Zitat

struct ReferenceSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            if store.catalog.labels.isEmpty {
                SettingsCard {
                    Label("Im Projekt gibt es noch keine Labels. Tabellen, Bilder und Codeblöcke legen eines an.",
                          systemImage: "info.circle")
                        .foregroundStyle(.secondary)
                }
            } else {
                SettingsCard("Ziel") {
                    SettingRow("Label") {
                        Picker("", selection: $store.reference.label) {
                            ForEach(store.catalog.labels) { entry in
                                Text("\(entry.label)  (\(entry.file.lastPathComponent):\(entry.line))").tag(entry.label)
                            }
                        }
                        .labelsHidden()
                        .fixedSize()
                    }
                    SettingRow("Darstellung") {
                        Toggle("Mit Vorsatz („Abbildung~…“)", isOn: $store.reference.withPrefix)
                    }
                }
            }
        }
    }
}

struct CitationSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Angaben") {
                SettingRow("Seite") {
                    TextField("", text: $store.citation.note, prompt: Text("optional, z. B. S.~12"))
                        .textFieldStyle(.roundedBorder)
                }
            }
            if store.catalog.bibEntries.isEmpty {
                SettingsCard {
                    HStack {
                        Label("Die Literaturdatei hat noch keine Einträge.", systemImage: "info.circle")
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Neue Quelle anlegen …", systemImage: InsertionKind.source.symbolName) { store.kind = .source }
                    }
                }
            } else {
                SettingsCard("Einträge (mehrere mit ⌘ oder ⇧ wählen)") {
                    List(store.catalog.bibEntries, selection: keys) { entry in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(entry.key).fontWeight(.semibold)
                            if !entry.title.isEmpty {
                                Text(entry.title).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .tag(entry.key)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .frame(height: 220)
                    .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
                }
            }
        }
    }

    private var keys: Binding<Set<String>> {
        Binding(
            get: { Set(store.citation.keys) },
            set: { selected in
                let order = store.catalog.bibEntries.map(\.key)
                store.citation.keys = order.filter(selected.contains)
            }
        )
    }
}

struct SourceSettingsView: View {
    @Bindable var store: InsertStore

    var body: some View {
        SettingsStack {
            SettingsCard("Eingabe") {
                Picker("", selection: $store.source.mode) {
                    ForEach(SourceInputMode.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            }
            if store.source.mode == .form { form } else { bibtex }
            SettingsCard("Im Text") {
                SettingRow("Zitieren") {
                    Toggle("Gleich an der Cursorposition zitieren (\\cite)", isOn: $store.source.citeAfterInsert)
                }
                if store.source.citeAfterInsert {
                    SettingRow("Seite") {
                        TextField("", text: $store.source.note, prompt: Text("optional, z. B. S.~12"))
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        SettingsCard("Art") {
            SettingRow("Typ") {
                Picker("", selection: $store.source.type) {
                    ForEach(SourceType.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
            }
            SettingRow("Sprache") {
                Picker("", selection: $store.source.language) {
                    ForEach(SourceLanguage.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
            }
        }
        SettingsCard("Angaben (* = Pflicht)") {
            SettingRow(store.source.type.requiresAuthor ? "Autor *" : "Autor") {
                TextField("", text: $store.source.authors, prompt: Text("Max Mustermann; Erika Musterfrau"))
                    .textFieldStyle(.roundedBorder)
            }
            ForEach(store.source.type.fields, id: \.name) { field in
                SettingRow(field.isRequired ? field.title + " *" : field.title) {
                    TextField("", text: value(field.name), prompt: Text(field.placeholder))
                        .textFieldStyle(.roundedBorder)
                }
            }
            SettingRow("Schlüssel") {
                TextField("", text: $store.source.keyOverride, prompt: Text(automaticKey))
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    private var bibtex: some View {
        SettingsCard("BibTeX-Eintrag") {
            VStack(alignment: .leading, spacing: 6) {
                CodeEditorField(text: $store.source.bibtex, minimumHeight: 180)
                Text("Z. B. aus Google Scholar („Zitieren“ → BibTeX), vom Verlag oder aus einem Bibliothekskatalog. "
                     + "Der Schlüssel wird bei Bedarf angepasst (eindeutig, ohne Umlaute).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var automaticKey: String {
        if case let .success(draft) = store.sourceDraft { return "automatisch: \(draft.key)" }
        return "automatisch (Nachname + Jahr)"
    }

    private func value(_ name: String) -> Binding<String> {
        Binding(get: { store.source.values[name, default: ""] }, set: { store.source.values[name] = $0 })
    }
}
