import AppKit

/// ⌘-Klick auf Verweise, Zitate und Dateipfade auf App-Ebene.
extension AppModel {
    /// Springt zum Ziel eines ⌘-Klicks. Gibt es das Ziel nicht (Tippfehler im Schlüssel), piept es.
    func jump(to target: JumpTarget) {
        switch target {
        case let .label(key):
            guard let entry = completionProvider.allLabels().first(where: { $0.label == key }) else { return NSSound.beep() }
            Task { await editor.open(entry.file, line: entry.line) }
        case let .citation(key):
            guard let entry = completionProvider.index.catalog.bibEntries.first(where: { $0.key == key }), let file = entry.file else {
                return NSSound.beep()
            }
            Task { await editor.open(file, line: entry.line) }
        case let .file(path):
            let bases = [project.mainFileURL?.deletingLastPathComponent(), editor.current?.url.deletingLastPathComponent()].compactMap { $0 }
            guard let file = JumpTargetFinder.resolveFile(path, bases: bases) else { return NSSound.beep() }
            Task { await editor.open(file) }
        }
    }
}
