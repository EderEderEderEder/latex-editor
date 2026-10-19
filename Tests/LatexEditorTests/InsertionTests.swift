import Foundation
import Testing
@testable import LatexEditor

@Suite("Einfügen: Maskierung und Namen")
struct InsertionNamingTests {
    @Test("Sonderzeichen werden maskiert, Zeilenumbrüche zu Leerzeichen")
    func escapes() {
        #expect(LatexEscaping.escape("50 % & 5 $ # a_b {x} ~ ^ \\") ==
            "50 \\% \\& 5 \\$ \\# a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}")
        #expect(LatexEscaping.escape("a\nb\r\nc") == "a b c")
        #expect(LatexEscaping.escape("Größe ändern") == "Größe ändern")
    }

    @Test("Label aus Beschriftung: Umlaute, Sonderzeichen, Länge")
    func slugs() {
        #expect(LabelNaming.slug("Ergebnisse der Größenmessung") == "ergebnisse-der-groessenmessung")
        #expect(LabelNaming.slug("  100 % – Äpfel & Birnen!  ") == "100-aepfel-birnen")
        #expect(LabelNaming.slug("eins zwei drei vier fünf sechs sieben") == "eins-zwei-drei-vier-fuenf")
        #expect(LabelNaming.slug("???") == "")
        #expect(LabelNaming.slug(String(repeating: "a", count: 100)).count == 40)
    }

    @Test("Label ist eindeutig, Fallback bei leerer Beschriftung")
    func uniqueLabels() {
        #expect(LabelNaming.label(prefix: "tab", caption: "Ergebnisse", fallback: "tabelle", existing: []) == "tab:ergebnisse")
        #expect(LabelNaming.label(prefix: "tab", caption: "Ergebnisse", fallback: "tabelle",
                                  existing: ["tab:ergebnisse"]) == "tab:ergebnisse-2")
        #expect(LabelNaming.label(prefix: "tab", caption: "Ergebnisse", fallback: "tabelle",
                                  existing: ["tab:ergebnisse", "tab:ergebnisse-2"]) == "tab:ergebnisse-3")
        #expect(LabelNaming.label(prefix: "fig", caption: "", fallback: "bild", existing: []) == "fig:bild")
    }

    @Test("Block steht in eigenen Zeilen, ohne Leerzeile vor vorhandenem Umbruch")
    func blockPlacement() {
        let block = "\\begin{x}\n\\end{x}\n"
        let text = "Anfang Ende\nzweite Zeile" as NSString
        #expect(BlockPlacement.adjust(block, in: text, replacing: NSRange(location: 0, length: 0)) == block)
        #expect(BlockPlacement.adjust(block, in: text, replacing: NSRange(location: 7, length: 0)) == "\n" + block)
        let empty = "a\n\nb" as NSString
        #expect(BlockPlacement.adjust(block, in: empty, replacing: NSRange(location: 2, length: 0)) == "\\begin{x}\n\\end{x}")
        #expect(BlockPlacement.adjust(block, in: "abc" as NSString, replacing: NSRange(location: 3, length: 0)) == "\n" + block)
        #expect(BlockPlacement.adjust(block, in: "" as NSString, replacing: NSRange(location: 99, length: 5)) == block)
    }
}

@Suite("Einfügen: Generatoren (Stil der HgbThesis)")
struct InsertionGeneratorTests {
    private func table(_ configure: (inout TableSettings) -> Void = { _ in }) -> TableSettings {
        var settings = TableSettings()
        settings.resize(rows: 3, columns: 3)
        settings.cells = [["Sprache", "Typ", "Jahr"], ["C++", "Kompiliert", "1985"], ["Python", "Interpretiert", "1991"]]
        settings.alignments = [.left, .left, .right]
        configure(&settings)
        return settings
    }

    @Test("Tabelle mit booktabs wie im Tutorial: Beschriftung vor Label, @{} an den Rändern")
    func booktabsTable() {
        var settings = table()
        settings.caption = "Programmiersprachen im Überblick."
        let output = InsertionGenerator.table(settings, label: "tab:programmiersprachen")
        #expect(output == """
            \\begin{table}
            \t\\caption{Programmiersprachen im Überblick.}
            \t\\label{tab:programmiersprachen}
            \t\\centering
            \t\\begin{tabular}{@{}llr@{}}
            \t\t\\toprule
            \t\tSprache & Typ           & Jahr \\\\
            \t\t\\midrule
            \t\tC++     & Kompiliert    & 1985 \\\\
            \t\tPython  & Interpretiert & 1991 \\\\
            \t\t\\bottomrule
            \t\\end{tabular}
            \\end{table}

            """)
    }

    @Test("Tabelle ohne Kopfzeile, mit Platzierung; ohne Beschriftung entfallen Caption und Label")
    func tableVariants() {
        let output = InsertionGenerator.table(table { $0.hasHeader = false; $0.placement = .here }, label: "tab:x")
        #expect(output.hasPrefix("\\begin{table}[h]\n\t\\centering"))
        #expect(!output.contains("\\midrule"))
        #expect(!output.contains("\\caption") && !output.contains("\\label"))
    }

    @Test("Alle Linien und keine Linien")
    func tableRules() {
        let grid = InsertionGenerator.table(table { $0.rules = .grid }, label: "")
        #expect(grid.contains("\\begin{tabular}{|l|l|r|}"))
        #expect(grid.components(separatedBy: "\\hline").count - 1 == 4)
        let none = InsertionGenerator.table(table { $0.rules = .none }, label: "")
        #expect(!none.contains("\\toprule") && !none.contains("\\hline"))
    }

    @Test("Zellen werden maskiert, außer der Nutzer schaltet das ab")
    func tableEscaping() {
        let escaped = InsertionGenerator.table(table { $0.cells[1][0] = "50 % & mehr" }, label: "")
        #expect(escaped.contains("50 \\% \\& mehr"))
        let raw = InsertionGenerator.table(table { $0.cells[1][0] = "$x^2$"; $0.escapeText = false }, label: "")
        #expect(raw.contains("$x^2$"))
    }

    @Test("Größe ändern behält Zellen und Ausrichtung, Grenzen werden eingehalten")
    func resize() {
        var settings = table()
        settings.resize(rows: 5, columns: 2)
        #expect(settings.cells.count == 5 && settings.cells[0] == ["Sprache", "Typ"])
        #expect(settings.alignments == [.left, .left])
        settings.resize(rows: 999, columns: 999)
        #expect(settings.rows == TableSettings.maximumRows && settings.columns == TableSettings.maximumColumns)
        settings.resize(rows: 0, columns: 0)
        #expect(settings.rows == 1 && settings.columns == 1)
    }

    @Test("Einfügen aus Excel/Numbers: Tabulatoren, Anführungszeichen, leere Endzeilen")
    func tabSeparated() {
        var settings = TableSettings()
        settings.fill(fromTabSeparated: "Name\tWert\r\nA\t\"1,5\"\n\"mit\nUmbruch\"\t2\n\n")
        #expect(settings.rows == 3 && settings.columns == 2)
        #expect(settings.cells == [["Name", "Wert"], ["A", "1,5"], ["mit\nUmbruch", "2"]])
        settings.fill(fromTabSeparated: "")
        #expect(settings.rows == 3)
        settings.fill(fromTabSeparated: "a\tb\tc\nd")
        #expect(settings.columns == 3 && settings.cells[1] == ["d", "", ""])
    }

    @Test("Bild wie im Tutorial: zentriert, Breite relativ, Beschriftung dann Label")
    func image() {
        var settings = ImageSettings()
        settings.caption = "Coca-Cola Werbung 1940."
        settings.widthPercent = 75
        let output = InsertionGenerator.image(settings, reference: "cola.png", label: "fig:cola")
        #expect(output == """
            \\begin{figure}
            \t\\centering
            \t\\includegraphics[width=.75\\textwidth]{cola.png}
            \t\\caption{Coca-Cola Werbung 1940.}
            \t\\label{fig:cola}
            \\end{figure}

            """)
    }

    @Test("Breiten: 100 %, 50 %, 5 %")
    func widths() {
        #expect(InsertionGenerator.widthText(percent: 100) == "\\textwidth")
        #expect(InsertionGenerator.widthText(percent: 50) == ".5\\textwidth")
        #expect(InsertionGenerator.widthText(percent: 5) == ".05\\textwidth")
        #expect(InsertionGenerator.widthText(percent: 0) == ".01\\textwidth")
        #expect(InsertionGenerator.widthText(percent: 500) == "\\textwidth")
    }

    @Test("Code: program-Float mit Sprachumgebung, nie lstlisting")
    func code() {
        var settings = CodeSettings()
        settings.language = CodeLanguage.all.first { $0.environment == "SwiftCode" }!
        settings.content = "let x = 1\nprint(x)\n"
        settings.caption = "Beispiel."
        let output = InsertionGenerator.code(settings, label: "prog:beispiel")
        #expect(output == """
            \\begin{program}
            \t\\caption{Beispiel.}
            \t\\label{prog:beispiel}
            \\begin{SwiftCode}
            let x = 1
            print(x)
            \\end{SwiftCode}
            \\end{program}

            """)
        #expect(!output.contains("lstlisting"))
    }

    @Test("Code ohne Float und ohne Zeilennummern")
    func codeVariants() {
        var settings = CodeSettings()
        settings.asFloat = false
        settings.lineNumbers = false
        settings.content = "x"
        #expect(InsertionGenerator.code(settings, label: "") == "\\begin{PythonCode}[numbers=none]\nx\n\\end{PythonCode}\n")
    }

    @Test("Sprachen verweisen nur auf Umgebungen aus hgblistings.sty, ohne Duplikate")
    func languages() {
        let environments = CodeLanguage.all.map(\.environment)
        #expect(Set(environments).count == environments.count)
        #expect(environments.allSatisfy { $0.hasSuffix("Code") })
        #expect(CodeLanguage.all.first?.environment == "GenericCode")
    }

    @Test("Gleichung nummeriert mit Label, ohne Nummer ohne Label, Platzhalter bei leerem Inhalt")
    func equation() {
        var settings = EquationSettings()
        settings.content = "E = mc^2"
        #expect(InsertionGenerator.equation(settings, label: "eq:einstein") ==
            "\\begin{equation}\n\tE = mc^2\n\t\\label{eq:einstein}\n\\end{equation}\n")
        settings.kind = .alignStar
        settings.content = "a &= b \\\\\nc &= d"
        #expect(InsertionGenerator.equation(settings, label: "eq:x") ==
            "\\begin{align*}\n\ta &= b \\\\\n\tc &= d\n\\end{align*}\n")
        settings.content = "  "
        #expect(InsertionGenerator.equation(settings, label: "").contains("\ta = b"))
    }

    @Test("Liste mit Punkten und Text")
    func list() {
        var settings = ListSettings()
        settings.kind = .enumerate
        settings.items = ["Erster", "", "Dritter"]
        #expect(InsertionGenerator.list(settings) ==
            "\\begin{enumerate}\n\t\\item Erster\n\t\\item\n\t\\item Dritter\n\\end{enumerate}\n")
        settings.resize(to: 100)
        #expect(settings.items.count == ListSettings.maximumItems)
    }

    @Test("Verweis mit und ohne Vorsatz, Zitat mit Seitenangabe")
    func referenceAndCitation() {
        #expect(InsertionGenerator.reference(ReferenceSettings(label: "fig:cola", withPrefix: true)) == "Abbildung~\\ref{fig:cola}")
        #expect(InsertionGenerator.reference(ReferenceSettings(label: "tab:x", withPrefix: true)) == "Tabelle~\\ref{tab:x}")
        #expect(InsertionGenerator.reference(ReferenceSettings(label: "fig:cola", withPrefix: false)) == "\\ref{fig:cola}")
        #expect(InsertionGenerator.reference(ReferenceSettings(label: "unbekannt:x", withPrefix: true)) == "\\ref{unbekannt:x}")
        #expect(InsertionGenerator.citation(CitationSettings(keys: ["a", "b"], note: "")) == "\\cite{a,b}")
        #expect(InsertionGenerator.citation(CitationSettings(keys: ["a"], note: "S.~12")) == "\\cite[S.~12]{a}")
    }
}

@Suite("Einfügen: Projektkatalog und Bild-Import")
struct InsertionCatalogTests {
    private let file = URL(fileURLWithPath: "/p/kapitel.tex")

    @Test("Labels: mehrere pro Zeile, Kommentare und auskommentierte Labels ignoriert")
    func labels() {
        let text = """
            \\section{A}\\label{sec:a}
            Text \\label{ a } und \\label{b}
            % \\label{auskommentiert}
            50\\% \\label{nach-prozent} % \\label{im-kommentar}
            """
        let entries = ProjectCatalog.labels(in: text, file: file)
        #expect(entries.map(\.label) == ["sec:a", "a", "b", "nach-prozent"])
        #expect(entries.map(\.line) == [1, 2, 2, 4])
    }

    @Test("Literatur: Schlüssel und Titel, @string/@comment werden übersprungen")
    func bibliography() {
        let text = """
            @comment{ignoriert,}
            @string{name = "x"}
            @book{knuth1984,
              author = {Knuth, Donald},
              title = {The {TeX}book},
              year = 1984
            }
            @article{ lamport94 ,
              title = "LaTeX: A Document Preparation System",
            }
            """
        let entries = ProjectCatalog.bibEntries(in: text)
        #expect(entries.map(\.key) == ["knuth1984", "lamport94"])
        #expect(entries.map(\.title) == ["The TeXbook", "LaTeX: A Document Preparation System"])
    }

    @Test("Einzeilige Literatureinträge liefern ihren Titel")
    func singleLineBibEntries() {
        let entries = ProjectCatalog.bibEntries(in: "@book{knuth1984, title={The {TeX}book}, year=1984}\n@misc{x, note={ohne Titel}}\n")
        #expect(entries.map(\.key) == ["knuth1984", "x"])
        #expect(entries.map(\.title) == ["The TeXbook", ""])
    }

    @Test("graphicspath mit mehreren Verzeichnissen")
    func graphicsPath() {
        #expect(ProjectCatalog.graphicsDirectories(in: "\\graphicspath{{images/}}") == ["images/"])
        #expect(ProjectCatalog.graphicsDirectories(in: "\\graphicspath{ {img} {fig/sub/} }") == ["img/", "fig/sub/"])
        #expect(ProjectCatalog.graphicsDirectories(in: "kein pfad").isEmpty)
    }

    @Test("Pfad für includegraphics folgt graphicspath")
    func graphicsReference() {
        let root = URL(fileURLWithPath: "/Users/x/5 Semster/Thesis")
        let image = root.appendingPathComponent("images/sub/bild.png")
        #expect(GraphicsReference.path(for: image, projectRoot: root, graphicsDirectories: ["images/"]) == "sub/bild.png")
        #expect(GraphicsReference.path(for: image, projectRoot: root, graphicsDirectories: []) == "images/sub/bild.png")
        #expect(GraphicsReference.path(for: URL(fileURLWithPath: "/woanders/x.png"), projectRoot: root,
                                       graphicsDirectories: []) == "x.png")
    }

    @Test("Dateinamen werden bereinigt")
    func sanitizing() {
        #expect(ImageImport.sanitizedName("Mein Bild (1).PNG") == "Mein-Bild-1.png")
        #expect(ImageImport.sanitizedName("Größe & Übersicht.jpeg") == "Groesse-Uebersicht.jpeg")
        #expect(ImageImport.sanitizedName("___.pdf") == "bild.pdf")
        #expect(ImageImport.sanitizedName("schon_gut-1.png") == "schon_gut-1.png")
    }

    @Test("Import kopiert nach images/, nummeriert bei anderem Inhalt, nutzt gleiche Datei weiter")
    func importing() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let source = try project.write("Downloads/Mein Foto.png", "AAA")
        let images = project.url("images")

        let first = try ImageImport.importImage(from: source, into: images)
        #expect(first == project.url("images/Mein-Foto.png"))
        #expect(try String(contentsOf: first, encoding: .utf8) == "AAA")

        let again = try ImageImport.importImage(from: source, into: images)
        #expect(again == first)

        let other = try project.write("Anderswo/Mein Foto.png", "BBB")
        let numbered = try ImageImport.importImage(from: other, into: images)
        #expect(numbered == project.url("images/Mein-Foto-2.png"))
        #expect(try ImageImport.importImage(from: first, into: images) == first)
        #expect(try FileManager.default.contentsOfDirectory(atPath: images.path).count == 2)
    }

    @Test("Nicht unterstützte Formate werden abgelehnt, nichts wird kopiert")
    func unsupported() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let source = try project.write("Foto.heic", "x")
        #expect(throws: ImageImportError.unsupportedFormat("Foto.heic")) {
            try ImageImport.importImage(from: source, into: project.url("images"))
        }
        #expect(!FileManager.default.fileExists(atPath: project.url("images").path))
    }
}
