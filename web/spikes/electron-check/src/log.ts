// Ausgabe in die <pre>-Felder der Seite; `lines` merkt sich alles für die Automatisierung.
export const lines: Record<string, string[]> = {};

export function appendLog(section: string, text: string): void {
    (lines[section] ??= []).push(text);
    const target = document.getElementById(`log-${section}`);
    if (target === null) return;
    target.textContent += `${text}\n`;
    target.scrollTop = target.scrollHeight;
}

export interface CheckResult {
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
}

export function describe(result: CheckResult): string {
    return `${result.ok ? 'OK  ' : 'FAIL'} ${result.name}: ${result.detail}`;
}
