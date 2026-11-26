import { resizeTable, type TableSettings } from './tableModel';

const TAB = '\t';
const LINE_FEED = '\n';
const QUOTE = '"';

/** Zustandsautomat für Text aus Excel/Numbers: Tab trennt Zellen, `\n` Zeilen, `"…"` schützt Tabs und Umbrüche */
class TabSeparatedReader {
    private readonly rows: string[][] = [];
    private row: string[] = [];
    private field = '';
    private isQuoted = false;

    constructor(private readonly input: string) {}

    read(): string[][] {
        for (let index = 0; index < this.input.length; index += 1) {
            index += this.consume(this.input.charAt(index), this.input.charAt(index + 1));
        }
        if (this.field !== '' || this.row.length > 0) this.endRow();
        while (this.rows.length > 0 && this.rows[this.rows.length - 1]!.every((cell) => cell === '')) this.rows.pop();
        return this.rows;
    }

    /** Liefert die Zahl der zusätzlich verbrauchten Zeichen (1 bei `""` in einer Anführungs-Zelle) */
    private consume(character: string, next: string): number {
        if (this.isQuoted) return this.consumeQuoted(character, next);
        if (character === QUOTE && this.field === '') this.isQuoted = true;
        else if (character === TAB) this.endField();
        else if (character === LINE_FEED) this.endRow();
        else this.field += character;
        return 0;
    }

    private consumeQuoted(character: string, next: string): number {
        if (character !== QUOTE) this.field += character;
        else if (next === QUOTE) this.field += QUOTE;
        else this.isQuoted = false;
        return character === QUOTE && next === QUOTE ? 1 : 0;
    }

    private endField(): void {
        this.row.push(this.field);
        this.field = '';
    }

    private endRow(): void {
        this.endField();
        this.rows.push(this.row);
        this.row = [];
    }
}

export function parseTabSeparated(text: string): string[][] {
    return new TabSeparatedReader(text.replaceAll('\r\n', LINE_FEED)).read();
}

/** Füllt die Tabelle aus Tab-getrenntem Text; ohne Zellen im Text bleibt sie unverändert */
export function fillTableFromTabSeparated(settings: TableSettings, text: string): TableSettings {
    const parsed = parseTabSeparated(text);
    if (parsed.length === 0) return settings;
    const columnCount = Math.max(...parsed.map((row) => row.length));
    // Erst leeren, sonst behielte `resizeTable` alte Zellen, die in den neuen Daten fehlen
    const resized = resizeTable({ ...settings, cells: [] }, parsed.length, columnCount);
    const cells = resized.cells.map((row, rowIndex) => row.map((_, column) => parsed[rowIndex]?.[column] ?? ''));
    return { ...resized, cells };
}
