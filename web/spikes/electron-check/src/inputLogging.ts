// Protokolliert Tastatur- und Compose-Ereignisse eines Elements (Prüfung a und b).
import { appendLog } from './log';

export interface KeyRecord {
    readonly key: string;
    readonly code: string;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly altGraph: boolean;
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
}

export const keyRecords: Record<string, KeyRecord[]> = {};
export const compositionRecords: Record<string, string[]> = {};

function visible(text: string): string {
    return JSON.stringify(text);
}

export function attachKeyLogger(target: HTMLElement, name: string): void {
    keyRecords[name] = [];
    target.addEventListener('keydown', (event) => {
        const record: KeyRecord = {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            altGraph: event.getModifierState('AltGraph'),
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
        };
        keyRecords[name]?.push(record);
        appendLog('keys', `${name} keydown key=${visible(record.key)} code=${record.code} ctrl=${record.ctrlKey} alt=${record.altKey} AltGraph=${record.altGraph}`);
    });
}

export function attachCompositionLogger(target: HTMLElement, name: string): void {
    compositionRecords[name] = [];
    const log = (type: string, text: string): void => {
        compositionRecords[name]?.push(`${type}:${text}`);
        appendLog('ime', `${name} ${type} ${visible(text)}`);
    };
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend'] as const) {
        target.addEventListener(type, (event) => log(type, (event as CompositionEvent).data));
    }
    target.addEventListener('beforeinput', (event) => log(`beforeinput/${(event as InputEvent).inputType}`, String((event as InputEvent).data)));
}
