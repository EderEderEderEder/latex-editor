import Foundation

enum GitChangeKind: Equatable, Hashable, Sendable {
    case modified
    case typeChanged
    case added
    case deleted
    case renamed
    case copied
    case untracked
    case conflicted

    /// Buchstabe in der Seitenleiste und im Dateibaum
    var letter: String {
        switch self {
        case .modified: "M"
        case .typeChanged: "T"
        case .added: "A"
        case .deleted: "D"
        case .renamed: "R"
        case .copied: "C"
        case .untracked: "U"
        case .conflicted: "!"
        }
    }

    var title: String {
        switch self {
        case .modified: "Geändert"
        case .typeChanged: "Typ geändert"
        case .added: "Neu"
        case .deleted: "Gelöscht"
        case .renamed: "Umbenannt"
        case .copied: "Kopiert"
        case .untracked: "Nicht versioniert"
        case .conflicted: "Konflikt"
        }
    }

    /// Statusbuchstabe aus `git status` (X = Index, Y = Arbeitsverzeichnis), `nil` für „unverändert“.
    init?(statusCode: Character) {
        switch statusCode {
        case "M": self = .modified
        case "T": self = .typeChanged
        case "A": self = .added
        case "D": self = .deleted
        case "R": self = .renamed
        case "C": self = .copied
        case "U": self = .conflicted
        default: return nil
        }
    }
}

/// Branch-Zeilen aus `git status --branch`.
struct GitBranchInfo: Equatable, Sendable {
    private static let shortCommitLength = 7

    /// `nil`: losgelöster HEAD
    var head: String?
    /// `nil`: noch kein Commit
    var commit: String?
    var upstream: String?
    var ahead = 0
    var behind = 0

    var hasCommits: Bool { commit != nil }

    var displayName: String {
        if let head { return head }
        if let commit { return String(commit.prefix(Self.shortCommitLength)) }
        return "–"
    }
}

/// Eine Datei aus `git status`. Index- und Arbeitsverzeichnis-Zustand getrennt (`nil` = unverändert).
struct GitStatusEntry: Equatable, Sendable {
    /// Pfad relativ zur Wurzel des Repositorys
    let path: String
    /// Ursprünglicher Pfad bei Umbenennungen/Kopien
    let originalPath: String?
    let indexKind: GitChangeKind?
    let worktreeKind: GitChangeKind?
}

struct GitStatusSnapshot: Equatable, Sendable {
    var branch = GitBranchInfo()
    var entries: [GitStatusEntry] = []
}

/// Eine Zeile im Änderungen-Tab: bereitgestellt (Index gegen HEAD) oder nicht (Arbeitsverzeichnis gegen Index).
struct GitChange: Hashable, Identifiable, Sendable {
    let path: String
    let originalPath: String?
    let kind: GitChangeKind
    let isStaged: Bool

    var id: String { (isStaged ? "S:" : "W:") + path }
    var fileName: String { (path as NSString).lastPathComponent }
    var directory: String { (path as NSString).deletingLastPathComponent }
}

extension GitStatusSnapshot {
    var stagedChanges: [GitChange] {
        entries.compactMap { entry in
            entry.indexKind.map { GitChange(path: entry.path, originalPath: entry.originalPath, kind: $0, isStaged: true) }
        }
    }

    var unstagedChanges: [GitChange] {
        entries.compactMap { entry in
            entry.worktreeKind.map {
                GitChange(path: entry.path, originalPath: $0 == .renamed ? entry.originalPath : nil, kind: $0, isStaged: false)
            }
        }
    }
}

/// Liest `git status --porcelain=v2 -z --branch`. Einträge sind durch NUL getrennt; bei
/// Umbenennungen folgt der ursprüngliche Pfad als eigener Eintrag.
enum GitStatusParser {
    /// Felder vor dem Pfad: `1 XY sub mH mI mW hH hI pfad`
    private static let ordinaryFieldCount = 8
    /// `2 XY sub mH mI mW hH hI Xscore pfad`
    private static let renamedFieldCount = 9
    /// `u XY sub m1 m2 m3 mW h1 h2 h3 pfad`
    private static let unmergedFieldCount = 10

    static func parse(_ data: Data) -> GitStatusSnapshot {
        var snapshot = GitStatusSnapshot()
        let records = data.split(separator: 0, omittingEmptySubsequences: true).map { String(decoding: $0, as: UTF8.self) }
        var index = 0
        while index < records.count {
            let record = records[index]
            index += 1
            if record.hasPrefix("# ") {
                parseHeader(record, into: &snapshot.branch)
            } else if record.hasPrefix("2 ") {
                let original = index < records.count ? records[index] : nil
                index += 1
                if let entry = parseChanged(record, fieldCount: renamedFieldCount, originalPath: original) {
                    snapshot.entries.append(entry)
                }
            } else if let entry = parseEntry(record) {
                snapshot.entries.append(entry)
            }
        }
        return snapshot
    }

    private static func parseEntry(_ record: String) -> GitStatusEntry? {
        switch record.first {
        case "1": return parseChanged(record, fieldCount: ordinaryFieldCount, originalPath: nil)
        case "u": return parseUnmerged(record)
        case "?": return GitStatusEntry(path: String(record.dropFirst(2)), originalPath: nil, indexKind: nil, worktreeKind: .untracked)
        default: return nil
        }
    }

    private static func parseChanged(_ record: String, fieldCount: Int, originalPath: String?) -> GitStatusEntry? {
        guard let (fields, path) = split(record, fieldCount: fieldCount) else { return nil }
        let codes = Array(fields[1])
        guard codes.count == 2 else { return nil }
        return GitStatusEntry(
            path: path,
            originalPath: originalPath,
            indexKind: GitChangeKind(statusCode: codes[0]),
            worktreeKind: GitChangeKind(statusCode: codes[1])
        )
    }

    private static func parseUnmerged(_ record: String) -> GitStatusEntry? {
        guard let (_, path) = split(record, fieldCount: unmergedFieldCount) else { return nil }
        return GitStatusEntry(path: path, originalPath: nil, indexKind: nil, worktreeKind: .conflicted)
    }

    /// Trennt die festen Felder vom Pfad. Der Pfad selbst darf Leerzeichen enthalten.
    private static func split(_ record: String, fieldCount: Int) -> ([Substring], String)? {
        let parts = record.split(separator: " ", maxSplits: fieldCount, omittingEmptySubsequences: false)
        guard parts.count == fieldCount + 1 else { return nil }
        return (Array(parts.prefix(fieldCount)), String(parts[fieldCount]))
    }

    private static func parseHeader(_ record: String, into branch: inout GitBranchInfo) {
        let parts = record.split(separator: " ", maxSplits: 2).map(String.init)
        guard parts.count == 3 else { return }
        let value = parts[2]
        switch parts[1] {
        case "branch.oid": branch.commit = value == "(initial)" ? nil : value
        case "branch.head": branch.head = value == "(detached)" ? nil : value
        case "branch.upstream": branch.upstream = value
        case "branch.ab": parseAheadBehind(value, into: &branch)
        default: break
        }
    }

    private static func parseAheadBehind(_ value: String, into branch: inout GitBranchInfo) {
        for part in value.split(separator: " ") {
            guard let number = Int(part.dropFirst()) else { continue }
            if part.hasPrefix("+") { branch.ahead = number }
            if part.hasPrefix("-") { branch.behind = number }
        }
    }
}
