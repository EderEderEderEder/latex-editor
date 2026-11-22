import Foundation

/// Art der Änderung einer Zeile gegenüber dem letzten Commit (für die Marken neben den Zeilennummern).
enum LineChange: Equatable, Sendable {
    case added
    case modified
    /// Direkt über dieser Zeile wurden Zeilen gelöscht
    case deletedAbove
}

/// Änderungsmarken einer Datei: 1-basierte Zeile → Art der Änderung. Reine Logik.
struct ChangeMarks: Equatable, Sendable {
    var lines: [Int: LineChange] = [:]
    /// Am Dateiende wurden Zeilen gelöscht (Marke unter der letzten Zeile)
    var deletedAtEnd = false

    var isEmpty: Bool { lines.isEmpty && !deletedAtEnd }

    /// Wie bei VS Code: In einem Änderungsblock gelten so viele hinzugefügte Zeilen als „geändert“,
    /// wie entfernt wurden, der Rest als neu; nur entfernte Zeilen ergeben eine Lösch-Marke.
    static func compute(base: String, current: String) -> ChangeMarks {
        var marks = ChangeMarks()
        let diff = LineDiff.compute(old: base, new: current, highlightingWords: false)
        let lineCount = diff.count { $0.kind != .removed }
        var newLine = 0
        var index = 0
        while index < diff.count {
            guard diff[index].kind != .context else {
                newLine += 1
                index += 1
                continue
            }
            var removed = 0
            while index < diff.count, diff[index].kind == .removed {
                removed += 1
                index += 1
            }
            var added = 0
            while index < diff.count, diff[index].kind == .added {
                added += 1
                index += 1
                marks.lines[newLine + added] = added <= removed ? .modified : .added
            }
            if added == 0 { marks.markDeletion(beforeLine: newLine + 1, lineCount: lineCount) }
            newLine += added
        }
        return marks
    }

    private mutating func markDeletion(beforeLine line: Int, lineCount: Int) {
        if line > lineCount {
            deletedAtEnd = true
        } else if lines[line] == nil {
            lines[line] = .deletedAbove
        }
    }
}
