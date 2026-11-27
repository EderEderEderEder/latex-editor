import type { Page } from '@playwright/test';

// Hilfen für Mausklicks im echten Editor (W4-13): Bildschirmposition eines Zeichens im Text und die Sprungtaste
// der Plattform (Strg, macOS ⌘). Der Browser-Teil steht als Zeichenkette, damit die Datei keine DOM-Typen braucht.

/** Sprungtaste für Playwright: macOS ⌘ (`Meta`), sonst Strg */
export const JUMP_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

export interface ScreenPoint {
    readonly x: number;
    readonly y: number;
}

const POINT_OF_TEXT = `(([needle, offset]) => {
    for (const line of document.querySelectorAll('.cm-content .cm-line')) {
        const index = (line.textContent ?? '').indexOf(needle);
        if (index === -1) continue;
        const target = index + offset;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let passed = 0;
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const length = node.textContent?.length ?? 0;
            if (target < passed + length) {
                const range = document.createRange();
                range.setStart(node, target - passed);
                range.setEnd(node, target - passed + 1);
                const rect = range.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            passed += length;
        }
    }
    return null;
})`;

/** Mitte des Zeichens `characterOffset` hinter dem Anfang von `needle` (erste Zeile, die den Text enthält) */
export async function pointOfText(page: Page, needle: string, characterOffset = 1): Promise<ScreenPoint> {
    // Als Ausdruck „Funktion(Argument)“ auswerten: ein reiner Funktionsstring würde von Playwright nicht aufgerufen
    const point = await page.evaluate<ScreenPoint | null>(`${POINT_OF_TEXT}(${JSON.stringify([needle, characterOffset])})`);
    if (point === null) throw new Error(`Text „${needle}“ steht nicht im sichtbaren Editor`);
    return point;
}
