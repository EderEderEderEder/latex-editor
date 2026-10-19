import AppKit
import SwiftUI

/// NSTextView (TextKit 1) für den Quelltext. Der Text lebt im NSTextStorage der Session.
struct EditorTextView: NSViewRepresentable {
    let session: DocumentSession?
    let jump: JumpRequest?
    let insertRequest: InsertRequest?
    let selectionProviderOwner: EditorStore
    /// Fehler/Warnungen des letzten Builds für die angezeigte Datei (Zeile → Schwere)
    let issueMarks: [Int: BuildIssue.Severity]
    /// Git-Änderungen der angezeigten Datei gegenüber HEAD
    var changeMarks = ChangeMarks()
    /// Vorschläge für die Autovervollständigung (Projektindex)
    var completionProvider: CompletionProvider?
    /// Neue ID: Vervollständigung von Hand öffnen (Menü, ⌃Leertaste)
    var completionRequest: UUID?
    let onCursorMoved: (URL, Int) -> Void

    func makeCoordinator() -> EditorCoordinator {
        EditorCoordinator()
    }

    func makeNSView(context: Context) -> NSScrollView {
        context.coordinator.makeScrollView()
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        context.coordinator.onCursorMoved = onCursorMoved
        context.coordinator.update(session: session, jump: jump, insert: insertRequest)
        context.coordinator.updateIssueMarks(issueMarks)
        context.coordinator.updateChangeMarks(changeMarks)
        context.coordinator.updateCompletion(provider: completionProvider, request: completionRequest)
        selectionProviderOwner.selectionProvider = { [weak coordinator = context.coordinator] in
            coordinator?.selectedText ?? ""
        }
    }
}

@MainActor
final class EditorCoordinator: NSObject, NSTextViewDelegate {
    private static let preferredSpellingLanguages = ["de_AT", "de_DE", "de"]
    private static let textInset = NSSize(width: 8, height: 8)
    private static let cursorReportDelay = Duration.milliseconds(150)

    var onCursorMoved: ((URL, Int) -> Void)?

    private var scrollView: NSScrollView!
    private var textView: LatexTextView!
    private var lineNumberRuler: LineNumberRulerView!
    private let placeholderStorage = NSTextStorage()
    private var session: DocumentSession?
    private var lastHandledJumpID: UUID?
    private var lastHandledInsertID: UUID?
    private var lastHandledCompletionRequest: UUID?
    private(set) var completion: CompletionController!
    /// Was zuletzt getippt wurde (aus `shouldChangeTextIn`), für das automatische Öffnen der Vervollständigung
    private var pendingReplacement: String?
    private static let maximumSelectedTextLength = 50_000

    /// Markierter Text (begrenzt), für das Einfügen-Fenster.
    var selectedText: String {
        guard let textView, let storage = textView.textStorage else { return "" }
        let range = textView.selectedRange().clamped(toLength: storage.length)
        guard range.length > 0, range.length <= Self.maximumSelectedTextLength else { return "" }
        return storage.mutableString.substring(with: range)
    }
    private var cursorReportTask: Task<Void, Never>?

    // MARK: Aufbau

    func makeScrollView() -> NSScrollView {
        let layoutManager = NSLayoutManager()
        layoutManager.allowsNonContiguousLayout = true
        placeholderStorage.addLayoutManager(layoutManager)

        let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)

        let textView = LatexTextView(frame: .zero, textContainer: container)
        configure(textView)
        completion = CompletionController(textView: textView) { [weak self] in self?.session }
        NotificationCenter.default.addObserver(forName: EditorAppearance.fontDidChange, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyFontSize() }
        }
        textView.onCompletionRequested = { [weak self] in self?.completion.trigger() }
        textView.syntaxTokensProvider = { [weak self] range in
            self?.session?.syntaxTokens(in: range) ?? []
        }
        self.textView = textView

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = true
        scrollView.documentView = textView
        self.scrollView = scrollView
        attachLineNumbers(to: scrollView, textView: textView)
        return scrollView
    }

    private func attachLineNumbers(to scrollView: NSScrollView, textView: LatexTextView) {
        let ruler = LineNumberRulerView(textView: textView, scrollView: scrollView)
        ruler.lineIndexProvider = { [weak self] in self?.session?.lineIndex }
        scrollView.verticalRulerView = ruler
        scrollView.hasVerticalRuler = true
        scrollView.rulersVisible = true
        lineNumberRuler = ruler
    }

    private func configure(_ textView: NSTextView) {
        textView.delegate = self
        textView.font = EditorAppearance.font
        textView.typingAttributes = EditorAppearance.textAttributes
        textView.textContainerInset = Self.textInset
        textView.isRichText = false
        textView.allowsUndo = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.smartInsertDeleteEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = true
        textView.isGrammarCheckingEnabled = false
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = .width
        configureSpellingLanguage()
    }

    private func configureSpellingLanguage() {
        let checker = NSSpellChecker.shared
        let available = checker.availableLanguages
        guard let language = Self.preferredSpellingLanguages.first(where: available.contains) else { return }
        checker.automaticallyIdentifiesLanguages = false
        checker.setLanguage(language)
    }

    // MARK: Aktualisierung

    func update(session newSession: DocumentSession?, jump: JumpRequest?, insert: InsertRequest?) {
        let didSwitch = newSession !== session
        if didSwitch { switchSession(to: newSession) }
        if let insert, insert.id != lastHandledInsertID {
            lastHandledInsertID = insert.id
            // Nicht synchron: Das Einfügen ändert Text und Zustand (isDirty) mitten in einem SwiftUI-Update.
            DispatchQueue.main.async { [weak self] in self?.perform(insert) }
        }

        var pendingLine: Int?
        if let jump, jump.id != lastHandledJumpID {
            lastHandledJumpID = jump.id
            pendingLine = jump.line
        }
        guard didSwitch || pendingLine != nil else { return }

        // Layout ist erst im nächsten Runloop-Durchlauf verlässlich.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if didSwitch { self.restoreScrollOrigin() }
            if let pendingLine { self.scroll(toLine: pendingLine) }
        }
    }

    /// Reihenfolge ist wichtig: Erst Storage tauschen und sofort eine gültige (geklemmte) Auswahl setzen,
    /// danach Ruler und Zeilenstreifen – beide nur vorgemerkt, damit aus `updateNSView` kein Layout startet.
    private func switchSession(to newSession: DocumentSession?) {
        completion.close()
        rememberViewState()
        session = newSession
        let storage = newSession?.textStorage ?? placeholderStorage
        textView.layoutManager?.replaceTextStorage(storage)
        let selection = newSession?.savedSelection ?? NSRange(location: 0, length: 0)
        textView.setSelectedRange(selection.clamped(toLength: storage.length))
        textView.isEditable = newSession != nil
        lineNumberRuler.scheduleRefresh()
        textView.scheduleCurrentLineHighlightUpdate()
    }

    private func rememberViewState() {
        guard let session else { return }
        session.savedSelection = textView.selectedRange()
        session.savedScrollOffset = textView.visibleRect.minY
    }

    /// Die Clip-View hat wegen des Rulers einen linken Inset; ihr Ursprung liegt dann bei
    /// (-inset, ...). Ein Scrollen auf x = 0 würde den Zeilenanfang unter den Ruler schieben.
    private func restoreScrollOrigin() {
        guard let session else { return }
        let clipView = scrollView.contentView
        let insets = clipView.contentInsets
        var target = clipView.bounds
        target.origin = NSPoint(x: -insets.left, y: session.savedScrollOffset - insets.top)
        clipView.scroll(to: clipView.constrainBoundsRect(target).origin)
        scrollView.reflectScrolledClipView(clipView)
    }

    /// Fügt Text an der Auswahl ein, als ein Undo-Schritt, mit Cursor dahinter.
    private func perform(_ request: InsertRequest) {
        guard session != nil, textView.isEditable, let storage = textView.textStorage else { return }
        var range = textView.selectedRange().clamped(toLength: storage.length)
        if !request.replacesSelection { range = NSRange(location: NSMaxRange(range), length: 0) }
        let text = request.isBlock
            ? BlockPlacement.adjust(request.text, in: storage.mutableString, replacing: range)
            : request.text
        guard textView.shouldChangeText(in: range, replacementString: text) else { return }
        storage.replaceCharacters(in: range, with: text)
        textView.didChangeText()
        textView.undoManager?.setActionName("Einfügen")
        let caret = NSRange(location: range.location + (text as NSString).length, length: 0)
        textView.setSelectedRange(caret)
        textView.scrollRangeToVisible(caret)
        textView.window?.makeFirstResponder(textView)
    }

    /// Springt zur 1-basierten Zeile; die Nummer wird auf die vorhandenen Zeilen geklemmt.
    private func scroll(toLine line: Int) {
        guard let session else { return }
        let lineRange = session.lineIndex.contentRange(ofLineNumber: line)
        textView.window?.makeFirstResponder(textView)
        textView.setSelectedRange(NSRange(location: lineRange.location, length: 0))
        textView.scrollRangeToVisible(lineRange)
        textView.showFindIndicator(for: lineRange)
    }

    func updateIssueMarks(_ marks: [Int: BuildIssue.Severity]) {
        if lineNumberRuler.issueMarks != marks { lineNumberRuler.issueMarks = marks }
    }

    func updateChangeMarks(_ marks: ChangeMarks) {
        if lineNumberRuler.changeMarks != marks { lineNumberRuler.changeMarks = marks }
    }

    private func applyFontSize() {
        textView.font = EditorAppearance.font
        textView.typingAttributes = EditorAppearance.textAttributes
        session?.applyEditorFont()
        lineNumberRuler.updateFont()
        textView.scheduleCurrentLineHighlightUpdate()
    }

    func updateCompletion(provider: CompletionProvider?, request: UUID?) {
        completion.provider = provider
        guard let request, request != lastHandledCompletionRequest else { return }
        lastHandledCompletionRequest = request
        DispatchQueue.main.async { [weak self] in self?.completion.trigger() }
    }

    /// Meldet die Cursorzeile erst, wenn der Cursor kurz ruht – kein SwiftUI-Update pro Tastendruck.
    private func scheduleCursorReport() {
        cursorReportTask?.cancel()
        cursorReportTask = Task { [weak self] in
            try? await Task.sleep(for: Self.cursorReportDelay)
            guard !Task.isCancelled else { return }
            self?.reportCursor()
        }
    }

    private func reportCursor() {
        guard let session else { return }
        let line = session.lineIndex.clampedLine(containing: textView.selectedRange().location) + 1
        onCursorMoved?(session.url, line)
    }

    // MARK: NSTextViewDelegate

    func textViewDidChangeSelection(_ notification: Notification) {
        scheduleCursorReport()
        completion.selectionDidChange()
    }

    func textView(_ view: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
        pendingReplacement = text
        return true
    }

    func textDidChange(_ notification: Notification) {
        completion.textDidChange(insertedText: pendingReplacement)
        pendingReplacement = nil
    }

    /// Solange die Vervollständigung offen ist, steuern ↑↓, Return, Tab und Esc die Liste.
    func textView(_ view: NSTextView, doCommandBy selector: Selector) -> Bool {
        completion.handle(selector)
    }

    func undoManager(for view: NSTextView) -> UndoManager? {
        session?.undoManager
    }

    /// Verwirft Rechtschreibtreffer in LaTeX-Syntax. `LatexTextView.setSpellingState` greift zusätzlich,
    /// falls macOS diesen Weg nicht nutzt.
    func textView(
        _ view: NSTextView,
        didCheckTextIn range: NSRange,
        types checkingTypes: NSTextCheckingTypes,
        options: [NSSpellChecker.OptionKey: Any] = [:],
        results: [NSTextCheckingResult],
        orthography: NSOrthography,
        wordCount: Int
    ) -> [NSTextCheckingResult] {
        guard let session, results.contains(where: { $0.resultType == .spelling }) else { return results }
        let tokens = session.syntaxTokens(in: range)
        return results.filter { result in
            result.resultType != .spelling || !tokens.containsOverlap(with: result.range)
        }
    }
}
