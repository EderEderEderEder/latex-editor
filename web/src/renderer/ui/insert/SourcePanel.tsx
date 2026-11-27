// Einstellungen „Quelle“ (Vorlage `SourceSettingsView`): Formular je Typ oder eingefügtes BibTeX; der Eintrag kommt
// in die Literaturdatei, auf Wunsch wird gleich zitiert. Pflichtfelder tragen ein „*“.
import { sourceDraftOf } from '../../app/insertLogic';
import { requiresAuthor, SOURCE_TYPE_NAMES, SOURCE_TYPE_TITLES, sourceFields } from '../../../shared/core/bib/sourceTypes';
import type { SourceTypeName } from '../../../shared/core/bib/sourceTypes';
import type { SourceLanguage, SourceMode, SourceSettings } from '../../../shared/core/bib/sourceBuilder';
import { todayText } from '../../app/insertRuntime';
import { insertStore, useInsertStore } from '../../stores/insert';
import { AreaField, CheckField, SelectField, SettingsCard, TextField } from './Fields';
import type { SelectOption } from './Fields';

export const SOURCE_PANEL_TEXTS = {
    input: 'Eingabe',
    mode: 'Eingabeart',
    kind: 'Art',
    type: 'Typ',
    language: 'Sprache',
    details: 'Angaben (* = Pflicht)',
    authors: 'Autor',
    authorsPlaceholder: 'Max Mustermann; Erika Musterfrau',
    key: 'Schlüssel',
    automaticKey: (key: string) => `automatisch: ${key}`,
    automaticKeyFallback: 'automatisch (Nachname + Jahr)',
    bibtexCard: 'BibTeX-Eintrag',
    bibtex: 'BibTeX',
    bibtexHint: 'Z. B. aus Google Scholar („Zitieren“ → BibTeX), vom Verlag oder aus einem Bibliothekskatalog. Der Schlüssel wird bei Bedarf angepasst (eindeutig, ohne Umlaute).',
    inText: 'Im Text',
    cite: 'Gleich an der Cursorposition zitieren (\\cite)',
    page: 'Seite',
    pagePlaceholder: 'optional, z. B. S.~12',
} as const;

const MODE_OPTIONS: readonly SelectOption[] = [
    { value: 'form', title: 'Formular' },
    { value: 'bibtex', title: 'BibTeX einfügen' },
];

const TYPE_OPTIONS: readonly SelectOption[] = SOURCE_TYPE_NAMES.map((name) => ({ value: name, title: SOURCE_TYPE_TITLES[name] }));

const LANGUAGE_OPTIONS: readonly SelectOption[] = [
    { value: 'german', title: 'Deutsch' },
    { value: 'english', title: 'Englisch' },
    { value: 'none', title: 'Keine Angabe' },
];

const BIBTEX_ROWS = 10;

const updateSource = (change: Partial<SourceSettings>): void => insertStore.getState().update('source', (current) => ({ ...current, ...change }));

/** Der Schlüssel, den der Eintrag bekäme (Platzhalter im Feld) */
function useAutomaticKey(): string {
    return useInsertStore((state) => {
        const draft = sourceDraftOf(state, state.catalog, todayText());
        return draft.ok ? SOURCE_PANEL_TEXTS.automaticKey(draft.key) : SOURCE_PANEL_TEXTS.automaticKeyFallback;
    });
}

function FormFields({ source }: { readonly source: SourceSettings }) {
    const automaticKey = useAutomaticKey();
    return (
        <>
            <SettingsCard title={SOURCE_PANEL_TEXTS.kind}>
                <SelectField label={SOURCE_PANEL_TEXTS.type} value={source.type} options={TYPE_OPTIONS} onChange={(type) => updateSource({ type: type as SourceTypeName })} />
                <SelectField label={SOURCE_PANEL_TEXTS.language} value={source.language} options={LANGUAGE_OPTIONS} onChange={(language) => updateSource({ language: language as SourceLanguage })} />
            </SettingsCard>
            <SettingsCard title={SOURCE_PANEL_TEXTS.details}>
                <TextField
                    label={requiresAuthor(source.type) ? `${SOURCE_PANEL_TEXTS.authors} *` : SOURCE_PANEL_TEXTS.authors}
                    value={source.authors}
                    placeholder={SOURCE_PANEL_TEXTS.authorsPlaceholder}
                    onChange={(authors) => updateSource({ authors })}
                />
                {sourceFields(source.type).map((field) => (
                    <TextField
                        key={field.name}
                        label={field.isRequired ? `${field.title} *` : field.title}
                        value={source.values[field.name] ?? ''}
                        placeholder={field.placeholder}
                        onChange={(value) => updateSource({ values: { ...source.values, [field.name]: value } })}
                    />
                ))}
                <TextField label={SOURCE_PANEL_TEXTS.key} value={source.keyOverride} monospace placeholder={automaticKey} onChange={(keyOverride) => updateSource({ keyOverride })} />
            </SettingsCard>
        </>
    );
}

function InTextCard() {
    const options = useInsertStore((state) => state.sourceOptions);
    const update = (change: Partial<typeof options>): void => insertStore.getState().update('sourceOptions', (current) => ({ ...current, ...change }));
    return (
        <SettingsCard title={SOURCE_PANEL_TEXTS.inText}>
            <CheckField label={SOURCE_PANEL_TEXTS.cite} checked={options.citeAfterInsert} onChange={(citeAfterInsert) => update({ citeAfterInsert })} />
            {options.citeAfterInsert && (
                <TextField label={SOURCE_PANEL_TEXTS.page} value={options.note} placeholder={SOURCE_PANEL_TEXTS.pagePlaceholder} onChange={(note) => update({ note })} />
            )}
        </SettingsCard>
    );
}

export function SourcePanel() {
    const source = useInsertStore((state) => state.source);
    return (
        <>
            <SettingsCard title={SOURCE_PANEL_TEXTS.input}>
                <SelectField label={SOURCE_PANEL_TEXTS.mode} value={source.mode} options={MODE_OPTIONS} onChange={(mode) => updateSource({ mode: mode as SourceMode })} />
            </SettingsCard>
            {source.mode === 'form' ? <FormFields source={source} /> : (
                <SettingsCard title={SOURCE_PANEL_TEXTS.bibtexCard}>
                    <AreaField label={SOURCE_PANEL_TEXTS.bibtex} value={source.bibtex} rows={BIBTEX_ROWS} hint={SOURCE_PANEL_TEXTS.bibtexHint} onChange={(bibtex) => updateSource({ bibtex })} />
                </SettingsCard>
            )}
            <InTextCard />
        </>
    );
}
