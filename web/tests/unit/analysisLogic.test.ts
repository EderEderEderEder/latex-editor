import { describe, expect, it } from 'vitest';
import { handleAnalysisRequest } from '../../src/renderer/workers/analysisLogic';

describe('Analyse-Logik', () => {
    it('check liefert Syntaxmeldungen und trägt docId und version', () => {
        const response = handleAnalysisRequest({ kind: 'check', docId: 'a', version: 3, text: 'Text {offen' });
        expect(response).toMatchObject({ kind: 'check', docId: 'a', version: 3 });
        if (response.kind !== 'check') throw new Error('falsche Antwortart');
        expect(response.marks).toHaveLength(1);
        expect(response.marks[0]).toMatchObject({ severity: 'error', start: 5 });
    });

    it('check ohne Fehler liefert keine Meldungen', () => {
        const response = handleAnalysisRequest({ kind: 'check', docId: 'a', version: 1, text: '\\begin{x}\n$a$\n\\end{x}' });
        expect(response).toMatchObject({ kind: 'check', marks: [] });
    });

    it('labels liefert Einträge mit 1-basierter Zeile, ohne Kommentare', () => {
        const text = '\\label{eins}\nText\n% \\label{kommentar}\n\\section{A}\\label{zwei}\n';
        const response = handleAnalysisRequest({ kind: 'labels', docId: 'a', version: 2, text, file: 'main.tex' });
        expect(response).toEqual({
            kind: 'labels',
            docId: 'a',
            version: 2,
            file: 'main.tex',
            entries: [
                { label: 'eins', file: 'main.tex', line: 1 },
                { label: 'zwei', file: 'main.tex', line: 4 },
            ],
        });
    });

    it('duplicates liefert nur mehrfach definierte Labels, sortiert', () => {
        const entries = [
            { label: 'b', file: 'x.tex', line: 5 },
            { label: 'a', file: 'y.tex', line: 2 },
            { label: 'b', file: 'a.tex', line: 9 },
            { label: 'a', file: 'x.tex', line: 1 },
            { label: 'einzeln', file: 'x.tex', line: 7 },
        ];
        const response = handleAnalysisRequest({ kind: 'duplicates', docId: 'projekt', version: 4, entries });
        expect(response).toMatchObject({ kind: 'duplicates', docId: 'projekt', version: 4 });
        if (response.kind !== 'duplicates') throw new Error('falsche Antwortart');
        expect(response.entries.map((entry) => `${entry.label}@${entry.file}:${entry.line}`)).toEqual([
            'a@x.tex:1',
            'a@y.tex:2',
            'b@a.tex:9',
            'b@x.tex:5',
        ]);
    });
});
