import Foundation

struct OutlineEntry: Identifiable, Hashable, Sendable {
    enum Level: Int, Sendable {
        case chapter
        case section
        case subsection
    }

    let level: Level
    let title: String
    let fileURL: URL
    /// 1-basiert
    let line: Int

    var id: String { "\(fileURL.path):\(line)" }
}

struct OutlineResult: Sendable, Equatable {
    var entries: [OutlineEntry] = []
    /// Eingebundene Datei -> Datei, die sie einbindet.
    var includingFile: [URL: URL] = [:]
}

/// Parst Gliederungsbefehle und folgt \include/\input ab der Hauptdatei.
/// Ergebnisse pro Datei werden anhand von Änderungsdatum und Größe gecacht.
actor OutlineParser {
    enum Item: Sendable {
        case heading(OutlineEntry.Level, title: String, line: Int)
        case include(path: String)
    }

    private struct CachedFile {
        let modified: Date
        let size: Int
        let items: [Item]
    }

    private var cache: [URL: CachedFile] = [:]

    func outline(mainFile: URL) -> OutlineResult {
        let measurement = Signposts.begin("OutlineParse")
        defer { measurement.end() }

        var result = OutlineResult()
        var visited: Set<URL> = []
        let baseDirectory = mainFile.deletingLastPathComponent()
        walk(file: mainFile.standardizedFileURL, base: baseDirectory, visited: &visited, result: &result)
        return result
    }

    private func walk(file: URL, base: URL, visited: inout Set<URL>, result: inout OutlineResult) {
        guard visited.insert(file).inserted, let items = items(for: file) else { return }
        for item in items {
            switch item {
            case let .heading(level, title, line):
                result.entries.append(OutlineEntry(level: level, title: title, fileURL: file, line: line))
            case let .include(path):
                guard let child = Self.resolveInclude(path, base: base) else { continue }
                if result.includingFile[child] == nil { result.includingFile[child] = file }
                walk(file: child, base: base, visited: &visited, result: &result)
            }
        }
    }

    private func items(for file: URL) -> [Item]? {
        let values = try? file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let modified = values?.contentModificationDate ?? .distantPast
        let size = values?.fileSize ?? -1
        if let cached = cache[file], cached.modified == modified, cached.size == size {
            return cached.items
        }
        guard let data = try? Data(contentsOf: file) else {
            cache[file] = nil
            return nil
        }
        let items = Self.parse(data)
        cache[file] = CachedFile(modified: modified, size: size, items: items)
        return items
    }

    private static func resolveInclude(_ path: String, base: URL) -> URL? {
        let trimmed = path.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let candidates = trimmed.hasSuffix(".tex") ? [trimmed] : [trimmed + ".tex", trimmed]
        for candidate in candidates {
            let url = base.appendingPathComponent(candidate).standardizedFileURL
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue {
                return url
            }
        }
        return nil
    }
}

// MARK: - Zeilenscanner

private extension OutlineParser {
    enum Command: String {
        case chapter, section, subsection, include, input
    }

    static let backslash = UInt8(ascii: "\\")
    static let percent = UInt8(ascii: "%")
    static let openBrace = UInt8(ascii: "{")
    static let closeBrace = UInt8(ascii: "}")
    static let openBracket = UInt8(ascii: "[")
    static let closeBracket = UInt8(ascii: "]")
    static let star = UInt8(ascii: "*")
    static let space = UInt8(ascii: " ")
    static let newline = UInt8(ascii: "\n")

    static func parse(_ data: Data) -> [Item] {
        var items: [Item] = []
        let lines = data.split(separator: newline, omittingEmptySubsequences: false)
        for (index, line) in lines.enumerated() {
            scan(Array(line), lineNumber: index + 1, into: &items)
        }
        return items
    }

    static func scan(_ bytes: [UInt8], lineNumber: Int, into items: inout [Item]) {
        let end = commentStart(in: bytes) ?? bytes.count
        var index = 0
        while index < end {
            guard bytes[index] == backslash else {
                index += 1
                continue
            }
            let nameStart = index + 1
            var cursor = nameStart
            while cursor < end, isLetter(bytes[cursor]) { cursor += 1 }
            guard cursor > nameStart else {
                index = nameStart + 1
                continue
            }
            index = cursor
            let name = String(decoding: bytes[nameStart..<cursor], as: UTF8.self)
            guard let command = Command(rawValue: name),
                  let argument = argument(in: bytes, from: cursor, end: end) else { continue }
            index = argument.next
            append(command, argument: argument.text, line: lineNumber, to: &items)
        }
    }

    static func append(_ command: Command, argument: String, line: Int, to items: inout [Item]) {
        switch command {
        case .chapter: items.append(.heading(.chapter, title: cleanTitle(argument), line: line))
        case .section: items.append(.heading(.section, title: cleanTitle(argument), line: line))
        case .subsection: items.append(.heading(.subsection, title: cleanTitle(argument), line: line))
        case .include, .input: items.append(.include(path: argument))
        }
    }

    /// Liest `*`, optionales `[...]` und `{...}` ab `start`.
    static func argument(in bytes: [UInt8], from start: Int, end: Int) -> (text: String, next: Int)? {
        var cursor = start
        if cursor < end, bytes[cursor] == star { cursor += 1 }
        cursor = skipSpaces(in: bytes, from: cursor, end: end)
        if cursor < end, bytes[cursor] == openBracket {
            guard let close = bytes[cursor..<end].firstIndex(of: closeBracket) else { return nil }
            cursor = skipSpaces(in: bytes, from: close + 1, end: end)
        }
        guard cursor < end, bytes[cursor] == openBrace else { return nil }
        return braceContent(in: bytes, from: cursor, end: end)
    }

    static func braceContent(in bytes: [UInt8], from open: Int, end: Int) -> (text: String, next: Int)? {
        var depth = 0
        var cursor = open
        while cursor < end {
            switch bytes[cursor] {
            case openBrace: depth += 1
            case closeBrace:
                depth -= 1
                if depth == 0 {
                    let text = String(decoding: bytes[(open + 1)..<cursor], as: UTF8.self)
                    return (text, cursor + 1)
                }
            default: break
            }
            cursor += 1
        }
        return nil
    }

    static func skipSpaces(in bytes: [UInt8], from start: Int, end: Int) -> Int {
        var cursor = start
        while cursor < end, bytes[cursor] == space { cursor += 1 }
        return cursor
    }

    static func isLetter(_ byte: UInt8) -> Bool {
        (byte >= UInt8(ascii: "a") && byte <= UInt8(ascii: "z"))
            || (byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z"))
    }

    /// Entfernt Befehlsnamen und Klammern, behält den Text.
    static func cleanTitle(_ raw: String) -> String {
        var result = ""
        var isSkippingCommandName = false
        for character in raw {
            if character == "\\" {
                isSkippingCommandName = true
                continue
            }
            if isSkippingCommandName, character.isLetter { continue }
            isSkippingCommandName = false
            if character == "{" || character == "}" { continue }
            result.append(character)
        }
        return result.trimmingCharacters(in: .whitespaces)
    }
}

extension OutlineParser {
    /// Kommentarbeginn auf Bytes (schnell, für große Dateien) nach derselben Regel wie `LatexComments`
    /// (`LatexSourceTests` prüft, dass beide übereinstimmen)
    static func commentStart(in bytes: [UInt8]) -> Int? {
        var index = 0
        while index < bytes.count {
            switch bytes[index] {
            case backslash: index += 2
            case percent: return index
            default: index += 1
            }
        }
        return nil
    }
}
