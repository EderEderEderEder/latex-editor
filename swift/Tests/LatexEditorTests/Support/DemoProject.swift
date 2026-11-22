import Foundation
import Testing

/// Das Demo-Projekt `shared/Testdaten/HgbDemo`: eigene Nachbildung der HgbThesis-Vorlage mit Kapiteln, Bild, Tabelle,
/// Code, Literatur und absichtlich einem unbekannten Verweis. Tests benutzen nur Kopien davon; die echte
/// Abschlussarbeit (`../Thesis`) wird nie angefasst, auch nicht lesend.
enum DemoProject {
    /// `swift/Tests/LatexEditorTests/Support/DemoProject.swift` → Repo-Wurzel; die Testdaten liegen in `shared/`
    static let template = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("shared/Testdaten/HgbDemo", isDirectory: true)

    static var exists: Bool {
        FileManager.default.fileExists(atPath: template.appendingPathComponent("hgbthesis.cls").path)
    }

    /// Kopiert alle Dateien der Vorlage in einen leeren Ordner (ohne Build-Dateien).
    static func copy(to destination: URL) throws {
        let manager = FileManager.default
        let skippedExtensions: Set<String> = ["aux", "log", "pdf", "gz", "toc", "out", "bbl", "bcf", "blg", "xml", "fls", "fdb_latexmk", "lof", "lot"]
        let enumerator = try #require(manager.enumerator(at: template, includingPropertiesForKeys: [.isDirectoryKey]))
        for case let url as URL in enumerator {
            let relative = String(url.path.dropFirst(template.path.count + 1))
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
            let target = destination.appendingPathComponent(relative)
            if isDirectory {
                try manager.createDirectory(at: target, withIntermediateDirectories: true)
            } else if !skippedExtensions.contains(url.pathExtension) {
                try manager.copyItem(at: url, to: target)
            }
        }
    }
}
