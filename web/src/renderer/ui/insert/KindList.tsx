// Linke Spalte des Einfügen-Fensters: die Bausteine in zwei Gruppen (Vorlage `KindList`). Eine Auswahlliste
// (`listbox`) mit wandernder Tab-Position: Pfeil auf/ab wählt den Nachbarn, Pos1/Ende springen an Anfang und Ende.
import type { KeyboardEvent } from 'react';
import { ALL_INSERTION_KINDS, BLOCK_KINDS, KIND_GLYPHS, KIND_GROUP_TITLES, KIND_TITLES, REFERENCE_KINDS } from '../../app/insertKinds';
import type { InsertionKind } from '../../app/insertKinds';
import { insertStore, useInsertStore } from '../../stores/insert';

export const KIND_LIST_LABEL = 'Bausteine';

const optionId = (kind: InsertionKind): string => `insert-kind-${kind}`;

function neighbour(kind: InsertionKind, key: string): InsertionKind | null {
    const last = ALL_INSERTION_KINDS.length - 1;
    const index = ALL_INSERTION_KINDS.indexOf(kind);
    switch (key) {
        case 'ArrowDown': return ALL_INSERTION_KINDS[Math.min(index + 1, last)] ?? null;
        case 'ArrowUp': return ALL_INSERTION_KINDS[Math.max(index - 1, 0)] ?? null;
        case 'Home': return ALL_INSERTION_KINDS[0] ?? null;
        case 'End': return ALL_INSERTION_KINDS[last] ?? null;
        default: return null;
    }
}

function handleKey(event: KeyboardEvent, kind: InsertionKind): void {
    const next = neighbour(kind, event.key);
    if (next === null) return;
    event.preventDefault();
    insertStore.getState().setKind(next);
    document.getElementById(optionId(next))?.focus();
}

function KindOption({ kind, isSelected }: { readonly kind: InsertionKind; readonly isSelected: boolean }) {
    return (
        <button
            type="button"
            role="option"
            id={optionId(kind)}
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            className={isSelected ? 'insert-kind is-selected' : 'insert-kind'}
            onClick={() => insertStore.getState().setKind(kind)}
            onKeyDown={(event) => handleKey(event, kind)}
        >
            <span className="insert-kind-glyph" aria-hidden="true">{KIND_GLYPHS[kind]}</span>
            {KIND_TITLES[kind]}
        </button>
    );
}

function KindGroup({ title, kinds, selected }: { readonly title: string; readonly kinds: readonly InsertionKind[]; readonly selected: InsertionKind }) {
    return (
        <div role="group" aria-label={title}>
            <h3 aria-hidden="true">{title}</h3>
            {kinds.map((kind) => <KindOption key={kind} kind={kind} isSelected={kind === selected} />)}
        </div>
    );
}

export function KindList() {
    const selected = useInsertStore((state) => state.kind);
    return (
        <div className="insert-kinds" role="listbox" aria-label={KIND_LIST_LABEL} aria-orientation="vertical">
            <KindGroup title={KIND_GROUP_TITLES.blocks} kinds={BLOCK_KINDS} selected={selected} />
            <KindGroup title={KIND_GROUP_TITLES.references} kinds={REFERENCE_KINDS} selected={selected} />
        </div>
    );
}
