// Text in die Zwischenablage legen. `navigator.clipboard` ist in dieser App abgelehnt (keine Berechtigungen, siehe
// `docs/ARCHITEKTUR.md`), deshalb der klassische Weg über eine Auswahl in einem kurzzeitigen Textfeld.
const OFFSCREEN_POSITION = '-1000px';

/** `true`, wenn der Browser das Kopieren angenommen hat */
export function copyTextToClipboard(text: string): boolean {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.left = OFFSCREEN_POSITION;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Im offenen modalen Dialog ist der Rest der Seite gesperrt: das Feld muss dort entstehen
    (previous?.closest('dialog') ?? document.body).append(field);
    field.select();
    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        field.remove();
        previous?.focus();
    }
}
