import Foundation

/// Wortlisten für `TechnicalVocabulary`: Grundformen, durch Leerraum getrennt. Mehrzahl, Genitiv und Zusammensetzungen
/// ergänzt `TechnicalVocabulary` selbst; unregelmäßige Formen (`Matrizen`, `Indizes`) stehen ausdrücklich da.
/// Erweitern: Wort in die passende Liste schreiben (Groß-/Kleinschreibung egal), `TechnicalVocabularyTests` laufen lassen.
enum TechnicalWords {
    static let nouns = [mathematics, algebraAndNumbers, analysisAndGeometry, statistics, logicAndDiscrete, numerics,
                        computerScience, programming, systems, networksAndSecurity, dataAndAI, softwareEngineering,
                        physics, quantum, electronics, relatedSciences, units, scientificWriting].joined(separator: "\n")

    // MARK: Mathematik

    private static let mathematics = """
    Mathematik Axiom Axiome Definition Satz Sätze Lemma Lemmata Korollar Korollare Theorem Theoreme Beweis Beweise Vermutung
    Hypothese Annahme Voraussetzung Behauptung Induktion Induktionsanfang Induktionsschritt Induktionsvoraussetzung
    Widerspruch Kontraposition Äquivalenz Implikation Konjunktion Disjunktion Negation Quantor Quantoren Allquantor Existenzquantor
    Menge Mengen Teilmenge Obermenge Potenzmenge Komplement Vereinigung Schnittmenge Differenzmenge Produktmenge Kardinalität
    Mächtigkeit Abzählbarkeit Überabzählbarkeit Relation Relationen Äquivalenzrelation Äquivalenzklasse Ordnungsrelation Halbordnung
    Totalordnung Funktion Funktionen Abbildung Abbildungen Injektion Surjektion Bijektion Isomorphismus Isomorphismen Homomorphismus
    Homomorphismen Endomorphismus Automorphismus Epimorphismus Monomorphismus Urbild Bild Definitionsbereich Wertebereich Zielmenge
    Kern Quotient Quotienten Quotientenraum Faktorgruppe Faktorraum Komposition Verkettung Umkehrfunktion Inverse Identität
    Fixpunkt Fixpunkte Konstante Variable Variablen Parameter Koeffizient Koeffizienten Term Terme Ausdruck Gleichung Gleichungen
    Ungleichung Ungleichungen Gleichungssystem Gleichungssysteme Lösung Lösungen Lösungsmenge Lösungsraum Nullstelle Nullstellen
    Polynom Polynome Polynomgrad Monom Binom Binome Binomialkoeffizient Binomialkoeffizienten Trinom Faktorisierung Primfaktor
    Primfaktoren Primzahl Primzahlen Teiler Vielfaches Rest Restklasse Restklassen Modulus Kongruenz Kongruenzen
    """

    private static let algebraAndNumbers = """
    Algebra Gruppe Gruppen Untergruppe Normalteiler Halbgruppe Monoid Ring Ringe Körper Körpererweiterung Schiefkörper Integritätsbereich
    Ideal Ideale Hauptideal Primideal Modul Moduln Vektorraum Vektorräume Untervektorraum Unterraum Unterräume Basis Basen
    Basiswechsel Erzeugendensystem Dimension Dimensionen Rang Defekt Nullraum Spaltenraum Zeilenraum Kern Spur Determinante
    Determinanten Matrix Matrizen Einheitsmatrix Nullmatrix Diagonalmatrix Dreiecksmatrix Blockmatrix Transponierte Adjungierte
    Inverse Pseudoinverse Orthogonalmatrix Permutationsmatrix Projektionsmatrix Rotationsmatrix Spiegelungsmatrix Jacobimatrix
    Hessematrix Gramsche Kovarianzmatrix Korrelationsmatrix Übergangsmatrix Adjazenzmatrix Inzidenzmatrix Laplacematrix
    Vektor Vektoren Spaltenvektor Zeilenvektor Einheitsvektor Basisvektor Nullvektor Ortsvektor Normalenvektor Richtungsvektor
    Eigenvektor Eigenvektoren Eigenwert Eigenwerte Eigenraum Eigenräume Eigenbasis Eigenwertproblem Eigenwertzerlegung
    Singulärwert Singulärwerte Singulärwertzerlegung Spektrum Spektralzerlegung Spektralsatz Spektralradius Charakteristik
    Hauptachsentransformation Jordansche Normalform Diagonalisierung Triangulierung Tensor Tensoren Tensorprodukt Kronecker
    Skalar Skalare Skalarprodukt Kreuzprodukt Vektorprodukt Spatprodukt Matrixprodukt Matrixmultiplikation Hadamardprodukt
    Außenprodukt Innenprodukt Linearkombination Linearform Bilinearform Sesquilinearform Quadratik Quadrik Hauptminor
    Orthogonalität Orthonormalbasis Orthogonalisierung Projektion Spiegelung Drehung Streckung Scherung Translation Transformation
    Lösbarkeit Eliminationsverfahren Zeilenstufenform Pivotelement Pivot Permutation Permutationen Transposition Zyklus Zyklen
    Signatur Orbit Stabilisator Operation Gruppenoperation Wirkung Darstellung Darstellungen Charakter Charaktere Zentrum
    Kommutator Zentralisator Normalisator Erzeuger Relationen Präsentation Sylowgruppe Diedergruppe Symmetriegruppe
    Zahl Zahlen Zahlenmenge Zahlenstrahl Zahlengerade Zahlbereich Zahlkörper Zahlentheorie Natürliche Ganze Rationale Reelle Komplexe
    Quaternion Quaternionen Oktonionen Realteil Imaginärteil Betrag Argument Konjugation Polarkoordinaten Polardarstellung
    Gaußsche Zahlenebene Einheitswurzel Einheitswurzeln Einheitskreis Primkörper Restklassenring Charakteristik Galoiskörper
    Galoistheorie Galoisgruppe Kreisteilung Teilbarkeit Euklidischer Algorithmus Bézout Kettenbruch Kettenbrüche Diophantische Kongruenzsystem
    Primzahltest Primzahlsatz Primzahlzwilling Mersenne Fermatzahl Carmichael Pseudoprimzahl Faktorisierungsproblem Zufallszahl
    Zufallszahlen Zufallszahlengenerator Pseudozufallszahl Hashwert Logarithmus Logarithmen Exponent Exponenten Potenz Potenzen
    Wurzel Wurzeln Quadratwurzel Fakultät Summe Summen Differenz Produkt Produkte Quotient Betragsfunktion Signumfunktion
    Gaußklammer Rundung Ceil Floor Modulo Modulorechnung Stellenwertsystem Dualsystem Binärsystem Hexadezimalsystem
    Dezimalsystem Oktalsystem Basisdarstellung Zweierkomplement Gleitkommazahl Gleitkommazahlen Festkommazahl Mantisse
    Exponentenfeld Maschinengenauigkeit Rundungsfehler Auslöschung Überlauf Unterlauf Konditionszahl
    """

    private static let analysisAndGeometry = """
    Analysis Folge Folgen Reihe Reihen Grenzwert Grenzwerte Limes Konvergenz Divergenz Konvergenzradius Konvergenzkriterium
    Cauchyfolge Teilfolge Häufungspunkt Häufungswert Supremum Infimum Maximum Minimum Schranke Beschränktheit Monotonie
    Stetigkeit Gleichmäßigkeit Lipschitzstetigkeit Differenzierbarkeit Differenzial Differenzialquotient Differenzenquotient
    Ableitung Ableitungen Richtungsableitung Gradient Gradienten Divergenz Rotation Laplaceoperator Hessematrix Jacobimatrix
    Kettenregel Produktregel Quotientenregel Mittelwertsatz Zwischenwertsatz Extremum Extrema Extremwert Extremstelle Wendepunkt
    Sattelpunkt Krümmung Tangente Normale Taylorreihe Taylorpolynom Taylorentwicklung Potenzreihe Fourierreihe Fourierkoeffizient
    Fouriertransformation Laplacetransformation Integral Integrale Integrand Integration Stammfunktion Riemannintegral Lebesgueintegral
    Lebesguemaß Maß Maße Maßraum Messbarkeit Nullmenge Doppelintegral Dreifachintegral Kurvenintegral Oberflächenintegral Volumenintegral
    Substitution Partialbruchzerlegung Integrationsgrenze Hauptsatz Satz Gaußscher Integralsatz Stokes Greensche
    Differenzialgleichung Differenzialgleichungen Anfangswertproblem Randwertproblem Gewöhnliche Partielle Lösungsfunktion
    Trennung Variation Konstanten Homogene Inhomogene Dämpfung Schwingung Schwingungen Oszillator Wellengleichung Wärmeleitungsgleichung
    Diffusionsgleichung Poissongleichung Laplacegleichung Eulergleichung Variationsrechnung Funktional Funktionale Hilbertraum
    Hilberträume Banachraum Banachräume Banachscher Fixpunktsatz Metrik Metriken Metrischer Norm Normen Halbnorm Euklidische Maximumsnorm
    Betragssumme Unterraumtopologie Topologie Topologien Topologischer Umgebung Umgebungen Offenheit Abgeschlossenheit Kompaktheit
    Zusammenhang Hausdorffraum Homöomorphismus Homöomorphie Homotopie Fundamentalgruppe Mannigfaltigkeit Mannigfaltigkeiten
    Tangentialraum Kotangentialraum Differentialform Differentialformen Karte Atlas Überdeckung Zerlegung Vollständigkeit
    Vervollständigung Dichte Separabilität Funktionenfolge Funktionenraum Funktionenräume Lebesgueraum Sobolevraum Distribution
    Distributionen Dirac Deltafunktion Heavisidefunktion Faltung Gammafunktion Betafunktion Zetafunktion Fehlerfunktion
    Exponentialfunktion Logarithmusfunktion Sinusfunktion Kosinusfunktion Tangensfunktion Kotangens Arkussinus Arkustangens
    Hyperbelfunktion Sinushyperbolicus Wurzelfunktion Treppenfunktion Indikatorfunktion Charakteristische Betragsfunktion
    Geometrie Punkt Punkte Gerade Geraden Strecke Strahl Ebene Ebenen Hyperebene Winkel Winkelhalbierende Dreieck Dreiecke
    Viereck Rechteck Quadrat Parallelogramm Trapez Raute Kreis Kreise Kugel Kugeln Ellipse Ellipsoid Hyperbel Parabel Paraboloid
    Kegel Kegelschnitt Kegelschnitte Zylinder Pyramide Prisma Würfel Quader Polyeder Polytop Simplex Simplizes Konvexität
    Konvexe Hülle Mittelpunkt Radius Durchmesser Umfang Fläche Flächeninhalt Volumen Oberfläche Abstand Distanz Orthogonale
    Parallele Lot Senkrechte Schwerpunkt Inkreis Umkreis Kongruenz Ähnlichkeit Affine Projektive Koordinaten Koordinatensystem
    Kartesische Polarkoordinaten Kugelkoordinaten Zylinderkoordinaten Parametrisierung Kurve Kurven Bogenlänge Raumkurve
    Fläche Flächen Parameterdarstellung Normalform Hessesche Normalenform Trigonometrie Sinus Kosinus Tangens Kotangens
    Sekans Kosekans Bogenmaß Gradmaß Additionstheorem Additionstheoreme Satz Pythagoras Kosinussatz Sinussatz Strahlensatz
    Fraktal Fraktale Hausdorffdimension Mandelbrotmenge Juliamenge Selbstähnlichkeit
    """

    private static let statistics = """
    Stochastik Wahrscheinlichkeit Wahrscheinlichkeiten Wahrscheinlichkeitstheorie Wahrscheinlichkeitsraum Wahrscheinlichkeitsmaß
    Wahrscheinlichkeitsverteilung Wahrscheinlichkeitsdichte Wahrscheinlichkeitsfunktion Verteilungsfunktion Dichtefunktion
    Zufallsvariable Zufallsvariablen Zufallsvektor Zufallsexperiment Zufallsprozess Ereignis Ereignisse Elementarereignis
    Ergebnisraum Ergebnismenge Sigmaalgebra Unabhängigkeit Abhängigkeit Bedingte Satz Bayes Bayessche Prior Posterior Likelihood
    Evidenz Erwartungswert Varianz Standardabweichung Kovarianz Korrelation Korrelationskoeffizient Schiefe Wölbung Kurtosis
    Moment Momente Quantil Quantile Median Modus Mittelwert Stichprobe Stichproben Stichprobenmittel Stichprobenvarianz Grundgesamtheit
    Population Merkmal Merkmale Merkmalsausprägung Skalenniveau Nominalskala Ordinalskala Intervallskala Verhältnisskala
    Häufigkeit Häufigkeiten Histogramm Boxplot Streudiagramm Ausreißer Spannweite Quartil Quartile Quartilsabstand Dezil Perzentil
    Normalverteilung Gaußverteilung Standardnormalverteilung Binomialverteilung Poissonverteilung Exponentialverteilung
    Gleichverteilung Geometrische Hypergeometrische Betaverteilung Gammaverteilung Chiquadratverteilung Studentverteilung
    Cauchyverteilung Weibullverteilung Lognormalverteilung Bernoulliverteilung Multinomialverteilung Dirichletverteilung
    Gesetz Gesetze Großen Zahlen Zentraler Grenzwertsatz Ungleichung Markovungleichung Tschebyscheffungleichung Chernoffschranke
    Schätzer Schätzfunktion Schätzwert Schätzung Erwartungstreue Konsistenz Effizienz Suffizienz Maximumlikelihood Momentenmethode
    Konfidenzintervall Vertrauensbereich Hypothesentest Nullhypothese Alternativhypothese Signifikanz Signifikanzniveau
    Teststatistik Prüfgröße Pwert Fehler erster Zweiter Fehlerart Teststärke Gütefunktion Ablehnungsbereich Annahmebereich
    Ttest Ftest Chiquadrattest Anova Varianzanalyse Regression Regressionsgerade Regressionskoeffizient Residuum Residuen
    Bestimmtheitsmaß Kleinste Quadrate Methode Multikollinearität Heteroskedastizität Autokorrelation Zeitreihe Zeitreihen Trend
    Saisonalität Stationarität Prognose Glättung Gleitender Durchschnitt Markovkette Markovketten Markovprozess Übergangswahrscheinlichkeit
    Übergangsmatrix Zustandsraum Zustand Zustände Absorbierend Stationäre Ergodizität Irreduzibilität Periodizität Rekurrenz
    Transienz Irrfahrt Brownsche Bewegung Wienerprozess Poissonprozess Martingal Martingale Stoppzeit Filtration Itô Integral
    Warteschlange Warteschlangentheorie Ankunftsrate Bedienrate Auslastung Monte Carlo Simulation Stichprobenverfahren
    Importance Sampling Gibbssampler Metropolis Hastings Markovchain Bootstrap Kreuzvalidierung Bayesian Inferenz Statistik
    Deskriptive Induktive Explorative Datenanalyse Entropie Kreuzentropie Transinformation Informationsgehalt Kullback Leibler
    Divergenz Fisherinformation Cramér Rao Schranke Zufallsgenerator Versuchsplanung Faktor Faktoren Randomisierung
    Kontrollgruppe Experimentalgruppe Stichprobenumfang Fallzahl Effektstärke Cohen Konfidenz Varianzkomponente Mischverteilung
    """

    private static let logicAndDiscrete = """
    Logik Aussagenlogik Prädikatenlogik Modallogik Temporallogik Fuzzylogik Aussage Aussagen Formel Formeln Prädikat Prädikate
    Junktor Junktoren Wahrheitswert Wahrheitswerte Wahrheitstabelle Tautologie Kontradiktion Erfüllbarkeit Allgemeingültigkeit
    Modell Modelle Interpretation Belegung Semantik Syntax Kalkül Kalküle Ableitung Herleitung Resolution Resolvente Klausel
    Klauseln Konjunktive Normalform Disjunktive Normalform Skolemisierung Unifikation Unifikator Herbrand Hornklausel
    Vollständigkeit Korrektheit Konsistenz Entscheidbarkeit Unentscheidbarkeit Halteproblem Gödel Unvollständigkeitssatz
    Berechenbarkeit Berechenbarkeitstheorie Komplexitätstheorie Komplexität Komplexitätsklasse Reduktion Reduktionen
    Polynomialzeit Orakel Turingmaschine Turingmaschinen Registermaschine Lambdakalkül Church Turing These Rekursion
    Rekursionstheorie Primitiv Rekursive Fixpunktkombinator Kombinator Kombinatoren Typentheorie Beweistheorie Modelltheorie
    Mengenlehre Kategorientheorie Kategorie Kategorien Funktor Funktoren Morphismus Morphismen Monade Monaden Adjunktion
    Gitter Verband Verbände Halbverband Boolesche Algebra Heytingalgebra Ordnung Ordnungen Hasse Diagramm Kette Antikette
    Kombinatorik Permutation Kombination Variation Binomialsatz Pascalsches Dreieck Stirlingzahl Stirlingzahlen Catalanzahl
    Catalanzahlen Fibonaccizahl Fibonaccizahlen Bellzahl Partition Partitionen Inklusion Exklusion Schubfachprinzip Doppeltes
    Abzählen Erzeugende Funktion Rekursionsgleichung Rekurrenz Rekurrenzrelation Mastertheorem Landau Symbole Asymptotik
    Graph Graphen Knoten Kante Kanten Pfad Pfade Weg Wege Kreis Zyklus Baum Bäume Wald Wälder Spannbaum Spannbäume Wurzelbaum
    Binärbaum Blatt Blätter Grad Eingangsgrad Ausgangsgrad Nachbar Nachbarn Nachbarschaft Zusammenhangskomponente
    Starke Zusammenhangskomponenten Brücke Artikulationspunkt Schnittknoten Schnitt Fluss Flüsse Netzwerkfluss Matching Paarung
    Färbung Knotenfärbung Kantenfärbung Chromatische Zahl Clique Cliquen Unabhängige Menge Überdeckung Dominierende Planarität
    Planar Bipartit Vollständiger Eulerkreis Eulerweg Hamiltonkreis Hamiltonweg Isomorphie Subgraph Teilgraph Minor Gerichteter
    Ungerichteter Gewichteter Multigraph Hypergraph Digraph Adjazenzliste Inzidenzliste Zufallsgraph Kleine Welt Skalenfrei
    Zentralität Gradverteilung Clusterkoeffizient Community Modularität Spektrale Graphtheorie Netzwerk Netzwerke
    Optimierung Zielfunktion Nebenbedingung Nebenbedingungen Zulässigkeit Zulässiger Bereich Optimum Optima Lagrangemultiplikator
    Dualität Dualproblem Primalproblem Simplexverfahren Lineare Programmierung Ganzzahlige Programmierung Konvexe Optimierung
    Quadratische Programmierung Gradientenverfahren Gradientenabstieg Newtonverfahren Quasinewton Konjugierte Gradienten
    Evolutionäre Algorithmen Genetische Algorithmen Schwarmintelligenz Simulated Annealing Tabusuche Branch Bound Relaxation
    Heuristik Metaheuristik Approximationsalgorithmus Approximationsgüte Spieltheorie Nash Gleichgewicht Auszahlung Strategie
    Strategien Nullsummenspiel Gefangenendilemma Pareto Optimalität Entscheidungstheorie Nutzenfunktion Kontrolltheorie
    """

    private static let numerics = """
    Numerik Numerische Mathematik Näherung Approximation Interpolation Extrapolation Spline Splines Polynominterpolation Lagrangeinterpolation
    Newtoninterpolation Stützstelle Stützstellen Stützpunkte Quadratur Quadraturformel Trapezregel Simpsonregel Gaußquadratur
    Newton Cotes Romberg Extrapolationsverfahren Nullstellenbestimmung Bisektion Sekantenverfahren Regula Falsi Fixpunktiteration
    Iterationsverfahren Iteration Iterationen Iterationsschritt Abbruchkriterium Konvergenzordnung Konvergenzgeschwindigkeit
    Stabilität Vorwärtsstabilität Rückwärtsstabilität Konsistenzordnung Diskretisierung Diskretisierungsfehler Gitter Gitterweite
    Schrittweite Schrittweitensteuerung Eulerverfahren Runge Kutta Heun Mittelpunktsverfahren Mehrschrittverfahren Adams Bashforth
    Moulton Steife Differenzialgleichungen Finite Differenzen Finite Elemente Finite Volumen Spektralmethoden Galerkin Ritz
    Gewichtsfunktion Basisfunktion Formfunktion Steifigkeitsmatrix Massenmatrix Assemblierung Triangulierung Netzgenerierung
    Gaußelimination Gaußverfahren LUZerlegung Cholesky Zerlegung QRZerlegung Householder Givens Rotation Gram Schmidt Jacobiverfahren
    Gauß Seidel Verfahren Relaxationsverfahren Krylovraum Krylov Unterraumverfahren Arnoldi Lanczos Verfahren Vorkonditionierer
    Vorkonditionierung Mehrgitterverfahren Potenzmethode Inverse Iteration QRAlgorithmus Ausgleichsrechnung Ausgleichsproblem
    Normalengleichungen Regularisierung Tikhonov Dünnbesetzte Matrizen Bandmatrix Sparse Fastfouriertransformation Schnelle Konvolution
    Fehlerabschätzung Fehlerschranke Fehlerfortpflanzung Rückwärtsfehler Vorwärtsfehler Gleitkommaarithmetik Rechengenauigkeit
    Doppelte Genauigkeit Einfache Halbgenauigkeit Maschinenzahl Unendlich Overflow Underflow Nan
    """
}
