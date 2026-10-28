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
    /// Text der Meldungen pro Zeile (Tooltip)
    var issueMessages: [Int: String] = [:]
    /// Git-Änderungen der angezeigten Datei gegenüber HEAD
    var changeMarks = ChangeMarks()
    /// Verweise und Zitate ohne Ziel in der angezeigten Datei (rote Unterstreichung)
    var referenceProblems: [ReferenceProblem] = []
    /// Schreibhinweise in der angezeigten Datei (blau gepunktet)
    var writingHints: [WritingHint] = []
    /// Syntaxfehler und doppelte Labels (rot gestrichelt bzw. orange strichpunktiert); leer, wenn abgeschaltet
    var diagnostics: [TextMark] = []
    /// Zeilen mit Meldungen des letzten Builds im Text unterstreichen
    var underlinesBuildIssues = true
    /// Vorschläge für die Autovervollständigung (Projektindex)
    var completionProvider: CompletionProvider?
    /// Neue ID: Vervollständigung von Hand öffnen (Menü, ⌃Leertaste)
    var completionRequest: UUID?
    let onCursorMoved: (CursorInfo) -> Void
    /// Oberste sichtbare Zeile (1-basiert), entprellt: Datei und Zeile
    var onTopLineChanged: ((URL, Int) -> Void)?
    /// ⌘-Klick auf Verweis, Zitat oder Dateipfad
    var onJumpToTarget: ((JumpTarget) -> Void)?
    /// „Umbenennen …“ im Kontextmenü: Möglichkeiten an einer Zeichenposition und Ausführen
    var renameScopes: ((DocumentSession, Int) -> [RenameScope])?
    var onRename: ((RenameScope) -> Void)?
    /// Verwendungen eines Namens suchen (alle Dateien des Projekts) und eine davon öffnen
    var usageLoader: ((RenameSubject) async -> [UsageEntry])?
    var onOpenUsage: ((UsageEntry) -> Void)?
    /// Datei zu einem `\includegraphics`-Pfad der angezeigten Datei (für die Vorschau beim Daraufzeigen)
    var imageResolver: ((String, URL) -> URL?)?
    /// ⌘-Klick auf normalen Text: diese Zeile (1-basiert) der Datei im PDF zeigen
    var onShowInPDF: ((URL, Int) -> Void)?

    func makeCoordinator() -> EditorCoordinator {
        EditorCoordinator()
    }

    func makeNSView(context: Context) -> NSScrollView {
        context.coordinator.makeScrollView()
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        let isHidden = !context.environment.isWorkspacePaneShown
        if nsView.isHidden != isHidden { nsView.isHidden = isHidden }
        context.coordinator.onCursorMoved = onCursorMoved
        context.coordinator.onTopLineChanged = onTopLineChanged
        context.coordinator.jumpHandler = onJumpToTarget
        context.coordinator.renameScopesHandler = renameScopes
        context.coordinator.renameHandler = onRename
        context.coordinator.showInPDFHandler = onShowInPDF
        context.coordinator.usageLoader = usageLoader
        context.coordinator.openUsageHandler = onOpenUsage
        context.coordinator.imageResolverHandler = imageResolver
        context.coordinator.update(session: session, jump: jump, insert: insertRequest)
        context.coordinator.updateIssueMarks(issueMarks, messages: issueMessages)
        context.coordinator.updateChangeMarks(changeMarks)
        context.coordinator.updateTextMarks(
            problems: referenceProblems, hints: writingHints, diagnostics: diagnostics,
            buildLines: underlinesBuildIssues ? issueMarks : [:], buildMessages: issueMessages
        )
        context.coordinator.updateCompletion(provider: completionProvider, request: completionRequest)
        selectionProviderOwner.selectionProvider = { [weak coordinator = context.coordinator] in
            coordinator?.selectedText ?? ""
        }
        selectionProviderOwner.cursorLocationProvider = { [weak coordinator = context.coordinator] in
            coordinator?.cursorLocation ?? 0
        }
    }

    /// Beim Wechsel der Ansicht (Nur PDF und zurück) verschwindet die View: Auswahl und Scrollposition in die Sitzung
    /// schreiben, sonst gälte der Stand vom letzten Dateiwechsel.
    static func dismantleNSView(_ nsView: NSScrollView, coordinator: EditorCoordinator) {
        coordinator.rememberViewState()
    }
}

@MainActor
final class EditorCoordinator: NSObject, NSTextViewDelegate {
    /// Bei abgeschaltetem Umbruch: so breit, dass keine Zeile umbricht
    private static let unwrappedWidth = CGFloat.greatestFiniteMagnitude
    private static let textInset = NSSize(width: 8, height: 8)
    private static let cursorReportDelay = Duration.milliseconds(150)
    private static let topLineReportDelay = Duration.milliseconds(100)

    var onCursorMoved: ((CursorInfo) -> Void)?
    var onTopLineChanged: ((URL, Int) -> Void)?
    var jumpHandler: ((JumpTarget) -> Void)?
    var renameScopesHandler: ((DocumentSession, Int) -> [RenameScope])?
    var renameHandler: ((RenameScope) -> Void)?
    var showInPDFHandler: ((URL, Int) -> Void)?
    var usageLoader: ((RenameSubject) async -> [UsageEntry])?
    var openUsageHandler: ((UsageEntry) -> Void)?
    var imageResolverHandler: ((String, URL) -> URL?)?
    private let usagePresenter = UsagePopoverPresenter()

    var cursorLocation: Int { textView?.selectedRange().location ?? 0 }

    private var scrollView: NSScrollView!
    private var textView: LatexTextView!
    private var lineNumberRuler: LineNumberRulerView!
    private let placeholderStorage = NSTextStorage()
    private let foldGlyphDelegate = FoldGlyphDelegate()
    /// Wo der Cursor zuvor stand (für den Schritt nach rechts über eine zugeklappte Kopfzeile)
    private var previousCaretLocation = 0
    private var session: DocumentSession?
    private static let textMarkAttributes: [NSAttributedString.Key] = [.underlineStyle, .underlineColor, .toolTip]
    private var appliedProblems: [ReferenceProblem] = []
    private var appliedHints: [WritingHint] = []
    private var appliedDiagnostics: [TextMark] = []
    private var appliedBuildLines: [Int: BuildIssue.Severity] = [:]
    private var appliedBuildMessages: [Int: String] = [:]
    private weak var textMarksSession: DocumentSession?
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
    private var topLineReportTask: Task<Void, Never>?
    private var lastScrollOrigin = NSPoint.zero
    private var lastReportedTopLine: (url: URL, line: Int)?

    // MARK: Aufbau

    func makeScrollView() -> NSScrollView {
        let layoutManager = NSLayoutManager()
        layoutManager.allowsNonContiguousLayout = true
        layoutManager.delegate = foldGlyphDelegate
        placeholderStorage.addLayoutManager(layoutManager)

        let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)

        let textView = LatexTextView(frame: .zero, textContainer: container)
        configure(textView)
        completion = CompletionController(textView: textView) { [weak self] in self?.session }
        observeSettings()
        textView.onCompletionRequested = { [weak self] in self?.completion.trigger() }
        textView.onJumpToTarget = { [weak self] target in self?.jumpHandler?(target) }
        textView.renameScopes = { [weak self] location in
            guard let self, let session = self.session else { return [] }
            return self.renameScopesHandler?(session, location) ?? []
        }
        textView.onRename = { [weak self] scope in self?.renameHandler?(scope) }
        textView.imageResolver = { [weak self] path in
            guard let self, let url = self.session?.url else { return nil }
            return self.imageResolverHandler?(path, url)
        }
        textView.onShowUsages = { [weak self] subject, location in self?.showUsages(of: subject, at: location) }
        textView.onShowInPDF = { [weak self] location in self?.showInPDF(at: location) }
        textView.syntaxTokensProvider = { [weak self] range in
            self?.session?.syntaxTokens(in: range) ?? []
        }
        textView.allowsProseCorrection = { [weak self] in
            self?.session.map { FileKind(url: $0.url) == .tex } ?? false
        }
        self.textView = textView

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = true
        scrollView.documentView = textView
        self.scrollView = scrollView
        observeScrolling(of: scrollView)
        attachLineNumbers(to: scrollView, textView: textView)
        applyEditorSettings(affectsText: true)
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
        textView.isGrammarCheckingEnabled = false
        textView.drawsBackground = true
        textView.backgroundColor = EditorTheme.background
        textView.insertionPointColor = EditorTheme.text
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = .width
    }

    // MARK: Einstellungen

    /// Abgemeldet in `deinit` (Beobachter mit Block bleiben sonst für immer registriert)
    nonisolated(unsafe) private var observers: [NSObjectProtocol] = []

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    private func observeSettings() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: EditorAppearance.fontDidChange, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyEditorSettings(affectsText: true) }
        })
        observers.append(center.addObserver(forName: EditorSettings.viewDidChange, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyEditorSettings(affectsText: false) }
        })
    }

    /// Übernimmt die Einstellungen in die Ansicht. Schrift und Absatzstil nur, wenn sie sich geändert haben
    /// (`textView.font` setzt die Schrift des ganzen Texts und löst ein Neu-Layout aus). Den Text aller offenen
    /// Dateien passt `AppModel` an (`EditorStore.applyEditorFont`).
    private func applyEditorSettings(affectsText: Bool) {
        if affectsText {
            textView.font = EditorAppearance.font
            textView.typingAttributes = EditorAppearance.textAttributes
            textView.defaultParagraphStyle = EditorAppearance.paragraphStyle
            lineNumberRuler.updateFont()
        }
        textView.indentUnit = EditorSettings.indentation.unit
        textView.highlightsCurrentLine = EditorSettings.highlightsCurrentLine
        textView.columnGuideColumn = EditorSettings.showsColumnGuide ? EditorSettings.columnGuideColumn : nil
        showLineNumbers(EditorSettings.showsLineNumbers)
        applyLineWrapping(EditorSettings.wrapsLines)
        applySpelling(checks: EditorSettings.checksSpelling, language: EditorSettings.spellingLanguage)
        // Farbschema: Die Farben sind dynamisch, ein Neuzeichnen genügt
        textView.needsDisplay = true
        lineNumberRuler.needsDisplay = true
        textView.scheduleCurrentLineHighlightUpdate()
    }

    func showLineNumbers(_ shows: Bool) {
        if scrollView.rulersVisible != shows { scrollView.rulersVisible = shows }
    }

    func applyLineWrapping(_ wraps: Bool) {
        guard let container = textView.textContainer, container.widthTracksTextView != wraps || !wraps else { return }
        if wraps {
            textView.isHorizontallyResizable = false
            textView.autoresizingMask = .width
            container.widthTracksTextView = true
            textView.setFrameSize(NSSize(width: scrollView.contentSize.width, height: textView.frame.height))
            scrollView.hasHorizontalScroller = false
        } else {
            container.widthTracksTextView = false
            container.containerSize = NSSize(width: Self.unwrappedWidth, height: Self.unwrappedWidth)
            textView.isHorizontallyResizable = true
            textView.autoresizingMask = []
            scrollView.hasHorizontalScroller = true
        }
    }

    private(set) var appliedSpellingLanguage: String?

    func applySpelling(checks: Bool, language preferred: SpellingLanguage) {
        let checker = NSSpellChecker.shared
        let language = preferred.candidates.first(where: checker.availableLanguages.contains)
        let languageChanged = language != appliedSpellingLanguage
        if languageChanged { SpellingVocabulary.resetCache() }
        if let language, languageChanged {
            checker.automaticallyIdentifiesLanguages = false
            checker.setLanguage(language)
            appliedSpellingLanguage = language
        }
        // Aus und wieder an prüft den sichtbaren Text in der neuen Sprache neu
        if languageChanged, checks, textView.isContinuousSpellCheckingEnabled { textView.isContinuousSpellCheckingEnabled = false }
        if textView.isContinuousSpellCheckingEnabled != checks { textView.isContinuousSpellCheckingEnabled = checks }
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
            if didSwitch {
                self.restoreScrollOrigin()
                self.scheduleTopLineReport()
            }
            if let pendingLine { self.scroll(toLine: pendingLine) }
        }
    }

    /// Reihenfolge ist wichtig: Erst Storage tauschen und sofort eine gültige (geklemmte) Auswahl setzen,
    /// danach Ruler und Zeilenstreifen – beide nur vorgemerkt, damit aus `updateNSView` kein Layout startet.
    private func switchSession(to newSession: DocumentSession?) {
        completion.close()
        rememberViewState()
        session?.folds.detach()
        session = newSession
        attachFolds(of: newSession)
        let storage = newSession?.textStorage ?? placeholderStorage
        textView.layoutManager?.replaceTextStorage(storage)
        let selection = newSession?.savedSelection ?? NSRange(location: 0, length: 0)
        textView.setSelectedRange(selection.clamped(toLength: storage.length))
        textView.isEditable = newSession != nil
        lineNumberRuler.scheduleRefresh()
        textView.scheduleCurrentLineHighlightUpdate()
    }

    private func attachFolds(of newSession: DocumentSession?) {
        previousCaretLocation = 0
        textView.attach(folds: newSession?.folds, glyphDelegate: foldGlyphDelegate) { [weak self] in
            self?.lineNumberRuler.needsDisplay = true
        }
    }

    func rememberViewState() {
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
    }

    /// Zeile direkt aus dem Zeilenindex: Die entprellte Cursormeldung (für ⌘J) käme erst 150 ms später.
    private func showInPDF(at location: Int) {
        guard let session else { return }
        let line = session.lineIndex.clampedLine(containing: location) + 1
        showInPDFHandler?(session.url, line)
    }

    func updateIssueMarks(_ marks: [Int: BuildIssue.Severity], messages: [Int: String] = [:]) {
        lineNumberRuler.issueMessages = messages
        if lineNumberRuler.issueMarks != marks { lineNumberRuler.issueMarks = marks }
    }

    /// Unterstreicht Markierungen als temporäre Attribute des Layout-Managers (nicht im Text, nicht in `SyntaxTheme`):
    /// Sie ändern weder den Text noch den Undo-Verlauf und verschwinden beim Dateiwechsel mit der Sitzung. Fehler (unbekannte
    /// Verweise, Syntaxfehler, Build-Fehler) sind rot gestrichelt, Warnungen orange strichpunktiert, Schreibhinweise blau
    /// gepunktet – die Schwere steht auch im Muster. Alles gemeinsam, weil es dieselben Attribute nutzt.
    func updateTextMarks(
        problems: [ReferenceProblem], hints: [WritingHint], diagnostics: [TextMark] = [],
        buildLines: [Int: BuildIssue.Severity] = [:], buildMessages: [Int: String] = [:]
    ) {
        guard problems != appliedProblems || hints != appliedHints || diagnostics != appliedDiagnostics
            || buildLines != appliedBuildLines || buildMessages != appliedBuildMessages || textMarksSession !== session else { return }
        appliedProblems = problems
        appliedHints = hints
        appliedDiagnostics = diagnostics
        appliedBuildLines = buildLines
        appliedBuildMessages = buildMessages
        textMarksSession = session
        // Nicht synchron aus `updateNSView`: Das Layout soll nicht mitten in einem SwiftUI-Update angestoßen werden.
        DispatchQueue.main.async { [weak self] in self?.applyTextMarks() }
    }

    private func applyTextMarks() {
        guard let layoutManager = textView.layoutManager, let storage = textView.textStorage else { return }
        let whole = NSRange(location: 0, length: storage.length)
        for key in Self.textMarkAttributes { layoutManager.removeTemporaryAttribute(key, forCharacterRange: whole) }
        // Leichtes zuerst: Bei Überschneidungen gewinnt die schwerere Markierung
        for mark in allTextMarks().sorted(by: { $0.severity < $1.severity }) where NSMaxRange(mark.range) <= storage.length {
            layoutManager.addTemporaryAttributes(
                [.underlineStyle: Self.underlineStyle(for: mark.severity), .underlineColor: Self.underlineColor(for: mark.severity), .toolTip: mark.message],
                forCharacterRange: mark.range
            )
        }
    }

    private func allTextMarks() -> [TextMark] {
        var marks = appliedHints.map { TextMark(severity: .hint, range: $0.range, message: $0.message) }
        marks += appliedDiagnostics
        marks += appliedProblems.map { TextMark(severity: .error, range: $0.range, message: $0.message) }
        marks += buildLineMarks()
        return marks
    }

    /// Zeilen mit Fehler oder Warnung des Builds: der Text der Zeile ohne Einrückung. Boxen zeigt nur die Zeilenleiste.
    private func buildLineMarks() -> [TextMark] {
        guard let session, let storage = textView.textStorage else { return [] }
        let text = storage.mutableString
        return appliedBuildLines.compactMap { line, severity -> TextMark? in
            guard severity != .badBox, line >= 1, line <= session.lineIndex.lineCount else { return nil }
            var range = session.lineIndex.contentRange(ofLineNumber: line)
            while range.length > 0, [0x20, 0x09].contains(text.character(at: range.location)) {
                range = NSRange(location: range.location + 1, length: range.length - 1)
            }
            guard range.length > 0 else { return nil }
            let message = appliedBuildMessages[line] ?? (severity == .error ? "Fehler beim Kompilieren." : "Warnung beim Kompilieren.")
            return TextMark(severity: severity == .error ? .error : .warning, range: range, message: message)
        }
    }

    private static func underlineStyle(for severity: TextMark.Severity) -> Int {
        switch severity {
        case .hint: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue
        case .warning: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDashDot.rawValue
        case .error: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDash.rawValue
        }
    }

    private static func underlineColor(for severity: TextMark.Severity) -> NSColor {
        switch severity {
        case .hint: .systemBlue
        case .warning: .systemOrange
        case .error: .systemRed
        }
    }

    func updateChangeMarks(_ marks: ChangeMarks) {
        if lineNumberRuler.changeMarks != marks { lineNumberRuler.changeMarks = marks }
    }

    func updateCompletion(provider: CompletionProvider?, request: UUID?) {
        completion.provider = provider
        guard let request, request != lastHandledCompletionRequest else { return }
        lastHandledCompletionRequest = request
        DispatchQueue.main.async { [weak self] in self?.completion.trigger() }
    }

    // MARK: Verwendungen

    private func showUsages(of subject: RenameSubject, at location: Int) {
        guard let loader = usageLoader, let open = openUsageHandler, let textView, let layoutManager = textView.layoutManager,
              let container = textView.textContainer, let storage = textView.textStorage, storage.length > 0 else { return }
        let character = NSRange(location: min(location, storage.length - 1), length: 1)
        let glyphs = layoutManager.glyphRange(forCharacterRange: character, actualCharacterRange: nil)
        var rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: container)
        rect.origin.x += textView.textContainerOrigin.x
        rect.origin.y += textView.textContainerOrigin.y
        usagePresenter.present(subject: subject, from: textView, at: rect, loader: loader, open: open)
    }

    // MARK: Oberste sichtbare Zeile

    private func observeScrolling(of scrollView: NSScrollView) {
        scrollView.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(
            self, selector: #selector(clipViewBoundsDidChange(_:)), name: NSView.boundsDidChangeNotification, object: scrollView.contentView
        )
    }

    /// Nur echtes Scrollen zählt: Größenänderungen (Layout, Umbruch) verschieben den Ursprung nicht. Sonst könnte jede
    /// Meldung über ein SwiftUI-Update eine neue Größenänderung und damit die nächste Meldung auslösen.
    @objc private func clipViewBoundsDidChange(_ notification: Notification) {
        let origin = scrollView.contentView.bounds.origin
        guard origin != lastScrollOrigin else { return }
        lastScrollOrigin = origin
        scheduleTopLineReport()
    }

    func scheduleTopLineReport() {
        topLineReportTask?.cancel()
        topLineReportTask = Task { [weak self] in
            try? await Task.sleep(for: Self.topLineReportDelay)
            guard !Task.isCancelled else { return }
            self?.reportTopLine()
        }
    }

    private func reportTopLine() {
        guard let session, let textView, textView.window != nil else { return }
        let point = NSPoint(x: textView.textContainerOrigin.x + 1, y: textView.visibleRect.minY + 1)
        let location = textView.characterIndexForInsertion(at: point)
        let line = session.lineIndex.clampedLine(containing: min(location, session.textStorage.length)) + 1
        if let last = lastReportedTopLine, last.url == session.url, last.line == line { return }
        lastReportedTopLine = (session.url, line)
        onTopLineChanged?(session.url, line)
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
        let selection = textView.selectedRange().clamped(toLength: session.textStorage.length)
        let lineIndex = session.lineIndex
        let line = lineIndex.clampedLine(containing: selection.location)
        let words = selection.length > 0 && selection.length <= Self.maximumSelectedTextLength
            ? WordCounter.count(in: session.textStorage.mutableString.substring(with: selection)) : 0
        onCursorMoved?(CursorInfo(file: session.url, line: line + 1, column: selection.location - lineIndex.start(ofLine: line) + 1,
                                  selectedCharacters: selection.length, selectedWords: words))
    }

    // MARK: NSTextViewDelegate

    func textViewDidChangeSelection(_ notification: Notification) {
        keepSelectionOutOfFolds()
        scheduleCursorReport()
        completion.selectionDidChange()
    }

    /// Der Cursor steht nie in zugeklapptem Text: ans Ende der Kopfzeile oder aufklappen (siehe `FoldState.adjustedSelection`).
    private func keepSelectionOutOfFolds() {
        guard let folds = session?.folds else { return }
        let selection = textView.selectedRange()
        defer { previousCaretLocation = textView.selectedRange().location }
        let length = textView.textStorage?.length ?? 0
        guard let adjusted = folds.adjustedSelection(selection, previousLocation: previousCaretLocation, textLength: length) else { return }
        textView.setSelectedRange(adjusted)
    }

    func textView(_ view: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
        pendingReplacement = text
        return true
    }

    func textDidChange(_ notification: Notification) {
        scheduleTopLineReport()
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

    /// Verwirft Rechtschreibtreffer in LaTeX-Syntax und Fachwörter des Standardvokabulars. `LatexTextView.setSpellingState` greift zusätzlich,
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
        let latexView = view as? LatexTextView
        return results.filter { result in
            result.resultType != .spelling
                || (!tokens.containsOverlap(with: result.range) && latexView?.isTechnicalTerm(result.range) != true)
        }
    }
}
