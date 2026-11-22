import Foundation

/// Findet die Hauptdatei: erste .tex mit \documentclass (Wurzelebene, main.tex zuerst),
/// sonst main.tex im Projektordner.
enum MainFileDetector {
    private static let fallbackName = "main.tex"
    private static let headerReadLimit = 64 * 1024

    static func detect(in tree: FileNode) -> URL? {
        let candidates = tree.collectFiles()
            .filter { FileKind(url: $0.url) == .tex }
            .sorted(by: isPreferred)

        if let match = candidates.first(where: { declaresDocumentClass($0.url) }) {
            return match.url
        }
        let fallback = tree.url.appendingPathComponent(fallbackName)
        return FileManager.default.fileExists(atPath: fallback.path) ? fallback.standardizedFileURL : nil
    }

    private static func isPreferred(
        _ lhs: (url: URL, depth: Int),
        _ rhs: (url: URL, depth: Int)
    ) -> Bool {
        if lhs.depth != rhs.depth { return lhs.depth < rhs.depth }
        let lhsIsMain = lhs.url.lastPathComponent == fallbackName
        let rhsIsMain = rhs.url.lastPathComponent == fallbackName
        if lhsIsMain != rhsIsMain { return lhsIsMain }
        return lhs.url.lastPathComponent.localizedStandardCompare(rhs.url.lastPathComponent) == .orderedAscending
    }

    private static func declaresDocumentClass(_ url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: headerReadLimit) else { return false }
        let text = String(decoding: data, as: UTF8.self)
        return text.split(separator: "\n").contains { line in
            line.drop(while: \.isWhitespace).hasPrefix("\\documentclass")
        }
    }
}
