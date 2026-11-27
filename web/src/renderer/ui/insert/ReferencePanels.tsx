// Einstellungen „Querverweis“ und „Zitieren“ (Vorlage `ReferenceSettingsView`, `CitationSettingsView`): Labels und
// Literaturschlüssel kommen aus dem Projektindex. Mehrere Einträge zum Zitieren sind einfach anzukreuzen.
import { insertStore, useInsertStore } from '../../stores/insert';
import { CheckField, InfoText, SelectField, SettingsCard, TextField } from './Fields';

export const REFERENCE_TEXTS = {
    noLabels: 'Im Projekt gibt es noch keine Labels. Tabellen, Bilder und Codeblöcke legen eines an.',
    target: 'Ziel',
    label: 'Label',
    withPrefix: 'Mit Vorsatz („Abbildung~…“)',
    details: 'Angaben',
    page: 'Seite',
    pagePlaceholder: 'optional, z. B. S.~12',
    noEntries: 'Die Literaturdatei hat noch keine Einträge.',
    newSource: 'Neue Quelle anlegen …',
    entries: 'Einträge (mehrere ankreuzen)',
    entry: 'Literatureinträge',
} as const;

export function ReferencePanel() {
    const reference = useInsertStore((state) => state.reference);
    const labels = useInsertStore((state) => state.catalog.labels);
    if (labels.length === 0) {
        return <SettingsCard><InfoText>{REFERENCE_TEXTS.noLabels}</InfoText></SettingsCard>;
    }
    const options = labels.map((entry) => ({ value: entry.label, title: `${entry.label}  (${entry.file}:${entry.line})` }));
    const update = (change: Partial<typeof reference>): void => insertStore.getState().update('reference', (current) => ({ ...current, ...change }));
    return (
        <SettingsCard title={REFERENCE_TEXTS.target}>
            <SelectField label={REFERENCE_TEXTS.label} value={reference.label} options={options} onChange={(label) => update({ label })} />
            <CheckField label={REFERENCE_TEXTS.withPrefix} checked={reference.withPrefix} onChange={(withPrefix) => update({ withPrefix })} />
        </SettingsCard>
    );
}

/** Gewählte Schlüssel in der Reihenfolge der Liste (so steht `\cite{a,b}` immer gleich) */
function toggledKeys(order: readonly string[], selected: readonly string[], key: string, isChecked: boolean): string[] {
    const wanted = new Set(selected);
    if (isChecked) wanted.add(key);
    else wanted.delete(key);
    return order.filter((entry) => wanted.has(entry));
}

function CitationList() {
    const citations = useInsertStore((state) => state.catalog.citations);
    const keys = useInsertStore((state) => state.citation.keys);
    const order = citations.map((item) => item.key);
    return (
        <SettingsCard title={REFERENCE_TEXTS.entries}>
            <ul className="insert-citations" aria-label={REFERENCE_TEXTS.entry}>
                {citations.map((item) => (
                    <li key={item.key}>
                        <label>
                            <input
                                type="checkbox"
                                checked={keys.includes(item.key)}
                                onChange={(event) => insertStore.getState().update('citation', (current) => ({
                                    ...current, keys: toggledKeys(order, current.keys, item.key, event.target.checked),
                                }))}
                            />
                            <span><strong>{item.key}</strong>{item.summary !== '' && <small>{item.summary}</small>}</span>
                        </label>
                    </li>
                ))}
            </ul>
        </SettingsCard>
    );
}

export function CitationPanel() {
    const note = useInsertStore((state) => state.citation.note);
    const hasEntries = useInsertStore((state) => state.catalog.citations.length > 0);
    return (
        <>
            <SettingsCard title={REFERENCE_TEXTS.details}>
                <TextField
                    label={REFERENCE_TEXTS.page}
                    value={note}
                    placeholder={REFERENCE_TEXTS.pagePlaceholder}
                    onChange={(value) => insertStore.getState().update('citation', (current) => ({ ...current, note: value }))}
                />
            </SettingsCard>
            {hasEntries ? <CitationList /> : (
                <SettingsCard>
                    <InfoText>{REFERENCE_TEXTS.noEntries}</InfoText>
                    <div><button type="button" onClick={() => insertStore.getState().setKind('source')}>{REFERENCE_TEXTS.newSource}</button></div>
                </SettingsCard>
            )}
        </>
    );
}
