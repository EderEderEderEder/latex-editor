// Einstellungen „Codeblock“, „Gleichung“ und „Aufzählung“ (Vorlage `InsertTextSettings.swift`). Markierter Text steht
// beim Öffnen schon als Inhalt darin und wird beim Einfügen ersetzt.
import { CODE_LANGUAGES, resizeList } from '../../../shared/core/insertion';
import type { EquationKind, ListKind } from '../../../shared/core/insertion';
import { isNumberedEquation } from '../../../shared/core/insertion/equationGenerator';
import { MAXIMUM_LIST_ITEMS } from '../../../shared/core/insertion/listGenerator';
import { insertStore, useInsertStore } from '../../stores/insert';
import { CaptionFields } from './CaptionFields';
import { AreaField, CheckField, NumberField, SelectField, SettingsCard, TextField } from './Fields';
import type { SelectOption } from './Fields';

export const TEXT_PANEL_TEXTS = {
    appearance: 'Darstellung',
    language: 'Sprache',
    lineNumbers: 'Zeilennummern',
    asFloat: 'Als Programm-Float mit Beschriftung',
    code: 'Code',
    codeArea: 'Quelltext',
    formulaArea: 'Formel',
    kindCard: 'Art',
    environment: 'Umgebung',
    label: 'Label',
    labelPlaceholder: 'optional, z. B. eq:einstein',
    formula: 'Formel (ohne $ … $)',
    list: 'Liste',
    items: 'Punkte',
    texts: 'Texte (optional)',
    item: (index: number) => `Punkt ${index}`,
} as const;

const LANGUAGE_OPTIONS: readonly SelectOption[] = CODE_LANGUAGES.map((language) => ({ value: language.environment, title: language.title }));

const EQUATION_OPTIONS: readonly SelectOption[] = [
    { value: 'equation', title: 'Gleichung (nummeriert)' },
    { value: 'equationStar', title: 'Gleichung (ohne Nummer)' },
    { value: 'align', title: 'Mehrere Zeilen ausgerichtet (nummeriert)' },
    { value: 'alignStar', title: 'Mehrere Zeilen ausgerichtet (ohne Nummer)' },
];

const LIST_OPTIONS: readonly SelectOption[] = [
    { value: 'itemize', title: 'Aufzählungspunkte' },
    { value: 'enumerate', title: 'Nummerierte Liste' },
];

const CODE_ROWS = 10;
const FORMULA_ROWS = 6;

export function CodePanel() {
    const code = useInsertStore((state) => state.code);
    const update = (change: Partial<typeof code>): void => insertStore.getState().update('code', (current) => ({ ...current, ...change }));
    return (
        <>
            <SettingsCard title={TEXT_PANEL_TEXTS.appearance}>
                <SelectField label={TEXT_PANEL_TEXTS.language} value={code.language} options={LANGUAGE_OPTIONS} onChange={(language) => update({ language })} />
                <div className="insert-inline">
                    <CheckField label={TEXT_PANEL_TEXTS.lineNumbers} checked={code.lineNumbers} onChange={(lineNumbers) => update({ lineNumbers })} />
                    <CheckField label={TEXT_PANEL_TEXTS.asFloat} checked={code.asFloat} onChange={(asFloat) => update({ asFloat })} />
                </div>
            </SettingsCard>
            {code.asFloat && <CaptionFields kind="code" />}
            <SettingsCard title={TEXT_PANEL_TEXTS.code}>
                <AreaField label={TEXT_PANEL_TEXTS.codeArea} value={code.content} rows={CODE_ROWS} onChange={(content) => update({ content })} />
            </SettingsCard>
        </>
    );
}

export function EquationPanel() {
    const equation = useInsertStore((state) => state.equation);
    const label = useInsertStore((state) => state.labelOverrides.equation);
    const update = (change: Partial<typeof equation>): void => insertStore.getState().update('equation', (current) => ({ ...current, ...change }));
    return (
        <>
            <SettingsCard title={TEXT_PANEL_TEXTS.kindCard}>
                <SelectField
                    label={TEXT_PANEL_TEXTS.environment}
                    value={equation.kind}
                    options={EQUATION_OPTIONS}
                    onChange={(kind) => update({ kind: kind as EquationKind })}
                />
                {isNumberedEquation(equation.kind) && (
                    <TextField
                        label={TEXT_PANEL_TEXTS.label}
                        value={label}
                        monospace
                        placeholder={TEXT_PANEL_TEXTS.labelPlaceholder}
                        onChange={(value) => insertStore.getState().update('labelOverrides', (current) => ({ ...current, equation: value }))}
                    />
                )}
            </SettingsCard>
            <SettingsCard title={TEXT_PANEL_TEXTS.formula}>
                <AreaField label={TEXT_PANEL_TEXTS.formulaArea} value={equation.content} rows={FORMULA_ROWS} onChange={(content) => update({ content })} />
            </SettingsCard>
        </>
    );
}

export function ListPanel() {
    const list = useInsertStore((state) => state.list);
    const update = (change: (current: typeof list) => typeof list): void => insertStore.getState().update('list', change);
    return (
        <>
            <SettingsCard title={TEXT_PANEL_TEXTS.kindCard}>
                <SelectField
                    label={TEXT_PANEL_TEXTS.list}
                    value={list.kind}
                    options={LIST_OPTIONS}
                    onChange={(kind) => update((current) => ({ ...current, kind: kind as ListKind }))}
                />
                <NumberField
                    label={TEXT_PANEL_TEXTS.items}
                    value={list.items.length}
                    minimum={1}
                    maximum={MAXIMUM_LIST_ITEMS}
                    onChange={(count) => update((current) => resizeList(current, count))}
                />
            </SettingsCard>
            <SettingsCard title={TEXT_PANEL_TEXTS.texts}>
                {list.items.map((item, index) => (
                    <TextField
                        key={index}
                        label={`${index + 1}.`}
                        value={item}
                        placeholder={TEXT_PANEL_TEXTS.item(index + 1)}
                        onChange={(value) => update((current) => ({ ...current, items: current.items.map((entry, at) => (at === index ? value : entry)) }))}
                    />
                ))}
            </SettingsCard>
        </>
    );
}
