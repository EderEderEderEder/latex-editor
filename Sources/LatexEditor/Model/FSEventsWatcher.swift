import CoreServices
import Foundation

struct FileEvent: Sendable {
    let path: String
    let flags: FSEventStreamEventFlags

    private static let structuralFlags = FSEventStreamEventFlags(
        kFSEventStreamEventFlagItemCreated
            | kFSEventStreamEventFlagItemRemoved
            | kFSEventStreamEventFlagItemRenamed
    )

    /// Datei oder Ordner wurde angelegt, gelöscht oder umbenannt.
    var isStructuralChange: Bool { flags & Self.structuralFlags != 0 }
}

/// Rekursive Dateiüberwachung per FSEvents. Muss mit `stop()` beendet werden.
final class FSEventsWatcher: @unchecked Sendable {
    private static let coalescingLatency: TimeInterval = 0.3

    private let handler: @Sendable ([FileEvent]) -> Void
    private let queue = DispatchQueue(label: "de.maxieder.LatexEditor.fsevents", qos: .utility)
    private var stream: FSEventStreamRef?

    init?(path: String, handler: @escaping @Sendable ([FileEvent]) -> Void) {
        self.handler = handler

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passRetained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let flags = FSEventStreamCreateFlags(
            kFSEventStreamCreateFlagFileEvents
                | kFSEventStreamCreateFlagNoDefer
                | kFSEventStreamCreateFlagUseCFTypes
        )
        guard let stream = FSEventStreamCreate(
            nil,
            fsEventsCallback,
            &context,
            [path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            Self.coalescingLatency,
            flags
        ) else {
            Unmanaged.passUnretained(self).release()
            return nil
        }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
    }

    func stop() {
        guard let stream else { return }
        self.stream = nil
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        Unmanaged.passUnretained(self).release()
    }

    fileprivate func deliver(_ events: [FileEvent]) {
        handler(events)
    }
}

private let fsEventsCallback: FSEventStreamCallback = { _, info, count, paths, flags, _ in
    guard let info else { return }
    let watcher = Unmanaged<FSEventsWatcher>.fromOpaque(info).takeUnretainedValue()
    let pathArray = unsafeBitCast(paths, to: CFArray.self) as? [String] ?? []
    let events = (0..<count).compactMap { index -> FileEvent? in
        guard index < pathArray.count else { return nil }
        return FileEvent(path: pathArray[index], flags: flags[index])
    }
    watcher.deliver(events)
}
