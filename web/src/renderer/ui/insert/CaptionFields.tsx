// Beschriftung, Label und Platzierung (Tabelle, Bild, Code; Vorlage `CaptionCard`). Das Label ist leer = automatisch aus
// dem Text, eindeutig im Projekt; der automatische Wert steht als Platzhalter im Feld.
import type { FloatPlacement } from '../../../shared/core/insertion';
import { labelNamesOf, resolvedLabel } from '../../app/insertLogic';
import type { LabelKind } from '../../app/insertLogic';
import { insertStore, useInsertStore } from '../../stores/insert';
import { CheckField, SelectField, SettingsCard, TextField } from './Fields';
import type { SelectOption } from './Fields';

export const PLACEMENT_OPTIONS: readonly SelectOption[] = [
    { value: 'standard', title: 'Standard' },
    { value: 'here', title: 'Hier, wenn möglich (h)' },
    { value: 'top', title: 'Seitenanfang (t)' },
    { value: 'bottom', title: 'Seitenende (b)' },
    { value: 'page', title: 'Eigene Seite (p)' },
    { value: 'forceHere', title: 'Hier erzwingen (H)' },
];

export const CAPTION_TEXTS = {
    card: 'Beschriftung',
    text: 'Text',
    textPlaceholder: 'z. B. Ergebnisse der Messung',
    escape: 'Sonderzeichen maskieren',
    label: 'Label',
    labelPlaceholder: 'wird aus dem Text erzeugt',
    placement: 'Platzierung',
} as const;

/** Das Label, das beim Einfügen entstünde (eigener Wert oder automatisch) */
function useResolvedLabel(kind: LabelKind): string {
    return useInsertStore((state) => resolvedLabel(kind, state, labelNamesOf(state.catalog)));
}

export interface CaptionFieldsProps {
    readonly kind: 'table' | 'image' | 'code';
    /** Schalter „Sonderzeichen maskieren“ nur für die Beschriftung zeigen (Bild); bei der Tabelle steht er bei den Optionen */
    readonly showsEscape?: boolean;
}

export function CaptionFields({ kind, showsEscape = false }: CaptionFieldsProps) {
    const settings = useInsertStore((state) => state[kind]);
    const override = useInsertStore((state) => state.labelOverrides[kind]);
    const automatic = useResolvedLabel(kind);
    const update = insertStore.getState().update;
    const patch = (change: Partial<typeof settings>): void => update(kind, (current) => ({ ...current, ...change }) as typeof current);
    return (
        <SettingsCard title={CAPTION_TEXTS.card}>
            <TextField
                label={CAPTION_TEXTS.text}
                value={settings.caption}
                placeholder={CAPTION_TEXTS.textPlaceholder}
                onChange={(caption) => patch({ caption })}
            />
            {showsEscape && (
                <CheckField label={CAPTION_TEXTS.escape} checked={settings.escapeText} onChange={(escapeText) => patch({ escapeText })} />
            )}
            <TextField
                label={CAPTION_TEXTS.label}
                value={override}
                monospace
                placeholder={automatic === '' ? CAPTION_TEXTS.labelPlaceholder : automatic}
                onChange={(value) => update('labelOverrides', (current) => ({ ...current, [kind]: value }))}
            />
            <SelectField
                label={CAPTION_TEXTS.placement}
                value={settings.placement}
                options={PLACEMENT_OPTIONS}
                onChange={(placement) => patch({ placement: placement as FloatPlacement })}
            />
        </SettingsCard>
    );
}
