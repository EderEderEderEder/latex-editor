import Foundation

/// Teilt eine Meldung in Titel und Zusatztext für einen Dialog. Vorher hießen die Dialoge nur „Fehler“, „Datei“ oder
/// „Git“; HIG `alerts.md`: Der Titel beschreibt die Lage („… konnte nicht gespeichert werden“), der Grund steht darunter.
struct AlertText: Equatable {
    /// Längere Titel umbrechen auf mehr als zwei Zeilen; dann bleibt die Meldung als Ganzes der Zusatztext
    private static let maximumTitleLength = 90

    let title: String
    let detail: String

    init(_ message: String?) {
        let message = (message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if let split = Self.split(message, at: ": "), split.head.count <= Self.maximumTitleLength {
            (title, detail) = (split.head, split.tail)
        } else if let split = Self.split(message, at: ". "), split.head.count < Self.maximumTitleLength {
            (title, detail) = (split.head + ".", split.tail)
        } else {
            (title, detail) = (message, "")
        }
    }

    private static func split(_ message: String, at separator: String) -> (head: String, tail: String)? {
        guard let range = message.range(of: separator) else { return nil }
        let head = String(message[..<range.lowerBound])
        let tail = String(message[range.upperBound...]).trimmingCharacters(in: .whitespaces)
        guard !head.isEmpty, !tail.isEmpty else { return nil }
        return (head, tail.prefix(1).uppercased() + tail.dropFirst())
    }
}
