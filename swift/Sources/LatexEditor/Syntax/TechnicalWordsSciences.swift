import Foundation

/// Physik, Quantenphysik, Elektrotechnik, angrenzende Wissenschaften, Einheiten, wissenschaftliches Arbeiten, Adjektive, Verben
/// und Eigennamen (siehe `TechnicalWords`)
extension TechnicalWords {
    static let physics = """
    Physik Mechanik Kinematik Dynamik Statik Kraft Kräfte Masse Massen Impuls Drehimpuls Energie Energien Arbeit Leistung Wirkungsgrad
    Geschwindigkeit Beschleunigung Weg Zeit Position Ort Trägheit Trägheitsmoment Trägheitstensor Drehmoment Gravitation Schwerkraft
    Schwerpunkt Reibung Haftreibung Gleitreibung Federkraft Zentripetalkraft Zentrifugalkraft Corioliskraft Newtonsche Gesetze
    Erhaltungssatz Erhaltungssätze Energieerhaltung Impulserhaltung Drehimpulserhaltung Kinetische Potenzielle Potentielle
    Lagrangefunktion Lagrangeformalismus Hamiltonfunktion Hamiltonformalismus Wirkung Wirkungsprinzip Prinzip Extremalprinzip
    Bewegungsgleichung Bewegungsgleichungen Phasenraum Phasenportrait Trajektorie Bahnkurve Bahn Umlaufbahn Keplersche Gesetze
    Pendel Federpendel Fadenpendel Doppelpendel Oszillator Harmonischer Gedämpfter Angeregter Resonanz Resonanzfrequenz Eigenfrequenz
    Eigenschwingung Schwingungsdauer Periodendauer Frequenz Frequenzen Kreisfrequenz Amplitude Phase Phasenverschiebung Welle Wellen
    Wellenlänge Wellenzahl Wellenvektor Wellenfront Wellenpaket Dispersion Interferenz Beugung Brechung Reflexion Polarisation
    Superposition Überlagerung Stehende Welle Schallwelle Schalldruck Schallgeschwindigkeit Dopplereffekt Akustik Ultraschall
    Starrer Körper Kontinuumsmechanik Elastizität Elastizitätsmodul Schubmodul Spannung Dehnung Verformung Hookesches Gesetz
    Fluidmechanik Strömung Strömungen Viskosität Reynoldszahl Turbulenz Laminar Bernoulligleichung Kontinuitätsgleichung Navier Stokes
    Hydrostatik Druck Dichte Auftrieb Oberflächenspannung Kapillarität
    Thermodynamik Wärme Temperatur Wärmekapazität Wärmeleitung Wärmestrahlung Konvektion Entropie Enthalpie Freie Energie Innere Energie
    Hauptsatz Hauptsätze Zustandsgröße Zustandsgrößen Zustandsgleichung Zustandsänderung Isotherm Isobar Isochor Adiabatisch Kreisprozess
    Carnotprozess Wärmekraftmaschine Wärmepumpe Kältemaschine Idealgas Ideales Gas Gaskonstante Boltzmannkonstante Teilchenzahl
    Statistische Physik Zustandssumme Verteilungsfunktion Boltzmannverteilung Maxwellverteilung Fermiverteilung Boseverteilung
    Gleichgewicht Nichtgleichgewicht Phasenübergang Phasenübergänge Phasendiagramm Kritischer Punkt Ordnungsparameter Isingmodell
    Heisenbergmodell Spinglas Magnetisierung Suszeptibilität Mean Field Renormierungsgruppe Universalität Fluktuation Fluktuationen
    Elektrodynamik Elektrostatik Magnetostatik Ladung Ladungen Ladungsdichte Stromdichte Strom Spannung Widerstand Leitfähigkeit
    Kapazität Induktivität Impedanz Elektrisches Feld Magnetisches Feld Feldstärke Flussdichte Fluss Potenzial Potential Dipol
    Dipolmoment Multipolentwicklung Coulombgesetz Gaußsches Gesetz Ampèresches Faradaysches Induktionsgesetz Lenzsche Regel
    Maxwellgleichungen Maxwellsche Gleichungen Lorentzkraft Poyntingvektor Strahlung Antenne Wellenleiter Hohlraumresonator Plasma
    Optik Strahlenoptik Wellenoptik Linse Linsen Brennweite Brennpunkt Spiegel Prisma Gitter Beugungsgitter Spalt Doppelspalt
    Einzelspalt Interferometer Michelson Mach Zehnder Fabry Perot Laser Maser Lichtquelle Photon Photonen Photodiode Detektor
    Fotodetektor Strahlteiler Polarisator Wellenplatte Halbwellenplatte Viertelwellenplatte Faser Glasfaser Lichtleiter Kohärenz
    Kohärenzlänge Kohärenzzeit Absorption Emission Streuung Rayleighstreuung Ramanstreuung Brechungsindex Totalreflexion
    Relativitätstheorie Spezielle Allgemeine Raumzeit Lorentztransformation Zeitdilatation Längenkontraktion Äquivalenzprinzip
    Metrik Krümmung Schwarzes Loch Ereignishorizont Gravitationswelle Gravitationswellen Kosmologie Urknall Expansion Dunkle Materie
    Dunkle Energie Hintergrundstrahlung Rotverschiebung Hubblekonstante Stern Sterne Galaxie Galaxien Planet Planeten Exoplanet
    Astrophysik Astronomie Teleskop Spektroskopie Spektrum Spektrallinie Linienspektrum Emissionsspektrum Absorptionsspektrum
    Atomphysik Atom Atome Atomkern Kernphysik Elektron Elektronen Proton Protonen Neutron Neutronen Nukleon Nukleonen Ion Ionen
    Isotop Isotope Kernspaltung Kernfusion Radioaktivität Zerfall Zerfallsrate Halbwertszeit Alphastrahlung Betastrahlung Gammastrahlung
    Teilchenphysik Elementarteilchen Standardmodell Quark Quarks Lepton Leptonen Boson Bosonen Fermion Fermionen Gluon Gluonen
    Higgsboson Neutrino Neutrinos Myon Tauon Antiteilchen Antimaterie Wechselwirkung Wechselwirkungen Starke Schwache Feynmandiagramm
    Streuquerschnitt Beschleuniger Teilchenbeschleuniger Collider Detektoren Festkörperphysik Kristall Kristalle Kristallgitter
    Gitterkonstante Brillouinzone Bandstruktur Bandlücke Leitungsband Valenzband Halbleiter Dotierung Leiter Isolator Supraleiter
    Supraleitung Sprungtemperatur Cooperpaar Josephsonkontakt Josephsoneffekt Magnetismus Ferromagnetismus Antiferromagnetismus
    Paramagnetismus Diamagnetismus Phonon Phononen Magnon Exziton Plasmon Polariton Defekt Defekte Versetzung Korngrenze
    Nanotechnologie Nanostruktur Nanostrukturen Quantenpunkt Quantendraht Quantentopf Graphen Kohlenstoffnanoröhre Dünnschicht
    Oberflächenphysik Tunnelmikroskop Rasterkraftmikroskop Elektronenmikroskop Röntgenbeugung Neutronenstreuung Spektrometer
    Messung Messungen Messgröße Messfehler Messunsicherheit Systematischer Statistischer Kalibrierung Auflösung Genauigkeit
    Rauschen Rauschabstand Signal Signale Störung Störungen Untergrund Hintergrund Messgerät Oszilloskop Multimeter
    """

    static let quantum = """
    Quantenmechanik Quantenphysik Quantentheorie Quantenfeldtheorie Quantenelektrodynamik Quantenchromodynamik Quantengravitation
    Quantenzustand Quantenzustände Zustandsvektor Zustandsraum Wellenfunktion Wellenfunktionen Zustand Superpositionszustand Bra Ket
    Dirac Notation Diracnotation Hilbertraum Skalarprodukt Normierung Orthonormalität Vollständigkeitsrelation Projektor Projektoren
    Dichteoperator Dichtematrix Reiner Gemischter Zustand Reinheit Spur Partielle Reduzierte Schmidtzerlegung Schmidtrang
    Observable Observablen Operator Operatoren Hermitesch Unitär Selbstadjungiert Adjungiert Kommutator Antikommutator Vertauschungsrelation
    Unschärferelation Unschärfe Heisenbergsche Messung Messprozess Messproblem Kollaps Wellenfunktionskollaps Dekohärenz Dekohärenzzeit
    Kohärenzzeit Relaxationszeit Dephasierung Energierelaxation Rauschen Quantenrauschen Fehlerrate Fehlerkorrektur Fehlerschwelle
    Schrödingergleichung Zeitabhängige Zeitunabhängige Hamiltonoperator Hamiltonian Energieeigenwert Energieniveau Energieniveaus
    Grundzustand Angeregter Zustand Zeitentwicklung Zeitentwicklungsoperator Propagator Pfadintegral Bilderwechsel Schrödingerbild
    Heisenbergbild Wechselwirkungsbild Störungstheorie Variationsprinzip Näherung Born Oppenheimer Hartree Fock Dichtefunktionaltheorie
    Wasserstoffatom Harmonischer Oszillator Potentialtopf Potentialbarriere Tunneleffekt Tunnelstrom Streuung Streutheorie
    Spin Spinoperator Pauli Paulimatrizen Pauliprinzip Spinor Spinoren Spinzustand Drehimpulsoperator Clebsch Gordan Kopplung Zeeman
    Starkeffekt Feinstruktur Hyperfeinstruktur Lambverschiebung Auswahlregel Auswahlregeln Übergangsrate Fermis Goldene Regel
    Rabioszillation Rabifrequenz Blochkugel Blochvektor Blochgleichungen Zweiniveausystem Dreiniveausystem Lambdasystem
    Verschränkung Verschränkt Verschränkte Zustände Bellzustand Bellzustände Bellungleichung Bellsche Ungleichung CHSH GHZ
    Wzustand Clusterzustand Graphzustand Stabilisatorzustand Stabilisatorformalismus Stabilisator Stabilisatoren Nichtlokalität
    Lokaler Realismus Verborgene Variablen Einstein Podolsky Rosen EPR Paradoxon Schrödingers Katze Kopenhagener Deutung Viele
    Welten Interpretation Bohmsche Mechanik Dekohärente Historien Quantenzustandstomographie Tomographie Prozesstomographie
    Quanteninformation Quanteninformatik Quantencomputing Quantencomputer Quantenrechner Quantenrechnen Quantenalgorithmus
    Quantenalgorithmen Quantenschaltkreis Quantenschaltkreise Quantengatter Quantenregister Quantenspeicher Quantenbit Qubit Qubits
    Qudit Qudits Qutrit Kopplung Kopplungen Kopplungsstärke Qubitfrequenz Qubitkopplung Supraleitende Qubits Transmon Transmonqubit
    Fluxonium Fluxqubit Ladungsqubit Phasenqubit Josephsonkontakt Resonatorqubit Cavity Cavityqubit Zirkulator Verstärker
    Parametrischer Verstärker Verdünnungskryostat Kryostat Kryotechnik Millikelvin Mikrowellenpuls Mikrowellenpulse Pulsformung
    Pulssequenz Pulssequenzen Dynamische Entkopplung Spinecho Ramsey Ramseyexperiment Hahn Echo Rabi Experiment
    Ionenfalle Ionenfallen Gefangene Ionen Paulfalle Penningfalle Laserkühlung Dopplerkühlung Seitenbandkühlung Neutralatome
    Neutralatomquantencomputer Rydbergatom Rydbergatome Rydbergblockade Optische Pinzette Optische Gitter Photonische Qubits
    Linearoptisches Quantencomputing Photonenzählung Einzelphotonenquelle Einzelphotonendetektor Squeezing Gequetschte Zustände
    Kohärenter Zustand Kohärente Zustände Fockzustand Fockzustände Fockraum Besetzungszahl Erzeugungsoperator Vernichtungsoperator
    Teilchenzahloperator Bosonische Fermionische Modi Modus Bosonensampling Gaußsche Zustände Kontinuierliche Variablen
    Spinqubit Spinqubits Siliziumqubit Quantenpunktqubit Stickstoff Fehlstelle NVZentrum Diamant Majorana Topologische Qubits Anyonen
    Quantenannealing Annealer Adiabatisches Quantencomputing Adiabatischer Satz Ising Hamiltonian QUBO Quantenoptimierung
    Gatterbasiert Gattermodell Messungsbasiert Einwegquantencomputer Universelle Gattermenge Universalität Solovay Kitaev
    Clifford Gruppe Cliffordgatter Cliffordgatter Tgatter Hadamardgatter Paulix Pauliy Pauliz Phasengatter CNOT Controlled
    Toffoli Fredkin Swap Gatter Kontrollqubit Zielqubit Ancilla Ancillaqubit Hilfsqubit Uhrenübertragung Rotationsgatter
    Gatterfehler Gattergenauigkeit Gattertreue Fidelity Prozesstreue Verlässlichkeit Leckage Übersprechen Crosstalk Kalibrierung
    Randomized Benchmarking Gatesettomographie Quantenvolumen Schaltkreistiefe Gattertiefe Gatterzeit Kohärenzbudget
    Quantenfehlerkorrektur Fehlerkorrekturcode Fehlerkorrekturcodes Oberflächencode Surfacecode Steanecode Shorcode Bitflip
    Phaseflip Syndrom Syndrommessung Dekodierer Dekodierung Logisches Qubit Logische Qubits Physikalisches Qubit Physikalische
    Fehlertolerant Fehlertolerantes Quantencomputing Schwellentheorem Magic State Destillation Lattice Surgery Konkatenation
    Quantenalgorithmus Shoralgorithmus Groveralgorithmus Deutsch Jozsa Bernstein Vazirani Simon Quantenfouriertransformation
    Phasenschätzung Quantenphasenschätzung Amplitudenverstärkung Amplitudenschätzung Quantensuche Quantenwalks Quantenwanderung
    Variationsalgorithmus VQE QAOA Variationaler Quanteneigenlöser Ansatz Parametrisierter Schaltkreis Barren Plateau Gradient
    Parameterverschiebung Hybridalgorithmus Hybrid Quantenklassisch Quantensimulation Hamiltonsimulation Trotter Suzuki Zerlegung
    Trotterfehler Lineare Kombination Unitärer Operatoren Qubitisierung Quantensignalverarbeitung HHL Quantenlinearsystemlöser
    Quantenvorteil Quantenüberlegenheit Quantensupremacy NISQ Rauschbehaftet Mittelskalig Quantenhardware Quantenprozessor QPU
    Quantensimulator Quantenemulator Quantencloud Quantensoftware Quantenprogrammierung Quantenprogramm Quantenprogramme Transpilation
    Transpiler Kompilierung Schaltkreisoptimierung Qubitmapping Routing Topologie Konnektivität Kopplungsgraph Heavy Hex
    Teleportation Quantenteleportation Superdichtes Codieren Entanglement Swapping Quantenrepeater Quantennetzwerk Quanteninternet
    Quantenkommunikation Quantenschlüsselaustausch BBBB Ekert Nichtklonierungssatz Kloning Quantenzufallszahlengenerator
    Quantenmetrologie Quantensensorik Quantensensor Interferometrie Heisenberglimit Standardquantenlimit Quantenthermodynamik
    Quantenchemie Molekül Moleküle Molekülorbital Orbital Orbitale Elektronenstruktur Bindungsenergie Potentialfläche Coupled Cluster
    Konfigurationswechselwirkung Jordan Wigner Bravyi Kitaev Fermionenabbildung Fermionische Operatoren Aktiver Raum Basissatz
    """

    static let electronics = """
    Elektrotechnik Elektronik Schaltung Schaltungen Schaltkreis Schaltplan Bauelement Bauelemente Widerstand Kondensator Spule Diode
    Transistor Transistoren Thyristor Operationsverstärker Verstärker Verstärkung Rückkopplung Filter Tiefpass Hochpass Bandpass
    Bandsperre Oszillator Mischer Modulator Demodulator Modulation Amplitudenmodulation Frequenzmodulation Phasenmodulation
    Träger Trägerfrequenz Basisband Zwischenfrequenz Signalverarbeitung Digitale Analoge Abtastung Abtastrate Abtasttheorem
    Nyquist Shannon Aliasing Quantisierung Quantisierungsrauschen Analog Digital Wandler ADC DAC Zeitdiskret Zeitkontinuierlich
    Impulsantwort Sprungantwort Übertragungsfunktion Frequenzgang Bodediagramm Nyquistdiagramm Pol Pole Nullstelle Stabilität
    Regelungstechnik Regelkreis Regler Regelstrecke Stellgröße Regelgröße Führungsgröße Störgröße Sollwert Istwert Regelabweichung
    Proportionalregler Integralregler Differenzialregler PIDRegler Zustandsraumdarstellung Zustandsregler Beobachter Steuerbarkeit
    Beobachtbarkeit Linearisierung Arbeitspunkt Zeitkonstante Sprunghöhe Überschwingen Einschwingzeit Phasenreserve Amplitudenreserve
    Gleichstrom Wechselstrom Drehstrom Effektivwert Scheitelwert Scheinleistung Wirkleistung Blindleistung Leistungsfaktor Netzteil
    Transformator Gleichrichter Wechselrichter Spannungsregler Batterie Akkumulator Solarzelle Photovoltaik Brennstoffzelle Motor
    Generator Aktor Aktoren Sensor Sensoren Messumformer Mikroprozessor Logikgatter Logikbaustein Flipflop Register Zähler
    Schieberegister Multiplexer Dekodierer Addierer Volladdierer Halbaddierer ALU Speicherzelle SRAM DRAM Flash EEPROM Leiterplatte
    Platine Lötstelle Bonddraht Gehäuse Integrierte Schaltung Mikrochip Wafer Lithographie Halbleiterfertigung Reinraum CMOS
    MOSFET Bipolartransistor JFET Feldeffekttransistor Gate Source Drain Substrat Schwellspannung Leckstrom Verlustleistung
    Signalintegrität Übersprechen Impedanzanpassung Reflexionsfaktor Stehwellenverhältnis Streuparameter Smithdiagramm Koaxialkabel
    Mikrostreifenleitung Koplanarleitung Wellenwiderstand Leitung Leitungen Hochfrequenztechnik Mikrowellentechnik Millimeterwellen
    Rauschzahl Rauschtemperatur Thermisches Rauschen Schrotrauschen Flickerrauschen Phasenrauschen Jitter Takt Taktgeber Quarz
    Quarzoszillator Phasenregelschleife PLL Frequenzsynthese Synthesizer Lokaloszillator Spektrumanalysator Netzwerkanalysator
    Arbitrary Waveform Generator Signalgenerator Lockin Verstärker Boxcar Mittelung Korrelation Autokorrelation Kreuzkorrelation
    Leistungsdichtespektrum Spektraldichte Periodogramm Fenster Fensterfunktion Hannfenster Hammingfenster Kaiserfenster
    Diskrete Fouriertransformation FFT Wavelet Wavelettransformation Kurzzeit Spektrogramm Hilberttransformation Faltungssatz
    Kalmanfilter Wienerfilter Adaptive Filter FIRFilter IIRFilter Kausalität Linearität Zeitinvarianz LTISystem Signalenergie
    """

    static let relatedSciences = """
    Chemie Chemische Reaktion Reaktionen Reaktionsgleichung Reaktionskinetik Reaktionsrate Katalysator Katalyse Gleichgewichtskonstante
    Löslichkeit Konzentration Stoffmenge Molekülmasse Molmasse Periodensystem Element Elemente Verbindung Verbindungen Bindung
    Bindungen Kovalente Ionische Metallische Wasserstoffbrücke Oxidation Reduktion Redoxreaktion Säure Base Säuren Basen pHWert
    Elektrolyse Elektrochemie Elektrolyt Elektrode Elektroden Anode Kathode Spannungsreihe Batteriechemie Polymer Polymere Kunststoff
    Organische Anorganische Physikalische Chemie Biochemie Molekularbiologie Genetik Genom Gen Gene DNA RNA Protein Proteine Enzym
    Enzyme Zelle Zellen Zellkern Mitochondrium Stoffwechsel Photosynthese Evolution Selektion Mutation Population Ökologie Ökosystem
    Biologie Neurowissenschaft Neuron Synapse Gehirn Kognition Wahrnehmung Medizin Bildgebung Tomographie Kernspintomographie
    Magnetresonanztomographie Röntgen Ultraschall Strahlentherapie Dosimetrie Epidemiologie Diagnostik Biomedizin Bioinformatik
    Sequenzanalyse Sequenzalignment Genomik Proteomik Systembiologie
    Materialwissenschaft Werkstoff Werkstoffe Werkstoffkunde Legierung Legierungen Keramik Verbundwerkstoff Gefüge Mikrostruktur
    Festigkeit Zugfestigkeit Streckgrenze Härte Zähigkeit Bruchzähigkeit Ermüdung Kriechen Korrosion Verschleiß Beschichtung
    Maschinenbau Konstruktion Fertigung Fertigungstechnik Zerspanung Umformung Schweißen Urformen Montage Toleranz Passung Normteil
    Wärmetauscher Turbine Verbrennungsmotor Elektromotor Getriebe Welle Lager Zahnrad Feder Dichtung Hydraulik Pneumatik Robotik
    Roboter Manipulator Kinematikkette Denavit Hartenberg Bahnplanung Greifer Sensorik Aktorik Mechatronik Automatisierung
    Automatisierungstechnik Speicherprogrammierbare Steuerung SPS Prozessleittechnik Industrie Cyberphysische Systeme Internet
    Things Digitaler Zwilling Simulation Simulationen Modellbildung Modellierung Validierung Verifikation Parameteridentifikation
    Systemtheorie Systemdynamik Chaostheorie Chaos Attraktor Bifurkation Lyapunovexponent Fraktalität Selbstorganisation Emergenz
    Komplexe Systeme Agentenbasierte Modellierung Zellulärer Automat Spieldes Lebens Kybernetik Informationstheorie Codierungstheorie
    Kanalkapazität Kanalcodierung Quellencodierung Huffmancode Hammingcode ReedSolomon LDPCCode Turbocode Faltungscode Entropiecodierung
    Datenkompression Verlustfrei Verlustbehaftet Bildkompression JPEG PNG Audiokompression MP Videokompression Wavelet
    Ökonomie Wirtschaftsinformatik Operations Research Logistik Optimierungsproblem Finanzmathematik Optionspreis BlackScholes
    Portfolio Risikomaß Value Risk Zinseszins Barwert Rendite Volatilität Derivat Derivate Versicherungsmathematik Ökonometrie
    Geoinformatik Geodäsie Kartographie Fernerkundung Klimamodell Klimawandel Meteorologie Wettervorhersage Numerische Wettervorhersage
    Erdbeben Seismologie Ozeanographie Hydrologie Energietechnik Energiesystem Erneuerbare Energien Windkraft Solarenergie Kernenergie
    Speichertechnologie Wasserstofftechnologie Elektromobilität Ladeinfrastruktur
    """

    static let units = """
    Meter Zentimeter Millimeter Mikrometer Nanometer Pikometer Femtometer Kilometer Angström Lichtjahr Parsec Gramm Kilogramm Milligramm
    Mikrogramm Tonne Sekunde Millisekunde Mikrosekunde Nanosekunde Pikosekunde Femtosekunde Minute Stunde Hertz Kilohertz Megahertz
    Gigahertz Terahertz Newton Joule Kilojoule Elektronenvolt Kiloelektronenvolt Megaelektronenvolt Gigaelektronenvolt Teraelektronenvolt
    Watt Kilowatt Megawatt Gigawatt Pascal Hektopascal Kilopascal Megapascal Bar Millibar Atmosphäre Kelvin Millikelvin Mikrokelvin
    Nanokelvin Celsius Fahrenheit Ampere Milliampere Mikroampere Nanoampere Volt Millivolt Mikrovolt Kilovolt Ohm Kiloohm Megaohm Siemens
    Farad Mikrofarad Nanofarad Pikofarad Henry Millihenry Nanohenry Weber Tesla Millitesla Mikrotesla Gauß Coulomb Mol Candela Lumen Lux
    Becquerel Gray Sievert Dezibel Neper Radiant Grad Steradiant Bit Byte Kilobyte Megabyte Gigabyte Terabyte Petabyte Exabyte Kibibyte
    Mebibyte Gibibyte Tebibyte Baud Bitrate Datenrate Megabit Gigabit FLOPS Gigaflops Teraflops Petaflops Exaflops MIPS Pixel Dpi
    Prozent Promille Parts Million ppm ppb Dalton Planckeinheiten Planckkonstante Lichtgeschwindigkeit Elementarladung Feinstrukturkonstante
    Avogadrokonstante Rydbergkonstante Bohrradius Bohrsches Magneton Kernmagneton Gravitationskonstante Boltzmannkonstante Stefan
    Boltzmann Wiensches Verschiebungsgesetz Vakuumpermittivität Vakuumpermeabilität Wellenwiderstand Elektronenmasse Protonenmasse
    """

    static let scientificWriting = """
    Abschlussarbeit Bachelorarbeit Masterarbeit Diplomarbeit Dissertation Habilitation Seminararbeit Projektarbeit Forschungsarbeit
    Forschungsfrage Forschungsstand Forschungslücke Forschungsmethode Forschungsdesign Fragestellung Zielsetzung Motivation Problemstellung
    Hypothesen Methodik Methoden Vorgehensweise Versuchsaufbau Versuchsdurchführung Auswertung Ergebnis Ergebnisse Diskussion Fazit
    Zusammenfassung Ausblick Einleitung Hauptteil Schlussfolgerung Schlussfolgerungen Abstract Kurzfassung Inhaltsverzeichnis
    Abbildungsverzeichnis Tabellenverzeichnis Abkürzungsverzeichnis Symbolverzeichnis Literaturverzeichnis Quellenverzeichnis Glossar
    Anhang Anhänge Danksagung Eidesstattliche Erklärung Titelblatt Deckblatt Kapitel Abschnitt Unterabschnitt Absatz Fußnote Fußnoten
    Randnotiz Marginalie Zitat Zitate Zitation Zitierweise Zitierstil Quellenangabe Quellenkritik Primärquelle Sekundärquelle Fachliteratur
    Fachartikel Fachzeitschrift Journal Konferenzband Tagungsband Preprint Begutachtung Peer Review Impact Faktor Referenz Referenzen
    Bibliographie Bibliografie Literaturrecherche Literaturübersicht Systematischer Review Metaanalyse Fallstudie Fallstudien Umfrage
    Umfragen Interview Interviews Experiment Experimente Beobachtung Beobachtungen Empirie Empirisch Qualitative Quantitative
    Stichprobenziehung Repräsentativität Reliabilität Validität Objektivität Replizierbarkeit Reproduzierbarkeit Plagiat Plagiatsprüfung
    Gliederung Argumentation Argument Argumente These Thesen Antithese Synthese Definitionen Begriffsklärung Begriffsdefinition Abgrenzung
    Abgrenzungen Eingrenzung Einschränkung Einschränkungen Annahmen Limitationen Validitätsbedrohung Bedrohungen Beitrag Beiträge
    Kontext Hintergrund Grundlagen Stand Technik Verwandte Arbeiten Vergleich Vergleiche Bewertung Evaluation Evaluierung Auswertungsmethode
    Fachbegriff Fachbegriffe Fachsprache Terminologie Notation Notationen Konvention Konventionen Nomenklatur Symbolik Bezeichnung
    Betreuer Betreuerin Gutachter Gutachterin Erstgutachter Zweitgutachter Hochschule Fachhochschule Universität Fakultät Studiengang
    Studienarbeit Praktikum Praxisprojekt Kolloquium Verteidigung Präsentation Vortrag Poster Handout Lehrveranstaltung Vorlesung
    Übung Übungsaufgabe Aufgabenstellung Musterlösung Lernziel Lernziele Kompetenz Kompetenzen Modulhandbuch Leistungsnachweis
    Zeitplan Arbeitsplan Meilensteinplan Projektplan Gantt Aufwand Ressourcen Kosten Nutzen Risiken Chancen
    """

    // MARK: Adjektive und Verben

    static let adjectives = """
    linear nichtlinear affin quadratisch kubisch polynomial exponentiell logarithmisch trigonometrisch rational irrational reell komplex
    imaginär ganzzahlig natürlich ganz positiv negativ nichtnegativ gerade ungerade prim teilerfremd stetig unstetig differenzierbar
    integrierbar beschränkt unbeschränkt monoton konvergent divergent konstant periodisch symmetrisch antisymmetrisch asymmetrisch
    reflexiv transitiv injektiv surjektiv bijektiv invertierbar regulär singulär orthogonal orthonormal unitär hermitesch normal
    diagonal diagonalisierbar triangular positiv definit semidefinit indefinit kommutativ assoziativ distributiv abelsch zyklisch
    endlich unendlich abzählbar überabzählbar leer disjunkt kompakt offen abgeschlossen zusammenhängend konvex konkav homogen
    inhomogen autonom stationär stochastisch deterministisch zufällig unabhängig abhängig bedingt marginal diskret kontinuierlich
    stetige gleichverteilt normalverteilt binomialverteilt erwartungstreu konsistent signifikant repräsentativ iterativ rekursiv
    sequenziell sequentiell parallel nebenläufig synchron asynchron blockierend effizient ineffizient optimal suboptimal
    heuristisch approximativ exakt näherungsweise numerisch analytisch symbolisch algorithmisch berechenbar entscheidbar
    polynomiell exponentiale NPvollständig statisch dynamisch generisch abstrakt konkret objektorientiert funktional imperativ
    deklarativ typsicher nullbar veränderlich unveränderlich zustandslos zustandsbehaftet verteilt dezentral zentralisiert redundant
    robust skalierbar portabel wartbar modular binär ternär hexadezimal dezimal oktal digital analog seriell
    quantenmechanisch quantisiert verschränkt kohärent dekohärent supraleitend unitär adiabatisch diabatisch relativistisch
    klassisch semiklassisch thermisch magnetisch elektrisch elektromagnetisch optisch akustisch kinetisch potenziell potentiell
    elastisch plastisch viskos laminar turbulent isotrop anisotrop homogene adiabatisch isotherm isobar isochor reversibel
    irreversibel gebunden frei angeregt gedämpft getrieben resonant dispersiv monochromatisch kollinear antiparallel
    empirisch theoretisch experimentell methodisch systematisch reproduzierbar valide reliabel qualitativ quantitativ
    """

    /// Verbstämme (ohne `en`): `optimier` für `optimieren`, `berechn` für `berechnen`
    static let verbs = """
    berechn optimier iterier approximier diskretisier integrier differenzier ableit interpolier extrapolier normier normalisier
    skalier projizier transformier invertier transponier diagonalisier faktorisier orthogonalisier minimier maximier konvergier
    divergier konstruier definier beweis herleit folger vereinfach umform auflös einsetz abschätz abgrenz untersuch analysier
    simulier modellier implementier programmier kompilier interpretier pars tokenisier sortier durchsuch traversier rekursier
    parallelisier synchronisier verschlüssel entschlüssel authentifizier autorisier serialisier deserialisier initialisier
    deklarier instanziier vererb überlad überschreib kapsel abstrahier refaktorier debugg test verifizier validier evaluier
    trainier klassifizier cluster regressier generalisier regularisier quantisier abtast filter mess detektier verstärk
    kopp verschränk präparier rotier spiegel streu emittier absorbier reflektier brech beug überlager
    dekohär relaxier anreg zerfall propagier evolvier entwickl
    """

    // MARK: Eigennamen

    static let names = """
    Gauß Gauss Euler Lagrange Laplace Fourier Hamilton Legendre Cauchy Riemann Lebesgue Hilbert Banach Cantor Dedekind Weierstraß
    Weierstrass Bolzano Jacobi Hesse Taylor Maclaurin Newton Leibniz Bernoulli Fibonacci Pascal Fermat Descartes Euklid Pythagoras
    Archimedes Kepler Galilei Kolmogorow Kolmogorov Markow Markov Bayes Poisson Tschebyscheff Chebyshev Student Pearson Fisher
    Neyman Wilcoxon Kruskal Wallis Shannon Turing Church Gödel Kleene Chomsky Dijkstra Knuth Hoare Floyd Warshall Bellman Ford
    Kruskal Prim Tarjan Huffman Hamming Reed Solomon Lamport Cook Karp Levin Boole Venn Noether Galois Abel Hausdorff Zorn
    Zermelo Fraenkel Peano Frege Russell Whitehead Cohen Kronecker Cayley Sylvester Jordan Lie Killing Cartan Weyl Dirac Kronecker
    Heisenberg Schrödinger Born Bohr Pauli Planck Einstein Maxwell Faraday Ampère Coulomb Lorentz Poynting Boltzmann Gibbs Carnot
    Clausius Kelvin Joule Helmholtz Hubble Schwarzschild Minkowski Feynman Schwinger Tomonaga Yang Mills Higgs Fermi Bose Landau
    Ginzburg Josephson Cooper Bardeen Schrieffer Hall Bloch Brillouin Wigner Dyson Lindblad Kraus Stinespring Choi Jamiołkowski
    Bell Clauser Aspect Zeilinger Shor Grover Deutsch Jozsa Simon Bernstein Vazirani Kitaev Solovay Gottesman Knill Steane
    Calderbank Bennett Brassard Ekert Wootters Zurek Preskill Aharonov Rabi Ramsey Hahn Zeeman Stark Lamb Rydberg Bohr Hartree
    Fock Slater Kohn Sham Hohenberg Born Oppenheimer Trotter Suzuki Hadamard Toffoli Fredkin Clifford Pauli Kronecker Hadamard
    Mandelbrot Julia Lyapunov Poincaré Lorenz Rössler Hénon Feigenbaum Sierpinski Koch Cantor Hilbert Peano Kolmogorov Arnold Moser
    Nash Pareto Bellman Kalman Wiener Itô Black Scholes Merton Monte Carlo Metropolis Hastings Gibbs Ising Potts Heisenberg
    Python Linux Unix Apple Google Microsoft Amazon Intel IBM Nvidia AMD Qualcomm Rigetti IonQ Xanadu Quantinuum Honeywell Alpine
    Wolfram Mathworks Anaconda Github Gitlab Docker Oracle Mozilla Wikipedia Springer Elsevier Wiley IEEE ACM arXiv Zenodo
    """
}
