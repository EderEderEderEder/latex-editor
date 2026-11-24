import { describe, expect, it } from 'vitest';
import { LINE_INPUT_TEXTS, parseLineInput } from '../../src/renderer/app/lineInput';

describe('parseLineInput', () => {
    it('Zeilennummer', () => {
        expect(parseLineInput('12', 100)).toEqual({ ok: true, line: 12 });
        expect(parseLineInput('  7 ', 100)).toEqual({ ok: true, line: 7 });
        expect(parseLineInput('100', 100)).toEqual({ ok: true, line: 100 });
        expect(parseLineInput('1', 1)).toEqual({ ok: true, line: 1 });
    });

    it('Zeile:Spalte', () => {
        expect(parseLineInput('12:5', 100)).toEqual({ ok: true, line: 12, column: 5 });
    });

    it('leer', () => {
        expect(parseLineInput('', 10)).toEqual({ ok: false, error: LINE_INPUT_TEXTS.empty });
        expect(parseLineInput('   ', 10)).toEqual({ ok: false, error: LINE_INPUT_TEXTS.empty });
    });

    it('Text und Formfehler', () => {
        for (const text of ['abc', '12a', '-3', '1.5', '12:', ':5', '12:x', '1:2:3', '１２']) {
            expect(parseLineInput(text, 100), text).toEqual({ ok: false, error: LINE_INPUT_TEXTS.invalid });
        }
    });

    it('außerhalb des Bereichs', () => {
        const error = LINE_INPUT_TEXTS.outOfRange(100);
        expect(parseLineInput('0', 100)).toEqual({ ok: false, error });
        expect(parseLineInput('101', 100)).toEqual({ ok: false, error });
        expect(parseLineInput('99999999999999999999', 100)).toEqual({ ok: false, error });
        expect(parseLineInput('1', 0)).toEqual({ ok: false, error: LINE_INPUT_TEXTS.outOfRange(0) });
    });

    it('Spalte 0 ist ungültig', () => {
        expect(parseLineInput('3:0', 10)).toEqual({ ok: false, error: LINE_INPUT_TEXTS.columnInvalid });
    });
});
