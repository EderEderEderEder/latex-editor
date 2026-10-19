import AppKit
import Foundation
import Testing
@testable import LatexEditor

private func context(_ textWithCursor: String) -> CompletionContext? {
    let cursor = (textWithCursor as NSString).range(of: "|").location
    let text = textWithCursor.replacingOccurrences(of: "|", with: "") as NSString
    let lineStart = text.lineRange(for: NSRange(location: cursor, length: 0)).location
    return CompletionContextDetector.detect(in: text, cursor: cursor, lineStart: lineStart)
}

private func apply(_ value: String, to textWithCursor: String) throws -> String {
    let detected = try #require(context(textWithCursor))
    let text = NSMutableString(string: textWithCursor.replacingOccurrences(of: "|", with: ""))
    let edit = CompletionApplier.edit(for: CompletionItem(kind: .option, text: value), context: detected, in: text)
    text.replaceCharacters(in: edit.range, with: edit.text)
    text.insert("|", at: edit.selection.location)
    return text as String
}

@Suite("Vervollständigung: Optionen erkennen")
struct OptionContextTests {
    @Test("Befehle und Umgebungen mit Optionen; Schlüssel und Wert")
    func targets() {
        #expect(context("\\includegraphics[|")?.kind == .option(.graphics, key: nil))
        #expect(context("\\includegraphics[width=0.5|")?.kind == .option(.graphics, key: "width"))
        #expect(context("\\includegraphics[width=0.5|")?.prefix == "0.5")
        #expect(context("\\includegraphics[keepaspectratio, wi|")?.prefix == "wi")
        #expect(context("\\begin{figure}[|")?.kind == .option(.floatPlacement, key: nil))
        #expect(context("\\begin{program}[H|")?.prefix == "H")
        #expect(context("\\begin{tabular}[|")?.kind == .option(.boxPosition, key: nil))
        #expect(context("\\cite[vgl.][|")?.kind == .option(.citation, key: nil))
        #expect(context("\\documentclass[type=bachelor,the|]{hgbthesis}")?.kind == .option(.documentClass("hgbthesis"), key: nil))
        #expect(context("\\usepackage[|]{babel}")?.kind == .option(.package("babel"), key: nil))
        #expect(context("\\usepackage[|")?.kind == .option(.package(""), key: nil))
    }

    @Test("Keine Option: unbekannte Befehle, geschlossene Klammer, Zeilenumbruch \\\\[…], Kommentar")
    func notOptions() {
        #expect(context("\\section[|") == nil)
        #expect(context("\\item[|") == nil)
        #expect(context("\\includegraphics[width=1cm] |") == nil)
        #expect(context("Text\\\\[|") == nil)
        #expect(context("% \\includegraphics[|") == nil)
        #expect(context("\\begin{itemize}[|") == nil)
    }
}

@Suite("Vervollständigung: Optionen einfügen")
struct OptionApplierTests {
    @Test("Schlüssel mit = lässt den Cursor dahinter; Werte und Schalter ersetzen nur ihre Option")
    func keysAndValues() throws {
        #expect(try apply("width=", to: "\\includegraphics[wi|") == "\\includegraphics[width=|")
        #expect(try apply("0.8\\textwidth", to: "\\includegraphics[width=0.|]{a}") == "\\includegraphics[width=0.8\\textwidth|]{a}")
        #expect(try apply("height=", to: "\\includegraphics[|width=\\textwidth]") == "\\includegraphics[height=|\\textwidth]")
        #expect(try apply("twoside", to: "\\documentclass[a4paper,tw|,12pt]{report}") == "\\documentclass[a4paper,twoside|,12pt]{report}")
    }

    @Test("Bei nur einem Wert (Platzierung, Zitat) wird ] ergänzt, wenn es fehlt")
    func singleValue() throws {
        #expect(try apply("H", to: "\\begin{figure}[|") == "\\begin{figure}[H]|")
        #expect(try apply("H", to: "\\begin{figure}[h|]") == "\\begin{figure}[H|]")
        #expect(try apply("S.~", to: "\\cite[|") == "\\cite[S.~]|")
    }
}

@Suite("Vervollständigung: Optionen aus Klassen und Paketen")
struct OptionScannerTests {
    /// Ausschnitte im Stil der HgbThesis (hgbthesis.cls, hgbdict.sty, hgblistings.sty)
    private let cls = """
        \\@RegisterClassOption{type}{bachelor}
        \\@RegisterClassOption{type}{master}
        \\@RegisterClassOption{language}{german}
        \\DeclareKeys{
        \tbachelor.code \t= {\\renewcommand{\\hgb@ThesisType}{bachelor}\\@WarnDeprecatedOption{bachelor}{type=bachelor}},
        \ttype.code \t\t\t\t= {\\@ValidateClassOption{type}{#1}},
        \ttheme.code \t\t\t\t= \\renewcommand{\\@ThemeID}{#1},
        \tdegree.code\t\t\t\t= \\renewcommand{\\hgb@DegreeKey}{#1},
        \tlanguage.code\t\t\t= {\\@ValidateClassOption{language}{#1}},
        \tcodestyle.code\t\t\t= \\PassOptionsToPackage{codestyle=#1}{hgblistings},
        \ttwoside.code\t\t\t= {},
        \toneside.code\t\t\t= {\\renewcommand{\\hgb@@pagelayout}{oneside}%
        \t\t\t\t\t\t\t\t\\@WarnDeprecatedOption{oneside}{twoside=false}},
        \ttwoside.default:n\t\t= true,
        }
        \\DeclareOption{draft}{}
        % \\DeclareOption{auskommentiert}{}
        """

    @Test("Schlüssel aus \\DeclareKeys (ohne veraltete), Werte aus Registrierung, Wahrheitswerte, Schalter")
    func classOptions() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let classFile = try project.write("hgbthesis.cls", cls)
        let dictionary = try project.write("hgbdict.sty", "\\hgbDefineDegree{engineering}{BSc}{MSc}\n\\hgbDefineDegree{law}{}{}\n")
        let listings = try project.write("hgblistings.sty", "% codestyle=color|mono|classic: style\n")
        let theme = try project.write("hgbtheme-default.sty", "")
        let theme2 = try project.write("hgbtheme-fhooe26.sty", "")

        let options = try #require(OptionScanner.scan([classFile, dictionary, listings, theme, theme2])["hgbthesis"])

        #expect(options.keys["type"] == ["bachelor", "master"])
        #expect(options.keys["language"] == ["german"])
        #expect(options.keys["degree"] == ["engineering", "law"])
        #expect(options.keys["theme"] == ["default", "fhooe26"])
        #expect(options.keys["codestyle"] == ["color", "mono", "classic"])
        #expect(options.keys["twoside"] == ["true", "false"])
        #expect(options.keys["bachelor"] == nil, "Veraltete Option")
        #expect(options.keys["oneside"] == nil, "Veraltet, Markierung erst in der Folgezeile")
        #expect(options.flags == ["draft"])
    }

    @Test("Vorschläge: Klassenoptionen der Vorlage, Standardklassen, Pakete, Werte zum Schlüssel")
    @MainActor
    func providerItems() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let classFile = try project.write("hgbthesis.cls", cls)
        let main = try project.write("main.tex", "\\documentclass{hgbthesis}")
        let provider = CompletionProvider()
        await provider.reload(files: [main], projectRoot: project.root, mainFile: main)
        _ = classFile
        let text = "" as NSString
        func items(_ target: OptionTarget, key: String? = nil) -> [String] {
            provider.items(for: CompletionContext(kind: .option(target, key: key), prefix: "", range: NSRange()), document: text, cursor: 0).map(\.text)
        }

        #expect(items(.documentClass("hgbthesis")).contains("type="))
        #expect(items(.documentClass("hgbthesis"), key: "type") == ["bachelor", "master"])
        #expect(items(.documentClass("report")).contains("a4paper"))
        #expect(items(.package("babel")).contains("ngerman"))
        #expect(items(.graphics, key: "width").first == "\\textwidth")
        #expect(items(.floatPlacement).first == "H")
        #expect(items(.package("unbekannt")).isEmpty)
    }
}

extension CompletionEditorTests {
    @Test("\\includegraphics[ → width= → Werte → Wert übernehmen; \\begin{figure}[ → H mit ]")
    func optionsInEditor() async throws {
        let harness = CompletionHarness(text: "")
        try await harness.start()

        harness.type("\\includegraphics[wi")
        #expect(harness.completion.visibleItems.map(\.text) == ["width="])
        harness.command(#selector(NSResponder.insertNewline(_:)))
        try await Task.sleep(for: .milliseconds(20))
        #expect(harness.completion.visibleItems.first?.text == "\\textwidth", "Nach width= folgen die Werte")
        harness.type("0.8")
        harness.command(#selector(NSResponder.insertNewline(_:)))
        #expect(harness.session.textStorage.string == "\\includegraphics[width=0.8\\textwidth")

        harness.textView.insertText("]{}\n\\begin{figure}", replacementRange: harness.textView.selectedRange())
        harness.type("[")
        #expect(harness.completion.visibleItems.first?.text == "H")
        harness.command(#selector(NSResponder.insertTab(_:)))
        #expect(harness.session.textStorage.string.hasSuffix("\\begin{figure}[H]"))
    }
}
