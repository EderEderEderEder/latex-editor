import AppKit

/// Einfügen-Fenster und „Quelle anlegen“ auf App-Ebene.
extension AppModel {
    // MARK: Einfügen

    func presentInsert(_ kind: InsertionKind? = nil) {
        let files = project.tree?.collectFiles().map(\.url) ?? []
        insertion.present(
            kind: kind ?? insertion.kind,
            selectedText: kind?.usesSelectionAsContent ?? (insertion.kind.usesSelectionAsContent) ? editor.selectedText : "",
            root: project.rootURL,
            files: files,
            mainFile: project.mainFileURL
        )
    }

    /// Mit offenem Projekt geht das Fenster immer auf. Ohne .tex-Datei vorne lässt sich nur eine Quelle anlegen
    /// (sie kommt in die .bib); die übrigen Bausteine brauchen die Cursorposition.
    func canPresentInsert(_ kind: InsertionKind) -> Bool {
        project.rootURL != nil && (kind == .source || editor.canInsert)
    }

    /// Kopiert ggf. das Bild nach `images/`, setzt den Code an die Cursorposition und schließt das Fenster.
    func performInsert() async {
        // Erst den Katalog abwarten: Labels müssen eindeutig sein, der Bildpfad hängt von \graphicspath ab.
        await insertion.waitForCatalog()
        let kind = insertion.kind
        if kind == .source {
            await performSourceInsert()
            return
        }
        do {
            let reference = kind == .image ? try insertion.prepareImageReference() : ""
            let text = insertion.generate(imageReference: reference)
            guard editor.insert(text, isBlock: kind.isBlock, replacesSelection: kind.usesSelectionAsContent) else {
                insertion.errorMessage = InsertStore.needsTeXMessage
                return
            }
            insertion.isPresented = false
            if kind == .image { project.reloadTree() }
        } catch {
            insertion.errorMessage = error.localizedDescription
        }
    }

    /// Neue Quelle: Eintrag ans Ende der Literaturdatei, danach auf Wunsch `\cite` an der Cursorposition.
    func performSourceInsert() async {
        guard case let .success(draft) = insertion.sourceDraft, let file = insertion.bibliographyFile else {
            insertion.errorMessage = insertion.validationMessage
            return
        }
        guard !insertion.source.citeAfterInsert || editor.canInsert else {
            insertion.errorMessage = InsertStore.citeNeedsTeXMessage
            return
        }
        do {
            try await appendToBibliography(draft.entry, file: file)
        } catch {
            insertion.errorMessage = "\(file.lastPathComponent) konnte nicht geschrieben werden: \(error.localizedDescription)"
            return
        }
        if insertion.source.citeAfterInsert {
            editor.insert(insertion.generate(imageReference: ""), isBlock: false, replacesSelection: false)
        }
        insertion.source = SourceSettings(mode: insertion.source.mode, type: insertion.source.type, language: insertion.source.language,
                                          citeAfterInsert: insertion.source.citeAfterInsert)
        insertion.isPresented = false
        await reloadCompletionIndex(immediately: true)
    }

    /// Offen und geändert: in den Editor (rückgängig mit ⌘Z, der Nutzer speichert). Sonst auf die Platte;
    /// eine offene, unveränderte Datei übernimmt den neuen Stand.
    func appendToBibliography(_ entry: String, file: URL) async throws {
        if let session = editor.session(for: file), session.isDirty {
            let text = session.textStorage.string
            session.replaceText(with: text + BibliographyFile.appendix(for: entry, after: text), actionName: "Quelle anlegen")
            return
        }
        // Im Hintergrund lesen und schreiben. Nicht lesbar heißt Fehler, nie „leer“: Sonst bestünde die Datei danach
        // nur noch aus dem neuen Eintrag.
        try await Task.detached(priority: .userInitiated) {
            let existing = FileManager.default.fileExists(atPath: file.path) ? try ProjectText.readForEditing(file) : ("", .utf8)
            try (existing.text + BibliographyFile.appendix(for: entry, after: existing.text))
                .write(to: file, atomically: true, encoding: existing.encoding)
        }.value
        if let session = editor.session(for: file) { await session.syncWithDisk() }
    }
}
