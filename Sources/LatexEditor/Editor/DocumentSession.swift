import AppKit
import Observation

enum EditorAppearance {
    static let defaultFontSize: CGFloat = 13
    static let fontSizeRange: ClosedRange<CGFloat> = 9...32
    static let fontSizeKey = "editorFontSize"
    /// Wird nach einer Änderung der Schriftgröße gesendet (Editor, Ruler und offene Dateien passen sich an)
    static let fontDidChange = Notification.Name("EditorFontDidChange")
    private static let currentLineAlpha: CGFloat = 0.035

    /// Einstellbar mit ⌘+ / ⌘− (Menü Darstellung), gemerkt in den Einstellungen
    static var fontSize: CGFloat {
        let stored = UserDefaults.standard.object(forKey: fontSizeKey) as? Double
        return stored.map { min(max(CGFloat($0), fontSizeRange.lowerBound), fontSizeRange.upperBound) } ?? defaultFontSize
    }

    static func setFontSize(_ size: CGFloat) {
        let clamped = min(max(size, fontSizeRange.lowerBound), fontSizeRange.upperBound)
        guard clamped != fontSize else { return }
        UserDefaults.standard.set(Double(clamped), forKey: fontSizeKey)
        NotificationCenter.default.post(name: fontDidChange, object: nil)
    }

    static var font: NSFont {
        NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
    }

    static var textAttributes: [NSAttributedString.Key: Any] {
        [.font: font, .foregroundColor: NSColor.textColor]
    }

    /// Sehr dezenter Streifen für die aktuelle Zeile (passt sich Hell/Dunkel an).
    static var currentLineColor: NSColor {
        NSColor.labelColor.withAlphaComponent(currentLineAlpha)
    }
}

/// Im Hintergrund vorbereitete Datei: Text, Zeilenindex und erste Einfärbung.
private struct PreparedDocument: Sendable {
    let text: String
    let encoding: String.Encoding
    /// Inhalt der Datei auf der Platte beim Laden (zum Erkennen externer Änderungen)
    let diskData: Data
    let lineIndex: LineIndex
    let highlighter: SyntaxHighlighter
    let tokens: [SyntaxToken]
}

/// Eine geöffnete Datei. Der NSTextStorage ist die einzige Quelle für den Text;
/// SwiftUI sieht nur `isDirty`. Zeilenindex und Highlighter werden in
/// `didProcessEditing` inkrementell nachgeführt.
@MainActor
@Observable
final class DocumentSession {
    /// Ändert sich beim Umbenennen oder Verschieben (`relocate`), Text und Undo-Verlauf bleiben.
    private(set) var url: URL
    private(set) var isDirty = false
    /// Datei wurde extern gelöscht, hat aber ungespeicherte Änderungen. Speichern legt sie neu an.
    var isMissingOnDisk = false
    /// Datei wurde auf der Platte geändert (z. B. Pull, Branch-Wechsel), während hier ungespeicherte
    /// Änderungen bestehen. Der Nutzer entscheidet: neu laden oder eigene Version behalten.
    private(set) var hasExternalChange = false

    /// Wird einmal aufgerufen, wenn die Datei zum ersten Mal verändert wird (z. B. um einen Vorschau-Tab festzuhalten).
    @ObservationIgnored var onBecameDirty: (() -> Void)?
    @ObservationIgnored let textStorage: NSTextStorage
    @ObservationIgnored let undoManager = UndoManager()
    @ObservationIgnored var savedSelection = NSRange(location: 0, length: 0)
    /// Vertikale Scrollposition in Dokument-Koordinaten (oberer sichtbarer Rand).
    @ObservationIgnored var savedScrollOffset: CGFloat = 0
    @ObservationIgnored private(set) var lineIndex: LineIndex
    @ObservationIgnored private var highlighter: SyntaxHighlighter
    @ObservationIgnored private var encoding: String.Encoding
    @ObservationIgnored private let editObserver = StorageEditObserver()
    /// Zuletzt geladener, gespeicherter oder bewusst übergangener Inhalt auf der Platte. Ein Dateiereignis
    /// mit genau diesem Inhalt (z. B. das eigene Speichern) ist keine externe Änderung.
    @ObservationIgnored private var knownDiskData: Data
    /// Während des Neuladens: Die Bearbeitung macht die Datei nicht „geändert“.
    @ObservationIgnored private var isReloading = false
    /// Nach jeder Textänderung (Tippen, Einfügen, Neuladen), z. B. für die Git-Änderungsmarken
    @ObservationIgnored var onEdited: (() -> Void)?

    convenience init(url: URL, text: String, encoding: String.Encoding = .utf8) {
        self.init(url: url, prepared: Self.prepare(text: text, encoding: encoding, diskData: text.data(using: encoding) ?? Data()))
    }

    private init(url: URL, prepared: PreparedDocument) {
        self.url = url
        encoding = prepared.encoding
        knownDiskData = prepared.diskData
        lineIndex = prepared.lineIndex
        highlighter = prepared.highlighter
        textStorage = NSTextStorage(string: prepared.text, attributes: EditorAppearance.textAttributes)
        Signposts.interval("ApplyInitialColors") {
            textStorage.beginEditing()
            SyntaxTheme.apply(prepared.tokens, in: NSRange(location: 0, length: textStorage.length), to: textStorage)
            textStorage.endEditing()
        }
        editObserver.onCharactersEdited = { [weak self] range, delta in
            self?.handleCharacterEdit(editedRange: range, delta: delta)
        }
        textStorage.delegate = editObserver
    }

    static func load(url: URL) async throws -> DocumentSession {
        let prepared = try await Task.detached(priority: .userInitiated) {
            let loaded = try Self.readText(from: url)
            return Self.prepare(text: loaded.text, encoding: loaded.encoding, diskData: loaded.data)
        }.value
        return DocumentSession(url: url, prepared: prepared)
    }

    func save() throws {
        guard isDirty else { return }
        try Signposts.interval("SaveFile") {
            guard let data = textStorage.string.data(using: encoding) else {
                throw CocoaError(.fileWriteInapplicableStringEncoding)
            }
            try data.write(to: url, options: .atomic)
            knownDiskData = data
        }
        isDirty = false
        if isMissingOnDisk { isMissingOnDisk = false }
        if hasExternalChange { hasExternalChange = false }
    }

    /// Neue Schriftgröße: nur das Schrift-Attribut, kein Bearbeitungsschritt (Farben, Undo und „geändert“ bleiben).
    func applyEditorFont() {
        textStorage.beginEditing()
        textStorage.addAttribute(.font, value: EditorAppearance.font, range: NSRange(location: 0, length: textStorage.length))
        textStorage.endEditing()
    }

    /// Aktueller Editortext in der Kodierung der Datei (auch ungespeichert), z. B. für Sicherungskopien.
    func currentData() -> Data? {
        textStorage.string.data(using: encoding)
    }

    // MARK: Externe Änderungen

    enum DiskSyncResult: Equatable {
        case unchanged
        case reloaded
        /// Ungespeicherte Änderungen hier, andere Version auf der Platte: `hasExternalChange` ist gesetzt
        case conflict
        case missing
    }

    /// Gleicht mit der Platte ab. Ohne ungespeicherte Änderungen wird still neu geladen; mit ihnen nur
    /// markiert. `discardingChanges`: in jedem Fall den Stand der Platte übernehmen (z. B. nach „Verwerfen“).
    @discardableResult
    func syncWithDisk(discardingChanges: Bool = false) async -> DiskSyncResult {
        let fileURL = url
        guard let data = await Task.detached(priority: .userInitiated, operation: { try? Data(contentsOf: fileURL) }).value else {
            return .missing
        }
        let differsFromDisk = data != knownDiskData
        guard differsFromDisk || (discardingChanges && isDirty) else { return .unchanged }
        if isDirty, !discardingChanges {
            if !hasExternalChange { hasExternalChange = true }
            return .conflict
        }
        guard let decoded = Self.decode(data) else { return .unchanged }
        replaceText(with: decoded.text)
        encoding = decoded.encoding
        knownDiskData = data
        isDirty = false
        if hasExternalChange { hasExternalChange = false }
        if isMissingOnDisk { isMissingOnDisk = false }
        // Der Undo-Verlauf bezieht sich auf den alten Text und würde ihn beschädigen.
        undoManager.removeAllActions()
        return .reloaded
    }

    /// „Meine Version behalten“: Der Hinweis verschwindet, der nächste Speichervorgang überschreibt die Platte.
    func keepLocalVersion() async {
        let fileURL = url
        if let data = await Task.detached(operation: { try? Data(contentsOf: fileURL) }).value { knownDiskData = data }
        if hasExternalChange { hasExternalChange = false }
    }

    /// Ersetzt nur den Teil zwischen gemeinsamem Anfang und Ende: Cursor und Scrollposition davor bleiben,
    /// und Highlighter wie Zeilenindex arbeiten nur den geänderten Bereich nach.
    private func replaceText(with newText: String) {
        let old = textStorage.mutableString
        let new = newText as NSString
        let shorter = min(old.length, new.length)
        var prefix = 0
        while prefix < shorter, old.character(at: prefix) == new.character(at: prefix) { prefix += 1 }
        var suffix = 0
        while suffix < shorter - prefix,
              old.character(at: old.length - 1 - suffix) == new.character(at: new.length - 1 - suffix) { suffix += 1 }
        let range = NSRange(location: prefix, length: old.length - prefix - suffix)
        let replacement = new.substring(with: NSRange(location: prefix, length: new.length - prefix - suffix))
        isReloading = true
        defer { isReloading = false }
        textStorage.replaceCharacters(in: range, with: NSAttributedString(string: replacement, attributes: EditorAppearance.textAttributes))
    }

    func relocate(to newURL: URL) {
        url = newURL
    }

    /// Syntax-Tokens der Zeilen, die `range` berühren (z. B. für die Rechtschreibprüfung).
    func syntaxTokens(in range: NSRange) -> [SyntaxToken] {
        highlighter.tokens(in: range, of: textStorage.mutableString, lines: lineIndex)
    }

    private func handleCharacterEdit(editedRange: NSRange, delta: Int) {
        defer { onEdited?() }
        if !isDirty, !isReloading {
            isDirty = true
            onBecameDirty?()
        }
        let start = ContinuousClock.now
        let text = textStorage.mutableString
        let splice = lineIndex.applyEdit(in: text, editedRange: editedRange, changeInLength: delta)
        let update = highlighter.update(text, lines: lineIndex, splice: splice)
        SyntaxTheme.apply(update.tokens, in: update.range, to: textStorage)
        Signposts.logEdit(duration: ContinuousClock.now - start, tokenizedLines: update.tokenizedLineCount)
    }

    private nonisolated static func prepare(text: String, encoding: String.Encoding, diskData: Data) -> PreparedDocument {
        Signposts.interval("PrepareDocument") {
            let string = text as NSString
            let lineIndex = LineIndex(text: string)
            var highlighter = SyntaxHighlighter()
            let tokens = highlighter.highlightAll(string, lines: lineIndex)
            return PreparedDocument(
                text: text, encoding: encoding, diskData: diskData, lineIndex: lineIndex, highlighter: highlighter, tokens: tokens
            )
        }
    }

    private nonisolated static func readText(from url: URL) throws -> (text: String, encoding: String.Encoding, data: Data) {
        let data = try Data(contentsOf: url)
        guard let decoded = decode(data) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
        return (decoded.text, decoded.encoding, data)
    }

    private nonisolated static func decode(_ data: Data) -> (text: String, encoding: String.Encoding)? {
        if let text = String(data: data, encoding: .utf8) { return (text, .utf8) }
        if let text = String(data: data, encoding: .isoLatin1) { return (text, .isoLatin1) }
        return nil
    }
}

@MainActor
private final class StorageEditObserver: NSObject, @preconcurrency NSTextStorageDelegate {
    var onCharactersEdited: ((NSRange, Int) -> Void)?

    func textStorage(
        _ textStorage: NSTextStorage,
        didProcessEditing editedMask: NSTextStorageEditActions,
        range editedRange: NSRange,
        changeInLength delta: Int
    ) {
        guard editedMask.contains(.editedCharacters) else { return }
        onCharactersEdited?(editedRange, delta)
    }
}
