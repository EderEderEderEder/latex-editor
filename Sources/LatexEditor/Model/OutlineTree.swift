import Foundation

/// Knoten der hierarchischen Gliederung. `children == nil` bedeutet Blatt.
struct OutlineNode: Identifiable, Hashable, Sendable {
    let entry: OutlineEntry
    var children: [OutlineNode]?

    var id: String { entry.id }
}

enum OutlineTree {
    /// Baut aus der flachen Gliederung (Dokumentreihenfolge) einen Baum: chapter > section > subsection.
    /// Fehlt eine Ebene (subsection direkt nach chapter), hängt der Eintrag am nächsthöheren vorhandenen.
    static func build(_ entries: [OutlineEntry]) -> [OutlineNode] {
        var index = 0
        return nodes(from: entries, index: &index, parentLevel: nil)
    }

    private static func nodes(
        from entries: [OutlineEntry],
        index: inout Int,
        parentLevel: OutlineEntry.Level?
    ) -> [OutlineNode] {
        var result: [OutlineNode] = []
        while index < entries.count {
            let entry = entries[index]
            if let parentLevel, entry.level.rawValue <= parentLevel.rawValue { break }
            index += 1
            let children = nodes(from: entries, index: &index, parentLevel: entry.level)
            result.append(OutlineNode(entry: entry, children: children.isEmpty ? nil : children))
        }
        return result
    }

    /// Abschnitt, in dem eine Cursorposition liegt: der letzte Eintrag derselben Datei bis zu dieser Zeile.
    /// Steht der Cursor vor der ersten Überschrift der Datei, gilt der letzte Eintrag davor in
    /// Dokumentreihenfolge. Kommt die Datei in der Gliederung nicht vor, gibt es keinen Abschnitt.
    static func currentEntry(in entries: [OutlineEntry], file: URL, line: Int) -> OutlineEntry? {
        let file = file.standardizedFileURL
        var result: OutlineEntry?
        var hasSeenFile = false
        for entry in entries {
            if entry.fileURL == file {
                hasSeenFile = true
                if entry.line <= line { result = entry }
            } else if !hasSeenFile {
                result = entry
            }
        }
        return hasSeenFile ? result : nil
    }

    /// Die Überschriften, in denen `line` liegt, von außen nach innen (Kapitel › Abschnitt › Unterabschnitt). Steht vor
    /// der ersten Überschrift der Datei, gelten die Überschriften der Dateien davor (Gliederung in Dokumentreihenfolge).
    static func sectionChain(in entries: [OutlineEntry], file: URL, line: Int) -> [OutlineEntry] {
        guard let current = currentEntry(in: entries, file: file, line: line),
              var index = entries.firstIndex(where: { $0.id == current.id }) else { return [] }
        var chain = [current]
        var level = current.level
        while index > 0, level != .chapter {
            index -= 1
            guard entries[index].level.rawValue < level.rawValue else { continue }
            chain.insert(entries[index], at: 0)
            level = entries[index].level
        }
        return chain
    }
}
