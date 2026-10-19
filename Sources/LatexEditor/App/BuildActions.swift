import AppKit

/// Kompilieren auf App-Ebene: durch die Meldungen springen, Hilfsdateien aufräumen.
extension AppModel {
    /// Ob die Meldung eine Datei im Projekt betrifft (Meldungen aus Paketen bleiben Information).
    func canOpen(_ issue: BuildIssue) -> Bool {
        guard let file = issue.fileURL else { return false }
        guard let root = project.rootURL else { return false }
        return file.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/")
    }

    /// Ziele von „Nächste/Vorherige Meldung“: Fehler und Warnungen in Projektdateien, in der Reihenfolge der Liste.
    /// Überfüllte und unterfüllte Boxen bleiben außen vor, sonst bestimmen sie in einer langen Arbeit die ganze Tour.
    var navigableIssues: [BuildIssue] {
        build.issues.filter { $0.severity != .badBox && canOpen($0) }
    }

    /// `direction` 1 = weiter, −1 = zurück; nach der letzten Meldung geht es von vorn los.
    func showAdjacentIssue(_ direction: Int) {
        guard let issue = Self.adjacentIssue(in: navigableIssues, after: build.selectedIssueID, direction: direction) else {
            NSSound.beep()
            return
        }
        openIssue(issue)
    }

    /// Die Meldung vor bzw. nach `currentID` (ohne aktuelle: die erste bzw. letzte), mit Umlauf.
    static func adjacentIssue(in issues: [BuildIssue], after currentID: Int?, direction: Int) -> BuildIssue? {
        guard !issues.isEmpty else { return nil }
        guard let current = issues.firstIndex(where: { $0.id == currentID }) else {
            return direction > 0 ? issues[0] : issues[issues.count - 1]
        }
        return issues[(current + direction + issues.count) % issues.count]
    }

    /// Klick in der Fehlerliste oder Sprung per Tastatur: Meldung markieren und zur Zeile springen.
    func openIssue(_ issue: BuildIssue) {
        build.selectedIssueID = issue.id
        guard let file = issue.fileURL else {
            build.isLogVisible = true
            return
        }
        guard canOpen(issue) else { return }
        Task { await editor.open(file, line: issue.line) }
    }

    // MARK: Aufräumen

    /// „Hilfsdateien löschen“ (`latexmk -c`): aux, log, toc, bbl … Das PDF bleibt, alles wird beim
    /// nächsten Kompilieren neu erzeugt, deshalb genügt die Rückfrage ohne Sicherung.
    func cleanBuildFiles() async {
        guard let main = project.mainFileURL, build.status != .running, confirmCleanup() else { return }
        do {
            let status = try await LatexBuildRunner.clean(mainFile: main)
            if status != 0 { fileActions.errorMessage = "Aufräumen ist fehlgeschlagen (Exit-Code \(status))." }
        } catch LatexBuildError.toolchainMissing {
            fileActions.errorMessage = LatexToolchain.missingMessage
        } catch {
            fileActions.errorMessage = "Aufräumen ist fehlgeschlagen: \(error.localizedDescription)"
        }
    }

    static func showCleanupAlert() -> Bool {
        let alert = NSAlert()
        alert.messageText = "Hilfsdateien löschen?"
        alert.informativeText = "Gelöscht werden die beim Kompilieren erzeugten Hilfsdateien (.aux, .log, .toc, .bbl …). "
            + "Das PDF und deine Texte bleiben. Beim nächsten Kompilieren entstehen sie neu."
        alert.addButton(withTitle: "Löschen")
        alert.addButton(withTitle: "Abbrechen")
        return alert.runModal() == .alertFirstButtonReturn
    }
}
