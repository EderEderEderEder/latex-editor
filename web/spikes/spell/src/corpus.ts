// Testwörter für Spike S8: Zusammensetzungen (richtig und falsch) und Einzelfälle.

/** Richtig geschriebene Zusammensetzungen aus Abschlussarbeiten (sollen alle durchgehen) */
export const VALID_COMPOUNDS: readonly string[] = [
    'Rechtschreibprüfung', 'Literaturverwaltung', 'Zeitschriftenaufsatz', 'Hochschulbibliothek', 'Softwareentwicklung',
    'Datenbankabfrage', 'Benutzeroberfläche', 'Arbeitsspeicher', 'Universitätsbibliothek', 'Fehlermeldung',
    'Abschlussarbeit', 'Quellcodeverwaltung', 'Tastaturkürzel', 'Textsatzsystem', 'Bachelorarbeit',
    'Versionsverwaltung', 'Forschungsfrage', 'Literaturverzeichnis', 'Abbildungsverzeichnis', 'Messergebnisse',
    'Entwicklungsumgebung', 'Anwendungsfall', 'Programmiersprache', 'Betriebssystem', 'Dateisystem',
    'Schreibtischlampe', 'Kundenzufriedenheitsumfrage', 'Speicherverbrauch', 'Ladezeit', 'Netzwerkzugriff',
];

/** Tippfehler in Zusammensetzungen (sollen alle gemeldet werden) */
export const INVALID_COMPOUNDS: readonly string[] = [
    'Rechtschreibprüfnug', 'Literaturverwaltnug', 'Fehlermeldnug', 'Hochschulbiblothek', 'Softwareentwiklung',
    'Datenbankabfarge', 'Benutzeroberfäche', 'Arbietsspeicher', 'Abschlusarbeit', 'Tastaturkürzle',
];

/** Einzelfälle: Satzanfang, ß/Umlaute, Abkürzungen, Fremdwörter, österreichische Formen */
export const SINGLE_WORDS: readonly string[] = [
    'Die', 'größere', 'Fließtext', 'Straße', 'Jänner', 'heuer', 'Matura', 'Paradeiser', 'Gleichung', 'abgesetzt',
    'Aufzählungen', 'Software', 'Interface', 'Laptop', 'Mail', 'Bachelor', 'Masterarbeit', 'Rechtschreibfeler',
];

/** Wörter für die Vorschlags-Messung (`suggest` ist teuer, nur auf Anforderung) */
export const SUGGEST_WORDS: readonly string[] = ['Rechtschreibfeler', 'Gleichnug', 'Tipfehler', 'Literatr', 'Abbildnug'];
