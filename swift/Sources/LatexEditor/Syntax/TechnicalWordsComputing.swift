import Foundation

/// Informatik (siehe `TechnicalWords`)
extension TechnicalWords {
    static let computerScience = """
    Informatik Algorithmus Algorithmen Algorithmik Heuristik Pseudocode Ablaufdiagramm Struktogramm Flussdiagramm Programmablaufplan
    Laufzeit Laufzeiten Laufzeitanalyse Zeitkomplexität Speicherkomplexität Platzbedarf Speicherbedarf Aufwand Worstcase Bestcase
    Averagecase Amortisierung Landausymbol Asymptotik Polynomialzeit Exponentialzeit Linearzeit Logarithmisch Quadratisch
    Divide Conquer Teile Herrsche Dynamische Programmierung Memoisierung Greedy Backtracking Brute Force Rekursion Iteration
    Sortieralgorithmus Sortierverfahren Quicksort Mergesort Heapsort Bubblesort Insertionsort Selectionsort Countingsort Radixsort
    Bucketsort Timsort Suchalgorithmus Binärsuche Lineare Tiefensuche Breitensuche Dijkstra Bellman Ford Floyd Warshall Kruskal Prim
    Tarjan Kosaraju Ford Fulkerson Edmonds Karp Dinic Hopcroft Karp Ungarische Methode Astern Suchalgorithmen Heuristiken Minimax
    Alphabeta Pruning Rundreiseproblem Handlungsreisender Rucksackproblem Erfüllbarkeitsproblem Cliquenproblem Färbungsproblem
    Komplexitätsklasse NPvollständig NPschwer Pversus Polynomiale Hierarchie Reduktion Zertifikat Verifizierer Orakelmaschine
    Automat Automaten Endlicher Kellerautomat Zustandsautomat Zustandsmaschine Zustandsübergang Übergangsfunktion Startzustand
    Endzustand Akzeptierender Alphabet Wort Wörter Sprache Sprachen Formale Grammatik Grammatiken Produktion Produktionsregel
    Terminalsymbol Nichtterminalsymbol Startsymbol Ableitungsbaum Syntaxbaum Parsebaum Chomskyhierarchie Kontextfreie Reguläre
    Kontextsensitive Reguläre Ausdrücke Lexer Parser Scanner Token Lexikalische Syntaktische Semantische Analyse Compiler
    Interpreter Übersetzer Assembler Linker Loader Bytecode Maschinencode Zwischencode Zwischendarstellung Codegenerierung
    Optimierung Registerallokation Inlining Schleifenentfaltung Konstantenfaltung Tailrekursion Just in Time Ahead Garbage Collection
    Datenstruktur Datenstrukturen Array Arrays Feld Felder Liste Listen Verkettete Doppelt Stapel Stack Warteschlange Queue Deque
    Prioritätswarteschlange Heap Halde Binärer Fibonacciheap Hashtabelle Hashtabellen Hashfunktion Hashing Kollision Kollisionen
    Verkettung Sondierung Bloomfilter Wörterbuch Dictionary Assoziatives Menge Multimenge Baumstruktur Suchbaum Binärer Suchbaum
    AVLBaum RotSchwarzBaum BBaum BPlusBaum Trie Präfixbaum Segmentbaum Fenwickbaum Intervallbaum Quadtree Oktalbaum KdBaum
    RBaum Skipliste Union Find Tupel Record Struktur Verbund Zeiger Referenz Referenzen Adresse Speicheradresse Knotenobjekt
    Iterator Generator Container Sammlung Collection Bitvektor Bitmaske Bitoperation Bitoperationen Schiebeoperation
    Variable Konstante Literal Bezeichner Deklaration Definition Initialisierung Zuweisung Anweisung Ausdruck Operator Operatoren
    Operand Operanden Priorität Assoziativität Kontrollfluss Verzweigung Schleife Schleifen Bedingung Bedingungen Sprungbefehl
    Funktion Funktionen Prozedur Prozeduren Methode Methoden Konstruktor Destruktor Rückgabewert Übergabeparameter Argument Argumente
    Gültigkeitsbereich Sichtbarkeit Namensraum Namensräume Modul Module Paket Pakete Bibliothek Bibliotheken Schnittstelle
    Schnittstellen Implementierung Implementierungen Abstraktion Kapselung Vererbung Polymorphie Überladung Überschreibung
    Klasse Klassen Objekt Objekte Instanz Instanzen Attribut Attribute Eigenschaft Eigenschaften Basisklasse Oberklasse Unterklasse
    Abstrakte Schnittstellenklasse Trait Mixin Generics Templates Closure Lambdaausdruck Rückruf Callback Delegate Observer
    Entwurfsmuster Singleton Factory Fabrikmethode Adapter Dekorierer Fassade Strategie Iteratormuster Kompositum Proxy Builder
    Prototyp Zustandsmuster Besucher Befehlsmuster Vermittler Memento Vorlagenmethode Dependency Injection Inversion Control
    """

    static let programming = """
    Programmierung Programmiersprache Programmiersprachen Programmierparadigma Paradigma Imperativ Deklarativ Funktional Objektorientiert
    Prozedural Logisch Skriptsprache Hochsprache Maschinensprache Assemblersprache Quelltext Quellcode Programmcode Codezeile
    Syntax Semantik Typsystem Typinferenz Typisierung Typprüfung Statisch Dynamisch Starke Schwache Datentyp Datentypen Basisdatentyp
    Ganzzahl Gleitkommazahl Zeichenkette Zeichenketten Zeichen Wahrheitswert Boolean Integer Float Double String Char Byte Bit
    Aufzählungstyp Enumeration Union Option Optional Nullwert Nullzeiger Zeigerarithmetik Speicherverwaltung Heapspeicher Stapelspeicher
    Speicherleck Speicherzugriff Pufferüberlauf Pufferüberläufe Segmentierungsfehler Referenzzählung Besitzverhältnis Lebensdauer
    Ausnahme Ausnahmen Ausnahmebehandlung Fehlerbehandlung Exception Assertion Vorbedingung Nachbedingung Invariante Invarianten
    Testen Unittest Komponententest Integrationstest Systemtest Abnahmetest Regressionstest Testabdeckung Codeabdeckung Testfall
    Testfälle Testgetriebene Mocking Stub Fixture Testdaten Fuzzing Debugging Debugger Haltepunkt Breakpoint Stacktrace Logging
    Protokollierung Profiling Profiler Benchmark Benchmarks Laufzeitumgebung Virtuelle Maschine Runtime Bibliothek Standardbibliothek
    Compileroption Compilerflag Makro Präprozessor Header Headerdatei Quelldatei Objektdatei Bauprozess Build Buildsystem Makefile
    Abhängigkeit Abhängigkeiten Paketmanager Versionierung Semantische Versionsnummer Release Patch Hotfix
    Python Java JavaScript TypeScript Kotlin Swift Rust Golang Haskell Scala Clojure Erlang Elixir Lisp Scheme Prolog Fortran Cobol Pascal
    Ada Perl Ruby PHP Lua Julia Matlab Octave Mathematica Maple Sage SymPy NumPy SciPy Pandas Matplotlib Jupyter Notebook PyTorch
    TensorFlow Keras Scikit Qiskit Cirq Pennylane Braket Quipper Silq OpenQASM QASM Quil Bash Zsh Shell Skript Skripte Powershell
    LaTeX TeX BibTeX Biber Markdown HTML CSS XML JSON YAML TOML CSV SVG PDF UTF ASCII Unicode Zeichenkodierung Kodierung
    GitHub GitLab Bitbucket Repository Repositories Branch Branches Commit Commits Merge Rebase Pullrequest Fork Clone Tag
    Docker Container Kubernetes Image Images Pipeline Pipelines Jenkins Terraform Ansible Vagrant Homebrew Xcode Eclipse IntelliJ
    VSCode Vim Emacs Linter Formatter Transpiler Bundler Webpack Maven Gradle Cargo Npm Pip Conda Virtualenv Makefile
    """

    static let systems = """
    Betriebssystem Betriebssysteme Kernel Kernelmodus Benutzermodus Systemaufruf Systemaufrufe Treiber Gerätetreiber Dateisystem
    Dateisysteme Datei Dateien Verzeichnis Verzeichnisse Inode Berechtigung Berechtigungen Prozess Prozesse Thread Threads
    Nebenläufigkeit Parallelität Parallelverarbeitung Gleichzeitigkeit Synchronisation Mutex Semaphor Monitor Deadlock Verklemmung
    Livelock Race Condition Wettlaufsituation Atomare Sperre Sperren Sperrmechanismus Lockfrei Warteschlange Scheduler Scheduling
    Zeitscheibe Prioritätsinversion Kontextwechsel Unterbrechung Interrupt Interruptbehandlung Speicherverwaltung Paging Seite
    Seitentabelle Seitenfehler Segmentierung Virtueller Speicher Adressraum Adressübersetzung Cache Caches Cachekohärenz Pufferspeicher
    Arbeitsspeicher Hauptspeicher Festplatte Massenspeicher Flashspeicher Solidstate Registersatz Befehlssatz Befehlsarchitektur
    Mikroarchitektur Prozessor Prozessoren Prozessorkern Mehrkernprozessor Grafikprozessor Coprozessor Pipeline Pipelining
    Superskalar Sprungvorhersage Spekulative Ausführung Out Order Hyperthreading Taktfrequenz Taktzyklus Takt Taktrate Bus Busse
    Chipsatz Hauptplatine Mainboard Firmware Bootloader Bootvorgang Hypervisor Virtualisierung Containerisierung Emulation
    Emulator Simulator Echtzeitsystem Echtzeit Eingebettetes System Mikrocontroller Mikrocontroller FPGA ASIC SoC Einplatinencomputer
    Raspberry Arduino Linux Unix Windows macOS Android iOS Ubuntu Debian Fedora Darwin POSIX
    Verteiltes System Verteilte Systeme Cluster Rechencluster Knoten Skalierbarkeit Skalierung Lastverteilung Lastverteiler Replikation
    Konsistenzmodell Konsens Paxos Raft Byzantinische Fehlertoleranz Fehlertoleranz Ausfallsicherheit Verfügbarkeit Latenz Durchsatz
    Bandbreite Wartezeit Antwortzeit Microservice Microservices Monolith Serverless Cloud Cloudcomputing Rechenzentrum Edgecomputing
    Hochleistungsrechnen Supercomputer MapReduce Hadoop Spark Message Queue Nachrichtenwarteschlange Publish Subscribe Eventsourcing
    Parallelrechner Gleitkommaeinheit Vektorisierung SIMD Multithreading OpenMP MPI CUDA OpenCL Shader Rechenkern Speicherhierarchie
    """

    static let networksAndSecurity = """
    Netzwerk Netzwerke Rechnernetz Rechnernetze Netzwerkprotokoll Protokoll Protokolle Protokollstapel Schichtenmodell Referenzmodell
    Paket Pakete Paketvermittlung Leitungsvermittlung Router Switch Gateway Firewall Proxy Server Client Peer Hostname Domain
    IPAdresse IPv Subnetz Subnetzmaske Routing Routingtabelle Weiterleitung Ethernet WLAN WiFi Bluetooth Mobilfunk Glasfaser
    TCP UDP IP ICMP ARP DHCP DNS HTTP HTTPS FTP SSH TLS SSL SMTP IMAP POP WebSocket REST SOAP GraphQL RPC gRPC API APIs Endpunkt
    Anfrage Antwort Statuscode Header Cookie Sitzung Authentifizierung Autorisierung Token OAuth Single SignOn Zertifikat Zertifikate
    Zertifizierungsstelle Handshake Verbindungsaufbau Flusskontrolle Staukontrolle Überlastkontrolle Fenstergröße Quittung
    Verschlüsselung Entschlüsselung Chiffre Chiffrat Klartext Geheimtext Schlüssel Schlüsselaustausch Schlüsselverwaltung Schlüssellänge
    Kryptografie Kryptographie Kryptoanalyse Kryptosystem Symmetrisch Asymmetrisch Publickey Privatschlüssel Öffentlicher Signatur
    Digitale Signaturen Hashfunktion Kryptografische Prüfsumme Nachrichtenauthentifizierung Zufallsorakel Einwegfunktion
    Falltürfunktion Blockchiffre Stromchiffre Betriebsmodus AES DES RSA ECC Diffie Hellman ElGamal Elliptische Kurven SHA MD
    HMAC PBKDF Bcrypt Argon Scrypt Salt Pepper Rainbowtable Wörterbuchangriff Brute Force Seitenkanalangriff Zeitangriff
    Postquantenkryptografie Quantenkryptografie Quantenschlüsselverteilung BB Schlüsselverteilung Gitterbasierte Codebasierte
    Hashbasierte Kyber Dilithium Falcon Sphincs Kryptoagilität Blockchain Kryptowährung Bitcoin Ethereum Smart Contract Konsens
    Proof Work Stake Mining Wallet Ledger Merkle Baum Nullwissensbeweis Zero Knowledge Homomorphe Verschlüsselung Mehrparteienberechnung
    Sicherheit Sicherheitslücke Schwachstelle Schwachstellen Angriff Angriffe Angreifer Bedrohung Bedrohungsmodell Risiko Risikoanalyse
    Penetrationstest Exploit Malware Virus Trojaner Ransomware Phishing Spoofing Man Middle Replay Injection Cross Site Scripting
    Denial Service Botnetz Sandbox Härtung Patchmanagement Zugriffskontrolle Rollen Rechtevergabe Datenschutz Integrität
    Vertraulichkeit Verfügbarkeit Authentizität Nichtabstreitbarkeit Anonymität Pseudonymisierung Datenschutzgrundverordnung DSGVO
    Zwei Faktor Passwort Passwörter Biometrie Intrusion Detection Honeypot Firewalls VPN Tunnel Tor Onion
    """

    static let dataAndAI = """
    Datenbank Datenbanken Datenbanksystem Datenbankmanagementsystem Datenbankschema Tabelle Tabellen Spalte Spalten Zeile Zeilen
    Tupel Attribut Schlüssel Primärschlüssel Fremdschlüssel Index Indizes Relationale Algebra Relationenmodell Normalform
    Normalisierung Denormalisierung Transaktion Transaktionen Atomarität Konsistenz Isolation Dauerhaftigkeit ACID BASE CAP Theorem
    Abfrage Abfragen Abfragesprache Abfrageoptimierung Ausführungsplan SQL NoSQL NewSQL MySQL PostgreSQL SQLite MariaDB Oracle MongoDB
    Redis Cassandra Neo Graphdatenbank Dokumentdatenbank Schlüsselwert Spaltenorientiert Data Warehouse Data Lake ETL OLAP OLTP
    Join Verbund Selektion Projektion Gruppierung Aggregation Aggregatfunktion Sicht Trigger Gespeicherte Prozedur Cursor Sperre
    Datenmodell Datenmodellierung Entity Relationship Diagramm Klassendiagramm Sequenzdiagramm Aktivitätsdiagramm Anwendungsfalldiagramm
    UML Datenintegrität Datenqualität Datenbereinigung Datenaufbereitung Vorverarbeitung Merkmalsextraktion Feature Features
    Merkmalsvektor Dimensionsreduktion Hauptkomponentenanalyse Skalierung Normierung Standardisierung Datensatz Datensätze Trainingsdaten
    Testdaten Validierungsdaten Stichprobe Annotation Label Labels Beschriftung Ausreißererkennung Imputation Fehlende Werte
    Maschinelles Lernen Maschinenlernen Überwachtes Unüberwachtes Bestärkendes Selbstüberwachtes Halbüberwachtes Transferlernen
    Federated Learning Deep Learning Tiefes Lernen Künstliche Intelligenz KI Neuronales Netz Neuronale Netze Neuron Neuronen
    Perzeptron Mehrschichtperzeptron Aktivierungsfunktion Sigmoid ReLU Softmax Tanh Schicht Schichten Eingabeschicht Ausgabeschicht
    Verdeckte Gewichte Gewichtsmatrix Bias Verlustfunktion Kostenfunktion Fehlerfunktion Backpropagation Rückpropagation
    Gradientenabstieg Stochastischer Lernrate Epoche Epochen Batch Minibatch Momentum Adam Optimierer Regularisierung Dropout
    Batchnormalisierung Überanpassung Unteranpassung Overfitting Underfitting Generalisierung Bias Varianz Kompromiss Hyperparameter
    Hyperparameteroptimierung Gittersuche Kreuzvalidierung Konfusionsmatrix Genauigkeit Präzision Trefferquote Recall F Maß ROC
    AUC Klassifikation Klassifikator Klassifikatoren Regression Clustering Cluster Clusteranalyse Kmeans Hierarchisches
    Dichtebasiert Entscheidungsbaum Entscheidungsbäume Zufallswald Random Forest Boosting Bagging Gradient Boosting XGBoost
    Stützvektormaschine Kernel Kernelfunktion Kerneltrick Naive Bayes Nächste Nachbarn Perzeptronen Faltungsnetz Faltungsschicht
    Pooling Rekurrentes Netz LSTM GRU Transformer Aufmerksamkeit Selbstaufmerksamkeit Encoder Decoder Embedding Einbettung
    Tokenisierung Sprachmodell Sprachmodelle Großes Sprachmodell Prompt Prompting Feinabstimmung Vortraining Halluzination
    Generative Adversarial Netze Autoencoder Variational Diffusionsmodell Reinforcement Agent Umgebung Belohnung Policy Wertfunktion
    QLearning Exploration Exploitation Markow Entscheidungsprozess Expertensystem Wissensbasis Ontologie Semantisches Web
    Inferenz Schlussfolgerung Bayessches Netz Hidden Markov Modell Kalmanfilter Partikelfilter Computer Vision Bildverarbeitung
    Objekterkennung Segmentierung Spracherkennung Sprachverarbeitung Textklassifikation Maschinelle Übersetzung Erklärbarkeit
    Interpretierbarkeit Fairness Datenschutzfreundlich Quantenmaschinelles Lernen Variationaler Quantenalgorithmus Quantenkernel
    """

    static let softwareEngineering = """
    Softwareentwicklung Softwaretechnik Softwarearchitektur Architektur Architekturmuster Schichtenarchitektur Komponente Komponenten
    Anforderung Anforderungen Anforderungsanalyse Lastenheft Pflichtenheft Spezifikation Entwurf Implementierung Wartung Refactoring
    Codequalität Codereview Clean Code Technische Schulden Dokumentation Kommentar Kommentare Versionsverwaltung Versionskontrolle
    Konfigurationsmanagement Änderungsmanagement Releasemanagement Vorgehensmodell Wasserfallmodell Vmodell Spiralmodell Agil Scrum
    Kanban Sprint Backlog Userstory Epic Stakeholder Product Owner Retrospektive Daily Standup Extreme Programming Pair Programming
    Continuous Integration Continuous Delivery Deployment DevOps Staging Produktionsumgebung Entwicklungsumgebung Testumgebung
    Monitoring Alarmierung Observability Telemetrie Metriken Skalierung Lasttest Stresstest Belastungstest Performancetest
    Usability Benutzerfreundlichkeit Benutzeroberfläche Benutzerschnittstelle Benutzererlebnis Barrierefreiheit Frontend Backend
    Fullstack Webanwendung Webseite Webserver Browser Framework Frameworks Plugin Plugins Erweiterung Erweiterungen Konfiguration
    Konfigurationsdatei Umgebungsvariable Umgebungsvariablen Lizenz Lizenzen Opensource Quelloffen Freie Software Urheberrecht
    Softwarequalität Wartbarkeit Zuverlässigkeit Effizienz Portabilität Modularität Kohäsion Kopplung Testbarkeit Erweiterbarkeit
    Metrik Zyklomatische Komplexität Reifegrad Prozessmodell Projektmanagement Meilenstein Aufwandsschätzung Risikomanagement
    """
}
