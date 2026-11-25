| Variante | wortgenau (≤ 1,5 pt) | visuell (≤ 3 pt) | Rückfall wie Swift | daneben | ms/Seite Mittel | ms/Seite max | davon getTextContent | Summe aller Seiten min–max | Zuordnen aller Markierungen |
|---|---|---|---|---|---|---|---|---|---|
| textLayer | 26/39 (67 %) | 6 | 1 | 8 | 2.28 | 7.90 | 0.71 | 30–74 | 2.00 |
| uniform | 16/39 (41 %) | 10 | 1 | 14 | 0.55 | 1.90 | 0.48 | 8–12 | 1.30 |
| fontMetrics | 33/39 (85 %) | 6 | 1 | 1 | 0.81 | 2.70 | 0.48 | 12–44 | 1.20 |
| fontSpaces | 34/39 (87 %) | 5 | 1 | 1 | 0.75 | 2.60 | 0.47 | 11–17 | 1.20 |

### textLayer

| Id | Fall | PDFKit | pdf.js | Δ Anfang pt | Δ Ende pt | Urteil | Grund |
|---|---|---|---|---|---|---|---|
| t01 | Ligatur | words | words | 0.56 | 1.20 | wortgenau |  |
| t02 | Ligatur | words | words | 0.51 | 0.75 | wortgenau |  |
| t03 | Ligatur | words | words | 1.10 | 1.00 | wortgenau |  |
| t04 | Ligatur | words | words | 0.15 | 3.22 | daneben | Rand 3.2 pt daneben |
| t05 | Umlaute | words | words | 3.15 | 0.25 | daneben | Rand 3.2 pt daneben |
| t06 | Umbruch | words | words | 1.27 | 1.87 | visuell | Rand 1.9 pt daneben |
| t07 | Umbruch | words | words | 0.11 | 0.00 | wortgenau |  |
| t08 | mehrzeilig | words | words | 0.19 | 1.76 | visuell | Rand 1.8 pt daneben |
| t09 | Fließtext | words | words | 3.12 | 0.95 | daneben | Rand 3.1 pt daneben |
| t10 | Fließtext | words | words | 0.50 | 0.97 | wortgenau |  |
| t11 | Fließtext | words | words | 0.15 | 0.69 | wortgenau |  |
| t12 | Mathe im Text | words | words | 0.20 | 1.53 | visuell | Rand 1.5 pt daneben |
| t13 | Mathe im Text | words | words | 0.15 | 0.20 | wortgenau |  |
| t14 | Umbruch | lines | words | 2.06 | 242.12 | daneben | pdf.js fand Wörter, PDFKit nicht |
| t15 | Mathe abgesetzt | words | words | 0.30 | 1.81 | visuell | Rand 1.8 pt daneben |
| t16 | nach Formel | words | words | 0.15 | 0.22 | wortgenau |  |
| t17 | Silbentrennung | words | words | 0.15 | 0.26 | wortgenau |  |
| t18 | Silbentrennung | words | words | 0.15 | 0.05 | wortgenau |  |
| t19 | Silbentrennung | words | words | 0.21 | 0.22 | wortgenau |  |
| t20 | schmale Spalte | words | words | 0.15 | 0.18 | wortgenau |  |
| t21 | Fußnote | words | words | 1.90 | 1.59 | visuell | Rand 1.9 pt daneben |
| t22 | Fußnote | lines | lines | 0.15 | 0.18 | Rückfall wie Swift |  |
| t23 | Auszeichnung | words | words | 0.47 | 0.32 | wortgenau |  |
| t24 | Satzzeichen | words | words | 0.05 | 3.10 | daneben | Rand 3.1 pt daneben |
| t25 | Umbruch | words | words | 3.76 | 0.25 | daneben | Rand 3.8 pt daneben |
| t26 | Tabelle | words | words | 0.15 | 0.34 | wortgenau |  |
| t27 | Tabelle | words | words | 0.15 | 0.32 | wortgenau |  |
| t28 | Tabelle | words | words | 0.15 | 0.32 | wortgenau |  |
| t29 | Liste | words | words | 4.88 | 2.69 | daneben | Rand 4.9 pt daneben |
| t30 | Überschrift | words | words | 0.15 | 0.15 | wortgenau |  |
| h01 | Auszeichnung | words | words | 0.15 | 0.25 | wortgenau |  |
| h02 | mehrzeilig | words | words | 1.35 | 0.07 | wortgenau |  |
| h03 | Zitat | words | words | 4.50 | 2.82 | daneben | Rand 4.5 pt daneben |
| h04 | Bindestrich | words | words | 0.08 | 0.41 | wortgenau |  |
| h05 | TeX-Logo | words | words | 0.15 | 1.38 | wortgenau |  |
| h06 | nach Formel | words | words | 0.26 | 1.31 | wortgenau |  |
| h07 | Zitat | words | words | 1.54 | 2.92 | visuell | Rand 2.9 pt daneben |
| h08 | Verweis | words | words | 0.47 | 0.24 | wortgenau |  |
| h09 | Tabelle | words | words | 0.25 | 0.36 | wortgenau |  |
| h10 | Silbentrennung | words | words | 0.52 | 0.10 | wortgenau |  |
| h11 | Silbentrennung | words | words | 1.17 | 1.02 | wortgenau |  |

### uniform

| Id | Fall | PDFKit | pdf.js | Δ Anfang pt | Δ Ende pt | Urteil | Grund |
|---|---|---|---|---|---|---|---|
| t01 | Ligatur | words | words | 1.92 | 1.78 | visuell | Rand 1.9 pt daneben |
| t02 | Ligatur | words | words | 0.09 | 0.00 | wortgenau |  |
| t03 | Ligatur | words | words | 3.57 | 4.49 | daneben | Rand 4.5 pt daneben |
| t04 | Ligatur | words | words | 0.00 | 0.02 | wortgenau |  |
| t05 | Umlaute | words | words | 8.54 | 3.67 | daneben | Rand 8.5 pt daneben |
| t06 | Umbruch | words | words | 1.50 | 5.34 | daneben | Rand 5.3 pt daneben |
| t07 | Umbruch | words | words | 0.00 | 1.84 | visuell | Rand 1.8 pt daneben |
| t08 | mehrzeilig | words | words | 8.86 | 1.49 | daneben | Rand 8.9 pt daneben |
| t09 | Fließtext | words | words | 5.24 | 6.61 | daneben | Rand 6.6 pt daneben |
| t10 | Fließtext | words | words | 0.79 | 1.24 | wortgenau |  |
| t11 | Fließtext | words | words | 0.00 | 1.81 | visuell | Rand 1.8 pt daneben |
| t12 | Mathe im Text | words | words | 0.00 | 3.97 | daneben | Rand 4.0 pt daneben |
| t13 | Mathe im Text | words | words | 0.00 | 0.00 | wortgenau |  |
| t14 | Umbruch | lines | words | 5.13 | 238.75 | daneben | pdf.js fand Wörter, PDFKit nicht |
| t15 | Mathe abgesetzt | words | words | 0.00 | 1.52 | visuell | Rand 1.5 pt daneben |
| t16 | nach Formel | words | words | 0.00 | 5.71 | daneben | Rand 5.7 pt daneben |
| t17 | Silbentrennung | words | words | 0.00 | 0.00 | wortgenau |  |
| t18 | Silbentrennung | words | words | 0.00 | 1.89 | visuell | Rand 1.9 pt daneben |
| t19 | Silbentrennung | words | words | 0.00 | 0.00 | wortgenau |  |
| t20 | schmale Spalte | words | words | 0.00 | 1.63 | visuell | Rand 1.6 pt daneben |
| t21 | Fußnote | words | words | 3.18 | 1.67 | daneben | Rand 3.2 pt daneben |
| t22 | Fußnote | lines | lines | 0.00 | 1.76 | Rückfall wie Swift |  |
| t23 | Auszeichnung | words | words | 0.00 | 0.00 | wortgenau |  |
| t24 | Satzzeichen | words | words | 1.15 | 1.24 | wortgenau |  |
| t25 | Umbruch | words | words | 0.13 | 12.37 | daneben | Rand 12.4 pt daneben |
| t26 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t27 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t28 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t29 | Liste | words | words | 4.71 | 2.53 | daneben | Rand 4.7 pt daneben |
| t30 | Überschrift | words | words | 0.00 | 0.00 | wortgenau |  |
| h01 | Auszeichnung | words | words | 0.00 | 0.00 | wortgenau |  |
| h02 | mehrzeilig | words | words | 6.78 | 1.83 | daneben | Rand 6.8 pt daneben |
| h03 | Zitat | words | words | 1.19 | 0.61 | wortgenau |  |
| h04 | Bindestrich | words | words | 1.16 | 1.66 | visuell | Rand 1.7 pt daneben |
| h05 | TeX-Logo | words | words | 0.00 | 2.21 | visuell | Rand 2.2 pt daneben |
| h06 | nach Formel | words | words | 0.00 | 2.24 | visuell | Rand 2.2 pt daneben |
| h07 | Zitat | words | words | 2.37 | 2.09 | visuell | Rand 2.4 pt daneben |
| h08 | Verweis | words | words | 0.43 | 4.95 | daneben | Rand 5.0 pt daneben |
| h09 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| h10 | Silbentrennung | words | words | 0.30 | 1.33 | wortgenau |  |
| h11 | Silbentrennung | words | words | 1.34 | 5.30 | daneben | Rand 5.3 pt daneben |

### fontMetrics
fontMetrics: 2702 Stücke gemessen, 385 ohne Schrift; Breitenverhältnis Median 0.984, 1323 Stücke > 2 % daneben

| Id | Fall | PDFKit | pdf.js | Δ Anfang pt | Δ Ende pt | Urteil | Grund |
|---|---|---|---|---|---|---|---|
| t01 | Ligatur | words | words | 0.55 | 0.76 | wortgenau |  |
| t02 | Ligatur | words | words | 0.67 | 0.00 | wortgenau |  |
| t03 | Ligatur | words | words | 2.06 | 0.32 | visuell | Rand 2.1 pt daneben |
| t04 | Ligatur | words | words | 0.00 | 0.89 | wortgenau |  |
| t05 | Umlaute | words | words | 0.51 | 1.18 | wortgenau |  |
| t06 | Umbruch | words | words | 2.27 | 0.82 | visuell | Rand 2.3 pt daneben |
| t07 | Umbruch | words | words | 0.00 | 0.05 | wortgenau |  |
| t08 | mehrzeilig | words | words | 0.78 | 0.11 | wortgenau |  |
| t09 | Fließtext | words | words | 0.40 | 0.57 | wortgenau |  |
| t10 | Fließtext | words | words | 0.87 | 0.06 | wortgenau |  |
| t11 | Fließtext | words | words | 0.00 | 0.08 | wortgenau |  |
| t12 | Mathe im Text | words | words | 0.00 | 0.48 | wortgenau |  |
| t13 | Mathe im Text | words | words | 0.00 | 0.00 | wortgenau |  |
| t14 | Umbruch | lines | words | 0.30 | 241.11 | daneben | pdf.js fand Wörter, PDFKit nicht |
| t15 | Mathe abgesetzt | words | words | 0.00 | 1.52 | visuell | Rand 1.5 pt daneben |
| t16 | nach Formel | words | words | 0.00 | 1.04 | wortgenau |  |
| t17 | Silbentrennung | words | words | 0.00 | 0.00 | wortgenau |  |
| t18 | Silbentrennung | words | words | 0.00 | 0.02 | wortgenau |  |
| t19 | Silbentrennung | words | words | 0.00 | 0.00 | wortgenau |  |
| t20 | schmale Spalte | words | words | 0.00 | 0.01 | wortgenau |  |
| t21 | Fußnote | words | words | 1.10 | 0.70 | wortgenau |  |
| t22 | Fußnote | lines | lines | 0.00 | 0.04 | Rückfall wie Swift |  |
| t23 | Auszeichnung | words | words | 0.00 | 0.00 | wortgenau |  |
| t24 | Satzzeichen | words | words | 0.68 | 0.53 | wortgenau |  |
| t25 | Umbruch | words | words | 1.34 | 0.91 | wortgenau |  |
| t26 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t27 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t28 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t29 | Liste | words | words | 0.67 | 0.47 | wortgenau |  |
| t30 | Überschrift | words | words | 0.00 | 0.00 | wortgenau |  |
| h01 | Auszeichnung | words | words | 0.00 | 0.00 | wortgenau |  |
| h02 | mehrzeilig | words | words | 0.25 | 0.04 | wortgenau |  |
| h03 | Zitat | words | words | 0.40 | 0.34 | wortgenau |  |
| h04 | Bindestrich | words | words | 1.10 | 0.57 | wortgenau |  |
| h05 | TeX-Logo | words | words | 0.00 | 2.30 | visuell | Rand 2.3 pt daneben |
| h06 | nach Formel | words | words | 0.00 | 0.43 | wortgenau |  |
| h07 | Zitat | words | words | 1.46 | 0.68 | wortgenau |  |
| h08 | Verweis | words | words | 0.28 | 0.51 | wortgenau |  |
| h09 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| h10 | Silbentrennung | words | words | 2.09 | 0.04 | visuell | Rand 2.1 pt daneben |
| h11 | Silbentrennung | words | words | 0.13 | 1.74 | visuell | Rand 1.7 pt daneben |

### fontSpaces

| Id | Fall | PDFKit | pdf.js | Δ Anfang pt | Δ Ende pt | Urteil | Grund |
|---|---|---|---|---|---|---|---|
| t01 | Ligatur | words | words | 0.22 | 0.56 | wortgenau |  |
| t02 | Ligatur | words | words | 0.10 | 0.00 | wortgenau |  |
| t03 | Ligatur | words | words | 0.57 | 0.00 | wortgenau |  |
| t04 | Ligatur | words | words | 0.00 | 0.67 | wortgenau |  |
| t05 | Umlaute | words | words | 0.03 | 0.05 | wortgenau |  |
| t06 | Umbruch | words | words | 0.96 | 0.03 | wortgenau |  |
| t07 | Umbruch | words | words | 0.00 | 0.01 | wortgenau |  |
| t08 | mehrzeilig | words | words | 0.60 | 0.04 | wortgenau |  |
| t09 | Fließtext | words | words | 0.16 | 0.11 | wortgenau |  |
| t10 | Fließtext | words | words | 0.22 | 0.15 | wortgenau |  |
| t11 | Fließtext | words | words | 0.00 | 0.01 | wortgenau |  |
| t12 | Mathe im Text | words | words | 0.00 | 0.85 | wortgenau |  |
| t13 | Mathe im Text | words | words | 0.00 | 0.00 | wortgenau |  |
| t14 | Umbruch | lines | words | 0.60 | 241.01 | daneben | pdf.js fand Wörter, PDFKit nicht |
| t15 | Mathe abgesetzt | words | words | 0.00 | 1.52 | visuell | Rand 1.5 pt daneben |
| t16 | nach Formel | words | words | 0.00 | 0.74 | wortgenau |  |
| t17 | Silbentrennung | words | words | 0.00 | 0.00 | wortgenau |  |
| t18 | Silbentrennung | words | words | 0.00 | 0.02 | wortgenau |  |
| t19 | Silbentrennung | words | words | 0.00 | 0.00 | wortgenau |  |
| t20 | schmale Spalte | words | words | 0.00 | 0.01 | wortgenau |  |
| t21 | Fußnote | words | words | 0.02 | 0.22 | wortgenau |  |
| t22 | Fußnote | lines | lines | 0.00 | 0.00 | Rückfall wie Swift |  |
| t23 | Auszeichnung | words | words | 0.00 | 0.00 | wortgenau |  |
| t24 | Satzzeichen | words | words | 0.65 | 1.62 | visuell | Rand 1.6 pt daneben |
| t25 | Umbruch | words | words | 1.65 | 0.17 | visuell | Rand 1.7 pt daneben |
| t26 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t27 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t28 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| t29 | Liste | words | words | 1.72 | 1.63 | visuell | Rand 1.7 pt daneben |
| t30 | Überschrift | words | words | 0.00 | 0.00 | wortgenau |  |
| h01 | Auszeichnung | words | words | 0.00 | 0.00 | wortgenau |  |
| h02 | mehrzeilig | words | words | 0.40 | 0.00 | wortgenau |  |
| h03 | Zitat | words | words | 0.05 | 0.49 | wortgenau |  |
| h04 | Bindestrich | words | words | 0.77 | 0.31 | wortgenau |  |
| h05 | TeX-Logo | words | words | 0.00 | 1.42 | wortgenau |  |
| h06 | nach Formel | words | words | 0.00 | 0.20 | wortgenau |  |
| h07 | Zitat | words | words | 0.08 | 0.40 | wortgenau |  |
| h08 | Verweis | words | words | 0.18 | 0.45 | wortgenau |  |
| h09 | Tabelle | words | words | 0.00 | 0.00 | wortgenau |  |
| h10 | Silbentrennung | words | words | 1.88 | 0.00 | visuell | Rand 1.9 pt daneben |
| h11 | Silbentrennung | words | words | 0.20 | 0.18 | wortgenau |  |
