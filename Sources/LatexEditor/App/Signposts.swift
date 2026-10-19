import os

/// Messpunkte: Signposts (Points of Interest) plus Dauer als Debug-Log.
/// Mitlesen: log stream --level debug --predicate 'subsystem == "de.maxieder.LatexEditor"'
enum Signposts {
    static let subsystem = "de.maxieder.LatexEditor"
    static let signposter = OSSignposter(subsystem: subsystem, category: .pointsOfInterest)
    static let logger = Logger(subsystem: subsystem, category: "performance")

    /// Laufende Messung für Stellen mit frühen Returns: `let m = Signposts.begin("X"); defer { m.end() }`
    struct Measurement {
        fileprivate let name: StaticString
        fileprivate let state: OSSignpostIntervalState
        fileprivate let start: ContinuousClock.Instant

        func end() {
            signposter.endInterval(name, state)
            log(String(describing: name), duration: ContinuousClock.now - start)
        }
    }

    static func begin(_ name: StaticString) -> Measurement {
        Measurement(name: name, state: signposter.beginInterval(name), start: .now)
    }

    static func interval<T>(_ name: StaticString, _ body: () throws -> T) rethrows -> T {
        let measurement = begin(name)
        defer { measurement.end() }
        return try body()
    }

    static func log(_ name: String, duration: Duration) {
        logger.debug("\(name, privacy: .public): \(milliseconds(duration), format: .fixed(precision: 3), privacy: .public) ms")
    }

    /// Kosten einer einzelnen Bearbeitung (Zeilenindex + Highlighting + Attribute).
    static func logEdit(duration: Duration, tokenizedLines: Int) {
        logger.debug("""
            Edit: \(milliseconds(duration), format: .fixed(precision: 3), privacy: .public) ms, \
            \(tokenizedLines, privacy: .public) Zeilen
            """)
    }

    private static func milliseconds(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1_000 + Double(duration.components.attoseconds) / 1e15
    }
}
