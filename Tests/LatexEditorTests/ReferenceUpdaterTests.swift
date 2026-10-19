import Foundation
import Testing
@testable import LatexEditor

private let root = URL(fileURLWithPath: "/Users/x/5 Semster/Thesis", isDirectory: true)
private let main = root.appendingPathComponent("main.tex")

private func url(_ path: String) -> URL { root.appendingPathComponent(path).standardizedFileURL }

/// Wendet alle Änderungen auf die Texte an und gibt die neuen Texte je Datei zurück.
private func updated(
    moving from: String, to: String, texts: [String: String], graphics: [String] = ["images/"]
) -> [String: String] {
    let input = Dictionary(uniqueKeysWithValues: texts.map { (url($0.key), $0.value) })
    let edits = ReferenceUpdater.edits(
        moving: url(from), to: url(to), mainFile: main, graphicsDirectories: graphics, texts: input
    )
    return Dictionary(uniqueKeysWithValues: input.map { file, text in
        let own = edits.filter { $0.file == file }
        return (String(file.path.dropFirst(root.path.count + 1)), ReferenceUpdater.apply(own, to: text))
    })
}

@Suite("Verweise anpassen")
struct ReferenceUpdaterTests {
    @Test("include und input: mit und ohne Endung, Schreibweise bleibt erhalten")
    func includeAndInput() {
        let result = updated(moving: "chapters/alt.tex", to: "kapitel/neu.tex", texts: [
            "main.tex": "\\include{chapters/alt}\n\\input{chapters/alt.tex}\n\\include{chapters/anders}\n"
        ])
        #expect(result["main.tex"] == "\\include{kapitel/neu}\n\\input{kapitel/neu.tex}\n\\include{chapters/anders}\n")
    }

    @Test("Auskommentierte Verweise bleiben, escaptes Prozentzeichen schützt nicht")
    func comments() {
        let result = updated(moving: "a.tex", to: "b.tex", texts: [
            "main.tex": "% \\include{a}\n50\\% \\include{a} % \\include{a}\n\\include{a}\n"
        ])
        #expect(result["main.tex"] == "% \\include{a}\n50\\% \\include{b} % \\include{a}\n\\include{b}\n")
    }

    @Test("Bilder: graphicspath, ergänzte Endung, optionale Argumente")
    func graphics() {
        let result = updated(moving: "images/logo.png", to: "images/marke/logo.png", texts: [
            "chapters/a.tex": "\\includegraphics[width=.5\\textwidth]{logo.png}\n\\includegraphics{logo}\n\\includegraphics{images/logo.png}\n\\includegraphics{anderes}\n"
        ])
        #expect(result["chapters/a.tex"] == "\\includegraphics[width=.5\\textwidth]{marke/logo.png}\n\\includegraphics{marke/logo}\n\\includegraphics{images/marke/logo.png}\n\\includegraphics{anderes}\n")
    }

    @Test("Literatur: bibliography mit mehreren Einträgen, addbibresource")
    func bibliography() {
        let result = updated(moving: "refs.bib", to: "literatur/refs.bib", texts: [
            "main.tex": "\\bibliography{andere, refs ,weitere}\n\\addbibresource{refs.bib}\n"
        ])
        #expect(result["main.tex"] == "\\bibliography{andere, literatur/refs ,weitere}\n\\addbibresource{literatur/refs.bib}\n")
    }

    @Test("Ganzer Ordner: alles darunter wird nachgezogen")
    func folderMove() {
        let result = updated(moving: "chapters", to: "kapitel", texts: [
            "main.tex": "\\include{chapters/eins}\n\\input{chapters/sub/zwei}\n\\includegraphics{chapters/bild.png}\n",
            "front/vorwort.tex": "\\input{chapters/eins}\n"
        ])
        #expect(result["main.tex"] == "\\include{kapitel/eins}\n\\input{kapitel/sub/zwei}\n\\includegraphics{kapitel/bild.png}\n")
        #expect(result["front/vorwort.tex"] == "\\input{kapitel/eins}\n")
    }

    @Test("Verschieben aus dem Unterordner in die Wurzel und zurück erzeugt korrekte relative Pfade")
    func relativePaths() {
        let up = updated(moving: "a/b/c.tex", to: "c.tex", texts: ["main.tex": "\\input{a/b/c}\n"])
        #expect(up["main.tex"] == "\\input{c}\n")
        #expect(ReferenceUpdater.relativePath(of: url("x/y.tex"), from: url("a/b")) == "../../x/y.tex")
        #expect(ReferenceUpdater.relativePath(of: url("a/b/c.tex"), from: root) == "a/b/c.tex")
    }

    @Test("Mehrere Verweise in einer Zeile und Zeilennummern der Änderungen")
    func multipleAndLines() {
        let text = "Text\n\\input{a} und \\input{a}\n\n\\include{a}\n"
        let edits = ReferenceUpdater.edits(moving: url("a.tex"), to: url("b.tex"), mainFile: main,
                                           graphicsDirectories: [], texts: [url("main.tex"): text])
        #expect(edits.map(\.line) == [2, 2, 4])
        #expect(edits.map(\.oldText) == ["a", "a", "a"])
        #expect(ReferenceUpdater.apply(edits, to: text) == "Text\n\\input{b} und \\input{b}\n\n\\include{b}\n")
    }

    @Test("Verweise auf andere Dateien und ähnliche Namen bleiben unberührt")
    func similarNames() {
        let text = "\\input{alt-neu}\n\\input{altes}\n\\input{sub/alt}\n"
        let result = updated(moving: "alt.tex", to: "neu.tex", texts: ["main.tex": text])
        #expect(result["main.tex"] == text)
    }

    @Test("Umlaute und Leerzeichen im Pfad")
    func unicodeNames() {
        let result = updated(moving: "Größe Maß.tex", to: "Groesse.tex", texts: [
            "main.tex": "Ä \\input{Größe Maß} 😀 \\input{Größe Maß.tex}\n"
        ])
        #expect(result["main.tex"] == "Ä \\input{Groesse} 😀 \\input{Groesse.tex}\n")
    }

    @Test("Änderung der Endung behält die geschriebene Schreibweise nicht fälschlich bei")
    func extensionChange() {
        let result = updated(moving: "a.tex", to: "a.txt", texts: ["main.tex": "\\input{a}\n"])
        #expect(result["main.tex"] == "\\input{a.txt}\n")
    }

    @Test("Maskierung behält die Länge, auch mit Emoji")
    func maskingKeepsLength() {
        let text = "😀 x % Kommentar 😀\n\\input{a}"
        #expect(ReferenceUpdater.maskingComments(in: text).utf16.count == text.utf16.count)
    }
}
