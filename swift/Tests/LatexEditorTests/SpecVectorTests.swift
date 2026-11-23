import Foundation
import Testing
@testable import LatexEditor

// Gegenprobe der gemeinsamen Testvektoren in `shared/spec/` (Format und Operationen: `shared/spec/README.md`).
// Jede Vektordatei hat einen Test, der über alle Fälle läuft; ein Fehlschlag nennt Datei, `id` und `name` des Falls.
// Nicht geprüft werden die Einträge unter `skipped` (bewusst ausgelassen) und Schlüssel, die in `expect` fehlen.
// Alle sechs Dateien lassen sich ohne AppKit-Fenster abbilden; es gibt keine nicht abbildbare Operation.

private typealias JSONObject = [String: Any]

// MARK: - Laden

private struct SpecCase {
    let file: String
    let id: String
    let name: String
    let input: JSONObject
    /// `NSNull`, wenn der Fall „keine Bearbeitung“ (`null`) erwartet
    let expect: Any

    var label: String { "\(file) / \(id) (\(name))" }
    var key: String { "\(file)/\(id)" }
    var op: String? { input["op"] as? String }
    var expectation: JSONObject { expect as? JSONObject ?? [:] }
}

private enum SpecVectors {
    /// `swift/Tests/LatexEditorTests/SpecVectorTests.swift` → Repo-Wurzel → `shared/spec`
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("shared/spec", isDirectory: true)

    static var exists: Bool {
        FileManager.default.fileExists(atPath: directory.appendingPathComponent("latex-tokenizer.json").path)
    }

    /// Bekannte, geklärte Abweichungen zwischen Vektor und Swift (Schlüssel `datei/id`) mit Begründung.
    /// Sie laufen unter `withKnownIssue`: Der Test bleibt grün, und wird die Abweichung behoben, schlägt er an.
    static let knownMismatches: [String: String] = [:]

    static func cases(in file: String) throws -> [SpecCase] {
        let data = try Data(contentsOf: directory.appendingPathComponent(file + ".json"))
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? JSONObject)
        let rawCases = try #require(root["cases"] as? [JSONObject])
        return rawCases.map { raw in
            SpecCase(
                file: file,
                id: raw["id"] as? String ?? "?",
                name: raw["name"] as? String ?? "?",
                input: raw["input"] as? JSONObject ?? [:],
                expect: raw["expect"] ?? NSNull()
            )
        }
    }

    static func run(_ file: String, _ check: (SpecCase) -> Void) throws {
        let cases = try cases(in: file)
        #expect(!cases.isEmpty, "\(file): keine Fälle gelesen")
        for spec in cases {
            if let reason = knownMismatches[spec.key] {
                withKnownIssue(Comment(rawValue: "\(spec.label): \(reason)")) { check(spec) }
            } else {
                check(spec)
            }
        }
    }
}

private func expectEqual<Value: Equatable>(_ actual: Value, _ expected: Value, _ spec: SpecCase, _ what: String) {
    #expect(actual == expected, "\(spec.label): \(what) erwartet \(expected), tatsächlich \(actual)")
}

private func expectTrue(_ condition: Bool, _ spec: SpecCase, _ what: @autoclosure () -> String) {
    #expect(condition, "\(spec.label): \(what())")
}

private func unreadable(_ spec: SpecCase, _ what: String) {
    Issue.record("\(spec.label): \(what) nicht lesbar oder unbekannt")
}

// MARK: - Tokens und Zustände

private struct TokenValue: Equatable, CustomStringConvertible {
    let kind: String
    let text: String

    var description: String { "\(kind) „\(text)“" }
}

private func kindName(_ kind: TokenKind) -> String {
    switch kind {
    case .command: "command"
    case .delimiter: "delimiter"
    case .optionalArgument: "optionalArgument"
    case .keyArgument: "keyArgument"
    case .math: "math"
    case .comment: "comment"
    case .verbatim: "verbatim"
    }
}

/// Text der Tokens aus `source`; `lineOffset` ist die absolute Position des Zeilenanfangs in `source`
private func tokenValues(_ tokens: [SyntaxToken], in source: String, lineOffset: Int = 0) -> [TokenValue] {
    let text = source as NSString
    return tokens.map { TokenValue(kind: kindName($0.kind), text: text.substring(with: NSRange(location: $0.location - lineOffset, length: $0.length))) }
}

private func tokenValue(_ json: Any?) -> TokenValue? {
    guard let object = json as? JSONObject, let kind = object["kind"] as? String, let text = object["text"] as? String else { return nil }
    return TokenValue(kind: kind, text: text)
}

private func tokenValues(_ json: Any?) -> [TokenValue] {
    (json as? [Any] ?? []).compactMap(tokenValue)
}

private let mathDelimiters: [String: MathDelimiter] = [
    "dollar": .dollar, "doubleDollar": .doubleDollar, "parenthesis": .parenthesis, "bracket": .bracket,
]
private let bibPhases: [String: BibLexState.Phase] = [
    "outside": .outside, "entryOpening": .entryOpening, "key": .key, "fieldName": .fieldName,
    "equals": .equals, "value": .value, "comment": .comment,
]
private let bibKinds: [String: BibLexState.EntryKind] = ["regular": .regular, "withoutKey": .withoutKey, "comment": .comment]

/// Legt die angegebenen Felder über `base`; fehlende Felder bleiben, wie sie in `base` sind (Anfangszustand oder Ist-Zustand).
private func bibState(_ json: JSONObject, over base: BibLexState = BibLexState()) -> BibLexState {
    var state = base
    if let name = json["phase"] as? String, let phase = bibPhases[name] { state.phase = phase }
    if let name = json["kind"] as? String, let kind = bibKinds[name] { state.kind = kind }
    if let depth = json["depth"] as? Int { state.depth = depth }
    if let inQuotes = json["inQuotes"] as? Bool { state.inQuotes = inQuotes }
    if let closes = json["closesWithParenthesis"] as? Bool { state.closesWithParenthesis = closes }
    return state
}

private func lexState(_ json: Any?) -> LexState? {
    if let name = json as? String { return name == "normal" ? .normal : nil }
    guard let object = json as? JSONObject, object.count == 1, let (key, value) = object.first else { return nil }
    switch key {
    case "math": return (value as? String).flatMap { mathDelimiters[$0] }.map(LexState.math)
    case "mathEnvironment": return (value as? String).map(LexState.mathEnvironment)
    case "verbatimEnvironment": return (value as? String).map(LexState.verbatimEnvironment)
    case "bibtex": return (value as? JSONObject).map { LexState.bibtex(bibState($0)) }
    default: return nil
    }
}

private func tokenizeLine(_ line: String, lineOffset: Int, from state: LexState) -> (tokens: [SyntaxToken], state: LexState) {
    let characters = Array(line.utf16)
    var tokens: [SyntaxToken] = []
    let end = characters.withUnsafeBufferPointer {
        LatexTokenizer.tokenize($0, lineOffset: lineOffset, from: state, into: &tokens)
    }
    return (tokens, end)
}

// MARK: - latex-tokenizer.json

private func checkLine(_ line: String, _ result: (tokens: [SyntaxToken], state: LexState), _ expect: JSONObject, _ spec: SpecCase) {
    let actual = tokenValues(result.tokens, in: line)
    if let expected = expect["tokens"] {
        expectEqual(actual, tokenValues(expected), spec, "Tokens")
    }
    if let expected = expect["lastToken"] {
        expectEqual(actual.last, tokenValue(expected), spec, "letztes Token")
    }
    if let expected = expect["state"] {
        guard let state = lexState(expected) else { return unreadable(spec, "Zustand") }
        expectEqual(result.state, state, spec, "Endzustand")
    }
}

private func checkTokenizeLine(_ spec: SpecCase) {
    guard let line = spec.input["line"] as? String, let state = lexState(spec.input["state"]) else { return unreadable(spec, "Eingabe") }
    checkLine(line, tokenizeLine(line, lineOffset: 0, from: state), spec.expectation, spec)
}

private func checkTokenizeChain(_ spec: SpecCase) {
    guard let lines = spec.input["lines"] as? [String], var state = lexState(spec.input["state"]),
          let steps = spec.expectation["steps"] as? [JSONObject] else { return unreadable(spec, "Eingabe") }
    expectEqual(steps.count, lines.count, spec, "Anzahl der Schritte")
    for (line, step) in zip(lines, steps) {
        let result = tokenizeLine(line, lineOffset: 0, from: state)
        checkLine(line, result, step, spec)
        state = result.state
    }
}

private func checkTokenizeLineWithOffset(_ spec: SpecCase) {
    guard let line = spec.input["line"] as? String, let offset = spec.input["lineOffset"] as? Int,
          let state = lexState(spec.input["state"]),
          let expected = spec.expectation["tokensByRange"] as? [JSONObject] else { return unreadable(spec, "Eingabe") }
    let actual = tokenizeLine(line, lineOffset: offset, from: state).tokens.map { "\(kindName($0.kind)) \($0.location)+\($0.length)" }
    let wanted = expected.map { "\($0["kind"] as? String ?? "?") \($0["location"] as? Int ?? -1)+\($0["length"] as? Int ?? -1)" }
    expectEqual(actual, wanted, spec, "Tokens nach Position")
}

private func checkHighlightAll(_ spec: SpecCase) {
    guard let source = spec.input["text"] as? String, let expected = spec.expectation["endStates"] as? [Any] else {
        return unreadable(spec, "Eingabe")
    }
    let text = source as NSString
    var highlighter = SyntaxHighlighter()
    _ = highlighter.highlightAll(text, lines: LineIndex(text: text))
    let states = expected.compactMap(lexState)
    expectEqual(states.count, expected.count, spec, "lesbare Zustände")
    expectEqual(highlighter.endStates, states, spec, "Endzustände je Zeile")
}

private func checkHighlightEdit(_ spec: SpecCase) {
    guard let source = spec.input["text"] as? String, let edit = spec.input["edit"] as? JSONObject,
          let anchor = edit["locationOfSubstring"] as? String, let offset = edit["offset"] as? Int,
          let length = edit["length"] as? Int, let replacement = edit["replacement"] as? String else { return unreadable(spec, "Eingabe") }
    let text = NSMutableString(string: source)
    var lines = LineIndex(text: text)
    var highlighter = SyntaxHighlighter()
    _ = highlighter.highlightAll(text, lines: lines)

    let location = text.range(of: anchor).location + offset
    text.replaceCharacters(in: NSRange(location: location, length: length), with: replacement)
    let insertedLength = (replacement as NSString).length
    let splice = lines.applyEdit(in: text, editedRange: NSRange(location: location, length: insertedLength), changeInLength: insertedLength - length)
    let update = highlighter.update(text, lines: lines, splice: splice)
    checkEdit(update, highlighter, spec.expectation, spec)
}

private func checkEdit(_ update: HighlightUpdate, _ highlighter: SyntaxHighlighter, _ expect: JSONObject, _ spec: SpecCase) {
    if let count = expect["tokenizedLineCount"] as? Int {
        expectEqual(update.tokenizedLineCount, count, spec, "neu tokenisierte Zeilen")
    }
    if let kind = expect["allTokenKinds"] as? String {
        expectTrue(update.tokens.allSatisfy { kindName($0.kind) == kind }, spec, "nicht alle neuen Tokens sind \(kind)")
    }
    for (line, expected) in expect["endStatesAfterEdit"] as? JSONObject ?? [:] {
        guard let index = Int(line), highlighter.endStates.indices.contains(index), let state = lexState(expected) else {
            unreadable(spec, "Zeile \(line)")
            continue
        }
        expectEqual(highlighter.endStates[index], state, spec, "Endzustand nach Bearbeitung in Zeile \(line)")
    }
}

// MARK: - bib-tokenizer.json

private func checkBibHighlight(_ spec: SpecCase) {
    guard let source = spec.input["source"] as? String, spec.input["language"] as? String == "bibtex" else {
        return unreadable(spec, "Eingabe")
    }
    let text = source as NSString
    var highlighter = SyntaxHighlighter(language: .bibtex)
    let tokens = highlighter.highlightAll(text, lines: LineIndex(text: text))
    var values = tokenValues(tokens, in: source)
    if spec.input["visibleOnly"] as? Bool == true {
        values = values.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
    checkBibTokens(values, spec.expectation, spec)
    checkBibStates(highlighter.endStates, spec.expectation, spec)
}

private func checkBibTokens(_ actual: [TokenValue], _ expect: JSONObject, _ spec: SpecCase) {
    if let expected = expect["tokens"] {
        expectEqual(actual, tokenValues(expected), spec, "Tokens")
    }
    if let expected = expect["tokensPrefix"] {
        let wanted = tokenValues(expected)
        expectEqual(Array(actual.prefix(wanted.count)), wanted, spec, "Tokens am Anfang")
    }
    if let expected = expect["tokensSuffix"] {
        let wanted = tokenValues(expected)
        expectEqual(Array(actual.suffix(wanted.count)), wanted, spec, "Tokens am Ende")
    }
    for token in tokenValues(expect["tokensContain"]) {
        expectTrue(actual.contains(token), spec, "Token \(token) fehlt")
    }
    for forbidden in expect["tokensNoneContainText"] as? [String] ?? [] {
        expectTrue(!actual.contains { $0.text.contains(forbidden) }, spec, "ein Token enthält „\(forbidden)“")
    }
}

private func checkBibStates(_ states: [LexState], _ expect: JSONObject, _ spec: SpecCase) {
    for (line, expected) in expect["endStates"] as? JSONObject ?? [:] {
        guard let index = Int(line), states.indices.contains(index), let state = lexState(expected) else {
            unreadable(spec, "Zeile \(line)")
            continue
        }
        expectEqual(states[index], state, spec, "Endzustand in Zeile \(line)")
    }
    for (line, expected) in expect["endStatesPartial"] as? JSONObject ?? [:] {
        guard let index = Int(line), states.indices.contains(index), case let .bibtex(actual) = states[index],
              let partial = (expected as? JSONObject)?["bibtex"] as? JSONObject else {
            unreadable(spec, "Zeile \(line)")
            continue
        }
        expectEqual(bibState(partial, over: actual), actual, spec, "Teilzustand in Zeile \(line) (\(partial))")
    }
}

private func checkLanguageFromPath(_ spec: SpecCase) {
    guard let path = spec.input["path"] as? String, let name = spec.expectation["language"] as? String else {
        return unreadable(spec, "Eingabe")
    }
    let language = SyntaxLanguage(url: URL(fileURLWithPath: path))
    expectEqual(language == .bibtex ? "bibtex" : "latex", name, spec, "Sprache")
}

// MARK: - latex-source.json

private func checkCommentStart(_ spec: SpecCase) {
    guard let line = spec.input["line"] as? String, spec.expectation.keys.contains("offset") else { return unreadable(spec, "Eingabe") }
    let actual = LatexComments.commentStart(in: line).map { line.utf16.distance(from: line.utf16.startIndex, to: $0) }
    expectEqual(actual, spec.expectation["offset"] as? Int, spec, "Kommentarbeginn")
}

private func checkMasking(_ spec: SpecCase) {
    guard let text = spec.input["text"] as? String else { return unreadable(spec, "Eingabe") }
    let masked = LatexComments.masking(text)
    let expect = spec.expectation
    if expect["sameUtf16Length"] as? Bool == true {
        expectEqual(masked.utf16.count, text.utf16.count, spec, "UTF-16-Länge")
    }
    for needle in expect["contains"] as? [String] ?? [] {
        expectTrue(masked.contains(needle), spec, "Ergebnis enthält „\(needle)“ nicht")
    }
    for needle in expect["notContains"] as? [String] ?? [] {
        expectTrue(!masked.contains(needle), spec, "Ergebnis enthält „\(needle)“")
    }
    if let suffix = expect["hasSuffix"] as? String {
        expectTrue(masked.hasSuffix(suffix), spec, "Ergebnis endet nicht auf „\(suffix)“")
    }
}

private func checkIsInComment(_ spec: SpecCase) {
    guard let line = spec.input["line"] as? String, let lineStart = spec.input["lineStart"] as? Int,
          let location = spec.input["location"] as? Int, let expected = spec.expectation["isInComment"] as? Bool else {
        return unreadable(spec, "Eingabe")
    }
    expectEqual(LatexComments.isInComment(line as NSString, lineStart: lineStart, location: location), expected, spec, "isInComment")
}

private func checkReferenceKeys(_ spec: SpecCase) {
    guard let text = spec.input["text"] as? String, let expected = spec.expectation["keys"] as? [String] else {
        return unreadable(spec, "Eingabe")
    }
    expectEqual(LatexReferences.scan(text).map(\.key), expected, spec, "Schlüssel")
}

private func checkIsInsideCode(_ spec: SpecCase) {
    guard let source = spec.input["text"] as? String, spec.input["at"] as? String == "end",
          let expected = spec.expectation["isInsideCode"] as? Bool else { return unreadable(spec, "Eingabe") }
    let text = source as NSString
    expectEqual(LatexEnvironments.isInsideCode(at: text.length, in: text), expected, spec, "isInsideCode")
}

// MARK: - fold-regions.json

private struct RegionValue: Equatable, CustomStringConvertible {
    let kind: String
    let startLine: Int
    let endLine: Int

    var description: String { "\(kind) \(startLine)–\(endLine)" }
}

private func foldKind(_ json: Any?) -> FoldRegion.Kind? {
    if let name = json as? String {
        return name == "section" ? .section : name == "comments" ? .comments : nil
    }
    return ((json as? JSONObject)?["environment"] as? String).map(FoldRegion.Kind.environment)
}

private func foldRegion(_ json: Any?) -> FoldRegion? {
    guard let object = json as? JSONObject, let kind = foldKind(object["kind"]),
          let start = object["startLine"] as? Int, let end = object["endLine"] as? Int else { return nil }
    return FoldRegion(kind: kind, startLine: start, endLine: end)
}

private func regionValue(_ region: FoldRegion) -> RegionValue {
    let kind = switch region.kind {
    case .section: "section"
    case .comments: "comments"
    case let .environment(name): "environment \(name)"
    }
    return RegionValue(kind: kind, startLine: region.startLine, endLine: region.endLine)
}

private func checkFoldRegions(_ spec: SpecCase) {
    guard let text = spec.input["text"] as? String, let expected = spec.expectation["regions"] as? [Any] else {
        return unreadable(spec, "Eingabe")
    }
    let wanted = expected.compactMap(foldRegion).map(regionValue)
    expectEqual(wanted.count, expected.count, spec, "lesbare Bereiche")
    expectEqual(FoldScanner.regions(in: text).map(regionValue), wanted, spec, "Bereiche")
}

private func checkFoldHiddenRange(_ spec: SpecCase) {
    guard let source = spec.input["text"] as? String, let region = foldRegion(spec.input["region"]),
          let range = spec.expectation["hiddenRange"] as? JSONObject, let location = range["location"] as? Int,
          let length = range["length"] as? Int, let hiddenText = spec.expectation["hiddenText"] as? String else {
        return unreadable(spec, "Eingabe")
    }
    let text = source as NSString
    let hidden = region.hiddenRange(in: LineIndex(text: text))
    expectEqual(hidden, NSRange(location: location, length: length), spec, "ausgeblendeter Bereich")
    if NSMaxRange(hidden) <= text.length {
        expectEqual(text.substring(with: hidden), hiddenText, spec, "ausgeblendeter Text")
    }
}

// MARK: - syntax-checker.json

private func checkSyntaxMarks(_ spec: SpecCase) {
    guard let text = spec.input["text"] as? String else { return unreadable(spec, "Eingabe") }
    let marks = SyntaxChecker.marks(masked: LatexMasking.scannable(text) as NSString)
    let expect = spec.expectation
    if let count = expect["count"] as? Int {
        expectEqual(marks.count, count, spec, "Anzahl der Markierungen")
    }
    if let severity = expect["allSeverity"] as? String {
        expectTrue(severity == "error" && marks.allSatisfy { $0.severity == .error }, spec, "nicht alle Markierungen sind \(severity)")
    }
    if let location = expect["firstLocation"] as? Int {
        expectEqual(marks.first?.range.location, location, spec, "Position der ersten Markierung")
    }
    for needle in expect["foundTexts"] as? [String] ?? [] {
        let found = marks.contains { (text as NSString).substring(with: $0.range) == needle }
        expectTrue(found, spec, "keine Markierung über „\(needle)“ (gefunden: \(marks.map { (text as NSString).substring(with: $0.range) }))")
    }
    if let fragment = expect["firstMessageContains"] as? String {
        expectTrue(marks.first?.message.contains(fragment) == true, spec, "erste Meldung „\(marks.first?.message ?? "-")“ enthält „\(fragment)“ nicht")
    }
}

// MARK: - text-editing.json

/// Text samt Auswahl in der Markierungsnotation: `|` Cursor, `«…»` Auswahl
private struct MarkedText {
    let text: NSString
    let selection: NSRange

    init(_ marked: String) {
        let start = (marked as NSString).range(of: "«")
        if start.location != NSNotFound {
            let end = (marked as NSString).range(of: "»")
            text = marked.replacingOccurrences(of: "«", with: "").replacingOccurrences(of: "»", with: "") as NSString
            selection = NSRange(location: start.location, length: end.location - start.location - 1)
        } else {
            text = marked.replacingOccurrences(of: "|", with: "") as NSString
            selection = NSRange(location: (marked as NSString).range(of: "|").location, length: 0)
        }
    }

    /// Text nach der Bearbeitung mit der neuen Auswahl; `nil`, wenn es keine Bearbeitung gibt
    func rendered(_ edit: TextEdit?) -> String? {
        guard let edit else { return nil }
        let result = NSMutableString(string: text)
        result.replaceCharacters(in: edit.range, with: edit.text)
        if edit.selection.length == 0 {
            result.insert("|", at: edit.selection.location)
        } else {
            result.insert("»", at: NSMaxRange(edit.selection))
            result.insert("«", at: edit.selection.location)
        }
        return result as String
    }
}

/// Einrückung ist im Vektor der Tabulator, unabhängig von den Einstellungen des Nutzers
private let vectorIndentUnit = TextEditing.tabUnit

private func textEdit(_ spec: SpecCase, _ operation: String, _ marked: MarkedText) -> TextEdit? {
    let text = marked.text
    let selection = marked.selection
    switch operation {
    case "typed": return TextEditing.typed(spec.input["character"] as? String ?? "", in: text, selection: selection)
    case "deleteBackward": return TextEditing.deleteBackward(in: text, selection: selection)
    case "newline": return TextEditing.newline(in: text, selection: selection, unit: vectorIndentUnit)
    case "toggleComment": return TextEditing.toggleComment(in: text, selection: selection)
    case "indent": return TextEditing.indent(in: text, selection: selection, unit: vectorIndentUnit)
    case "outdent": return TextEditing.outdent(in: text, selection: selection, unit: vectorIndentUnit)
    case "moveLines": return TextEditing.moveLines(up: spec.input["up"] as? Bool ?? false, in: text, selection: selection)
    case "duplicateLines": return TextEditing.duplicateLines(in: text, selection: selection)
    case "deleteLines": return TextEditing.deleteLines(in: text, selection: selection)
    case "wrap": return TextEditing.wrap(spec.input["command"] as? String ?? "", in: text, selection: selection)
    default:
        unreadable(spec, "Operation \(operation)")
        return nil
    }
}

private func checkTextEditing(_ spec: SpecCase) {
    guard let operation = spec.op, let source = spec.input["marked"] as? String else { return unreadable(spec, "Eingabe") }
    let marked = MarkedText(source)
    let actual = marked.rendered(textEdit(spec, operation, marked))
    let expected = spec.expect as? String
    expectTrue(expected != nil || spec.expect is NSNull, spec, "erwartetes Ergebnis weder Text noch null")
    expectEqual(actual, expected, spec, "Ergebnis")
}

// MARK: - Tests

@Suite("Gemeinsame Testvektoren (shared/spec)", .enabled(if: SpecVectors.exists))
struct SpecVectorTests {
    @Test("latex-tokenizer.json: Tokenizer und Highlighter")
    func latexTokenizerVectors() throws {
        try SpecVectors.run("latex-tokenizer") { spec in
            switch spec.op {
            case "tokenizeLine": checkTokenizeLine(spec)
            case "tokenizeChain": checkTokenizeChain(spec)
            case "tokenizeLineWithOffset": checkTokenizeLineWithOffset(spec)
            case "highlightAll": checkHighlightAll(spec)
            case "highlightEdit": checkHighlightEdit(spec)
            default: unreadable(spec, "Operation \(spec.op ?? "-")")
            }
        }
    }

    @Test("bib-tokenizer.json: BibTeX-Tokenizer und Sprache nach Dateiendung")
    func bibTokenizerVectors() throws {
        try SpecVectors.run("bib-tokenizer") { spec in
            switch spec.op {
            case "highlightAll": checkBibHighlight(spec)
            case "languageFromPath": checkLanguageFromPath(spec)
            default: unreadable(spec, "Operation \(spec.op ?? "-")")
            }
        }
    }

    @Test("latex-source.json: Kommentarregel, Maskierung, Verweisschlüssel, Code-Umgebung")
    func latexSourceVectors() throws {
        try SpecVectors.run("latex-source") { spec in
            switch spec.op {
            case "commentStart": checkCommentStart(spec)
            case "masking": checkMasking(spec)
            case "isInComment": checkIsInComment(spec)
            case "referenceKeys": checkReferenceKeys(spec)
            case "isInsideCode": checkIsInsideCode(spec)
            default: unreadable(spec, "Operation \(spec.op ?? "-")")
            }
        }
    }

    @Test("fold-regions.json: Einklappen-Scanner")
    func foldRegionVectors() throws {
        try SpecVectors.run("fold-regions") { spec in
            switch spec.op {
            case "regions": checkFoldRegions(spec)
            case "hiddenRange": checkFoldHiddenRange(spec)
            default: unreadable(spec, "Operation \(spec.op ?? "-")")
            }
        }
    }

    @Test("syntax-checker.json: Syntaxprüfung")
    func syntaxCheckerVectors() throws {
        try SpecVectors.run("syntax-checker") { spec in
            checkSyntaxMarks(spec)
        }
    }

    @Test("text-editing.json: Textbearbeitungs-Aktionen")
    func textEditingVectors() throws {
        try SpecVectors.run("text-editing") { spec in
            checkTextEditing(spec)
        }
    }
}
