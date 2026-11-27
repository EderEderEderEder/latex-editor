// Kleine Bausteine der Einstellungen im Einfügen-Fenster (W4-10): Karte mit Überschrift und beschriftete Felder.
// Jedes Feld hat ein echtes `<label>` (Tastatur und Screenreader); nichts hier kennt einen bestimmten Baustein.
import { useId } from 'react';
import type { ReactNode } from 'react';

export function SettingsCard({ title, children }: { readonly title?: string; readonly children: ReactNode }) {
    return (
        <section className="insert-card">
            {title !== undefined && <h4>{title}</h4>}
            {children}
        </section>
    );
}

export function InfoText({ children }: { readonly children: ReactNode }) {
    return <p className="insert-info">{children}</p>;
}

interface TextFieldProps {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly placeholder?: string;
    readonly monospace?: boolean;
    readonly hint?: string;
}

export function TextField({ label, value, onChange, placeholder, monospace = false, hint }: TextFieldProps) {
    const id = useId();
    const hintId = `${id}-hint`;
    return (
        <div className="insert-row">
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type="text"
                autoComplete="off"
                spellCheck={false}
                className={monospace ? 'is-monospace' : undefined}
                value={value}
                placeholder={placeholder}
                aria-describedby={hint === undefined ? undefined : hintId}
                onChange={(event) => onChange(event.target.value)}
            />
            {hint !== undefined && <span id={hintId} className="insert-hint">{hint}</span>}
        </div>
    );
}

interface NumberFieldProps {
    readonly label: string;
    readonly value: number;
    readonly minimum: number;
    readonly maximum: number;
    readonly onChange: (value: number) => void;
}

/** Ganze Zahl in Grenzen; Eingaben außerhalb oder ohne Zahl ändern nichts */
export function NumberField({ label, value, minimum, maximum, onChange }: NumberFieldProps) {
    const id = useId();
    return (
        <div className="insert-row is-compact">
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type="number"
                min={minimum}
                max={maximum}
                value={value}
                onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    if (Number.isInteger(next) && next >= minimum && next <= maximum) onChange(next);
                }}
            />
        </div>
    );
}

export interface SelectOption {
    readonly value: string;
    readonly title: string;
}

interface SelectFieldProps {
    readonly label: string;
    readonly value: string;
    readonly options: readonly SelectOption[];
    readonly onChange: (value: string) => void;
}

export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
    const id = useId();
    return (
        <div className="insert-row">
            <label htmlFor={id}>{label}</label>
            <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map((option) => <option key={option.value} value={option.value}>{option.title}</option>)}
            </select>
        </div>
    );
}

interface CheckFieldProps {
    readonly label: string;
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
}

export function CheckField({ label, checked, onChange }: CheckFieldProps) {
    return (
        <label className="insert-check">
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
            {label}
        </label>
    );
}

interface AreaFieldProps {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly rows?: number;
    readonly hint?: string;
}

/** Mehrzeiliges Feld in fester Breite (Code, Formel, BibTeX); Enter bleibt ein Zeilenumbruch */
export function AreaField({ label, value, onChange, rows = 8, hint }: AreaFieldProps) {
    const id = useId();
    const hintId = `${id}-hint`;
    return (
        <div className="insert-area">
            <label htmlFor={id}>{label}</label>
            <textarea
                id={id}
                rows={rows}
                spellCheck={false}
                className="is-monospace"
                value={value}
                aria-describedby={hint === undefined ? undefined : hintId}
                onChange={(event) => onChange(event.target.value)}
            />
            {hint !== undefined && <span id={hintId} className="insert-hint">{hint}</span>}
        </div>
    );
}
