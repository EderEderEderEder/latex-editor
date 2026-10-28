import Foundation

/// Liest den Dateibaum synchron. Muss außerhalb des Main-Threads aufgerufen werden.
enum FileTreeLoader {
    static func load(root: URL, showsBuildFiles: Bool = false) -> FileNode {
        Signposts.interval("FileTreeLoad") {
            scan(directory: root, showsBuildFiles: showsBuildFiles) ?? FileNode(url: root, children: [])
        }
    }

    private static func scan(directory: URL, showsBuildFiles: Bool) -> FileNode? {
        let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey]
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else { return nil }

        var children: [FileNode] = []
        for entry in entries {
            let values = try? entry.resourceValues(forKeys: Set(keys))
            if values?.isSymbolicLink == true { continue }
            if values?.isDirectory == true {
                guard let subtree = scan(directory: entry.standardizedFileURL, showsBuildFiles: showsBuildFiles) else { continue }
                // Ordner, die nur ausgeblendete Dateien enthalten (z. B. build/ mit .aux), bleiben weg;
                // wirklich leere Ordner (neu angelegt) werden gezeigt.
                let hasVisibleContent = !(subtree.children ?? []).isEmpty
                guard hasVisibleContent || isTrulyEmpty(entry) else { continue }
                children.append(subtree)
            } else if BuildArtifacts.isShownInTree(entry, showsBuildFiles: showsBuildFiles) {
                children.append(FileNode(url: entry.standardizedFileURL, children: nil))
            }
        }
        children.sort(by: isOrderedBefore)
        return FileNode(url: directory, children: children)
    }

    private static func isTrulyEmpty(_ directory: URL) -> Bool {
        let entries = try? FileManager.default.contentsOfDirectory(atPath: directory.path)
        return entries?.allSatisfy { $0 == ".DS_Store" } ?? false
    }

    private static func isOrderedBefore(_ lhs: FileNode, _ rhs: FileNode) -> Bool {
        if lhs.isDirectory != rhs.isDirectory { return lhs.isDirectory }
        return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
    }
}
