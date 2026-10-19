import Foundation

/// Eingebaute Befehle und Umgebungen. Befehle der HgbThesis-Vorlage und eigene Makros kommen zusätzlich
/// aus dem Projekt (`CompletionIndex`), damit diese Liste nicht jede Vorlage kennen muss.
enum CommandCatalog {
    /// Name, Argument-Gerüst, kurzer Hinweis
    private static let specs: [(String, String, String)] = [
        // Gliederung
        ("part", "{}", "Teil"), ("chapter", "{}", "Kapitel"), ("chapter*", "{}", "Kapitel ohne Nummer"),
        ("section", "{}", "Abschnitt"), ("section*", "{}", "Abschnitt ohne Nummer"),
        ("subsection", "{}", "Unterabschnitt"), ("subsection*", "{}", "Unterabschnitt ohne Nummer"),
        ("subsubsection", "{}", "Unter-Unterabschnitt"), ("paragraph", "{}", "Absatz mit Titel"),
        ("subparagraph", "{}", "Unterabsatz mit Titel"), ("appendix", "", "Anhang beginnen"),
        ("tableofcontents", "", "Inhaltsverzeichnis"), ("listoffigures", "", "Abbildungsverzeichnis"),
        ("listoftables", "", "Tabellenverzeichnis"), ("maketitle", "", "Titel setzen"),
        ("frontmatter", "", "Vorspann"), ("mainmatter", "", "Hauptteil"), ("backmatter", "", "Nachspann"),
        // Verweise, Literatur
        ("label", "{}", "Label setzen"), ("ref", "{}", "Verweis"), ("eqref", "{}", "Verweis auf Gleichung"),
        ("pageref", "{}", "Seitenverweis"), ("autoref", "{}", "Verweis mit Namen"), ("cref", "{}", "cleveref"),
        ("Cref", "{}", "cleveref, groß"), ("nameref", "{}", "Verweis mit Titel"),
        ("cite", "{}", "Zitat"), ("cite", "[]{}", "Zitat mit Seite"), ("parencite", "{}", "Zitat in Klammern"),
        ("textcite", "{}", "Zitat im Text"), ("autocite", "{}", "Zitat (automatisch)"), ("footcite", "{}", "Zitat in Fußnote"),
        ("citeauthor", "{}", "Autor"), ("citeyear", "{}", "Jahr"), ("nocite", "{}", "Ins Verzeichnis ohne Zitat"),
        ("footnote", "{}", "Fußnote"), ("url", "{}", "URL"), ("href", "{}{}", "Link mit Text"),
        // Text
        ("emph", "{}", "Hervorhebung"), ("textbf", "{}", "Fett"), ("textit", "{}", "Kursiv"), ("texttt", "{}", "Schreibmaschine"),
        ("textsc", "{}", "Kapitälchen"), ("textsf", "{}", "Serifenlos"), ("textrm", "{}", "Serifen"), ("underline", "{}", "Unterstrichen"),
        ("textsuperscript", "{}", "Hochgestellt"), ("textsubscript", "{}", "Tiefgestellt"), ("enquote", "{}", "Anführungszeichen"),
        ("textquote", "{}", "Zitat im Fließtext"), ("mbox", "{}", "Kein Umbruch"), ("hyphenation", "{}", "Trennregeln"),
        ("verb", "||", "Code im Fließtext"), ("item", " ", "Aufzählungspunkt"), ("item", "[] ", "Punkt mit Bezeichnung"),
        ("newline", "", "Neue Zeile"), ("newpage", "", "Neue Seite"), ("clearpage", "", "Seite abschließen"),
        ("cleardoublepage", "", "Auf ungerader Seite fortsetzen"), ("linebreak", "", "Zeilenumbruch"),
        ("noindent", "", "Ohne Einzug"), ("centering", "", "Zentrieren"), ("raggedright", "", "Flattersatz links"),
        ("raggedleft", "", "Flattersatz rechts"), ("vspace", "{}", "Vertikaler Abstand"), ("hspace", "{}", "Horizontaler Abstand"),
        ("smallskip", "", "Kleiner Abstand"), ("medskip", "", "Mittlerer Abstand"), ("bigskip", "", "Großer Abstand"),
        ("hfill", "", "Füllen"), ("vfill", "", "Vertikal füllen"), ("dots", "", "Auslassungspunkte"), ("ldots", "", "Auslassungspunkte"),
        ("today", "", "Heutiges Datum"), ("LaTeX", "", "LaTeX-Logo"), ("TeX", "", "TeX-Logo"),
        ("tiny", "", "Schriftgröße"), ("scriptsize", "", "Schriftgröße"), ("footnotesize", "", "Schriftgröße"),
        ("small", "", "Schriftgröße"), ("normalsize", "", "Schriftgröße"), ("large", "", "Schriftgröße"),
        ("Large", "", "Schriftgröße"), ("LARGE", "", "Schriftgröße"), ("huge", "", "Schriftgröße"), ("Huge", "", "Schriftgröße"),
        // Gleitumgebungen, Bilder, Tabellen
        ("begin", "{}", "Umgebung beginnen"), ("end", "{}", "Umgebung beenden"),
        ("includegraphics", "{}", "Bild"), ("includegraphics", "[width=\\textwidth]{}", "Bild mit Breite"),
        ("caption", "{}", "Beschriftung"), ("caption", "[]{}", "Beschriftung mit Kurzform"),
        ("graphicspath", "{{}}", "Bildordner"), ("textwidth", "", "Textbreite"), ("linewidth", "", "Zeilenbreite"),
        ("hline", "", "Tabellenlinie"), ("toprule", "", "Tabelle oben (booktabs)"), ("midrule", "", "Tabelle Mitte (booktabs)"),
        ("bottomrule", "", "Tabelle unten (booktabs)"), ("cmidrule", "{}", "Teillinie (booktabs)"),
        ("multicolumn", "{}{}{}", "Verbundene Spalten"), ("multirow", "{}{}{}", "Verbundene Zeilen"),
        ("resizebox", "{}{}{}", "Skalieren"),
        // Dateien, Präambel
        ("input", "{}", "Datei einbinden"), ("include", "{}", "Kapitel einbinden"), ("includeonly", "{}", "Nur diese Kapitel"),
        ("documentclass", "[]{}", "Dokumentklasse"), ("usepackage", "{}", "Paket laden"), ("usepackage", "[]{}", "Paket mit Optionen"),
        ("newcommand", "{}{}", "Eigener Befehl"), ("renewcommand", "{}{}", "Befehl ändern"), ("newenvironment", "{}{}{}", "Eigene Umgebung"),
        ("title", "{}", "Titel"), ("author", "{}", "Autor"), ("date", "{}", "Datum"),
        ("bibliography", "{}", "Literatur (BibTeX)"), ("bibliographystyle", "{}", "Literaturstil"),
        ("addbibresource", "{}", "Literatur (biblatex)"), ("printbibliography", "", "Literaturverzeichnis"),
        // Mathematik (häufige Befehle, keine Symbole)
        ("frac", "{}{}", "Bruch"), ("dfrac", "{}{}", "Bruch (groß)"), ("sqrt", "{}", "Wurzel"), ("sqrt", "[]{}", "n-te Wurzel"),
        ("sum", "_{}^{}", "Summe"), ("prod", "_{}^{}", "Produkt"), ("int", "_{}^{}", "Integral"), ("lim", "_{}", "Grenzwert"),
        ("mathbf", "{}", "Fett (Mathe)"), ("mathit", "{}", "Kursiv (Mathe)"), ("mathrm", "{}", "Aufrecht (Mathe)"),
        ("mathcal", "{}", "Kalligrafisch"), ("mathbb", "{}", "Doppelstrich"), ("text", "{}", "Text in Formel"),
        ("operatorname", "{}", "Operator"), ("left", "", "Klammer links"), ("right", "", "Klammer rechts"),
        ("cdot", "", "Malpunkt"), ("times", "", "Mal"), ("leq", "", "Kleiner gleich"), ("geq", "", "Größer gleich"),
        ("neq", "", "Ungleich"), ("approx", "", "Ungefähr"), ("infty", "", "Unendlich"), ("quad", "", "Abstand"),
        ("qquad", "", "Doppelter Abstand"), ("overline", "{}", "Überstrich"), ("hat", "{}", "Dach"), ("vec", "{}", "Vektor"),
        ("tag", "{}", "Eigene Gleichungsnummer"), ("nonumber", "", "Ohne Nummer"), ("intertext", "{}", "Text zwischen Zeilen"),
    ]

    static let commands: [CompletionItem] = {
        var seen: Set<String> = []
        return specs.compactMap { name, arguments, detail in
            guard seen.insert(name + arguments).inserted else { return nil }
            return CompletionItem.command(name, arguments: arguments, detail: detail)
        }
    }()

    static let environments: [String] = [
        "itemize", "enumerate", "description", "figure", "figure*", "table", "table*", "tabular", "tabularx", "tabular*",
        "center", "flushleft", "flushright", "minipage", "quote", "quotation", "verse", "verbatim", "abstract",
        "equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*", "split", "cases",
        "matrix", "pmatrix", "bmatrix", "vmatrix", "array", "theorem", "lemma", "proof", "definition", "example",
        "footnotesize", "small", "document", "thebibliography",
        // HgbThesis
        "program", "english", "german",
    ] + CodeLanguage.all.map(\.environment)
}
