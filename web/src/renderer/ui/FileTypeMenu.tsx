// Dateitypmenü (Vorlage `FileFilterMenu`): welche Dateiarten der Baum zeigt (Häkchen = sichtbar), gruppiert nach Art mit
// Anzahl, dazu „Build-Dateien zeigen“ und „Alle Dateitypen zeigen“. Nur Anzeige; der Zustand liegt im Sidebar-Store.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { countFileTypes } from '../../shared/core/fileTree';
import { buildFileTypeSections } from '../../shared/core/fileTypes';
import type { FileTypeEntry } from '../../shared/core/fileTypes';
import { useProjectStore } from '../stores/project';
import { sidebarStore, useSidebarStore } from '../stores/sidebar';

export const FILE_TYPE_MENU_TEXTS = {
    button: 'Dateitypen filtern',
    group: 'Dateitypen',
    showBuildFiles: 'Build-Dateien zeigen',
    showAll: 'Alle Dateitypen zeigen',
    allVisible: 'Alle Dateitypen sichtbar',
    hiddenCount: (count: number) => (count === 1 ? 'Ein Dateityp ausgeblendet' : `${count} Dateitypen ausgeblendet`),
} as const;

function entryLabel(entry: FileTypeEntry): string {
    return entry.count > 0 ? `${entry.title} (${entry.count})` : entry.title;
}

/** Schließt das Menü bei Klick daneben und mit Escape */
function useDismiss(rootRef: RefObject<HTMLElement | null>, isOpen: boolean, close: () => void): void {
    useEffect(() => {
        if (!isOpen) return undefined;
        const onPointerDown = (event: PointerEvent): void => {
            if (!rootRef.current?.contains(event.target as Node)) close();
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') close();
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [rootRef, isOpen, close]);
}

function TypeCheckbox({ entry, isHidden }: { readonly entry: FileTypeEntry; readonly isHidden: boolean }) {
    return (
        <label className="file-type-item">
            <input
                type="checkbox"
                checked={!isHidden}
                onChange={(event) => sidebarStore.getState().setExtensionHidden(entry.extension, !event.target.checked)}
            />
            <span>{entryLabel(entry)}</span>
        </label>
    );
}

function MenuBody({ hidden, showsBuildFiles }: { readonly hidden: ReadonlySet<string>; readonly showsBuildFiles: boolean }) {
    const tree = useProjectStore((state) => state.current?.tree ?? null);
    const sections = useMemo(
        () => (tree === null ? [] : buildFileTypeSections(countFileTypes(tree), hidden)),
        [tree, hidden],
    );
    return (
        <div className="file-type-popover" role="group" aria-label={FILE_TYPE_MENU_TEXTS.group}>
            {sections.map((section) => (
                <div key={section.title} role="group" aria-label={section.title} className="file-type-section">
                    <div className="file-type-section-title">{section.title}</div>
                    {section.entries.map((entry) => (
                        <TypeCheckbox key={entry.extension} entry={entry} isHidden={hidden.has(entry.extension)} />
                    ))}
                </div>
            ))}
            <label className="file-type-item file-type-build">
                <input
                    type="checkbox"
                    checked={showsBuildFiles}
                    onChange={(event) => sidebarStore.getState().setShowsBuildFiles(event.target.checked)}
                />
                <span>{FILE_TYPE_MENU_TEXTS.showBuildFiles}</span>
            </label>
            <button type="button" disabled={hidden.size === 0} onClick={() => sidebarStore.getState().showAllExtensions()}>
                {FILE_TYPE_MENU_TEXTS.showAll}
            </button>
        </div>
    );
}

export function FileTypeMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverId = useId();
    const hidden = useSidebarStore((state) => state.hiddenExtensions);
    const showsBuildFiles = useSidebarStore((state) => state.showsBuildFiles);
    const isFiltering = hidden.size > 0 || showsBuildFiles;
    useDismiss(rootRef, isOpen, () => setIsOpen(false));
    return (
        <div ref={rootRef} className="file-type-menu">
            <button
                type="button"
                className={isFiltering ? 'file-type-button is-filtering' : 'file-type-button'}
                aria-label={FILE_TYPE_MENU_TEXTS.button}
                aria-expanded={isOpen}
                aria-controls={isOpen ? popoverId : undefined}
                title={hidden.size > 0 ? FILE_TYPE_MENU_TEXTS.hiddenCount(hidden.size) : FILE_TYPE_MENU_TEXTS.allVisible}
                onClick={() => setIsOpen((open) => !open)}
            >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 4h12M4.5 8h7M7 12h2" />
                </svg>
            </button>
            {isOpen && (
                <div id={popoverId}>
                    <MenuBody hidden={hidden} showsBuildFiles={showsBuildFiles} />
                </div>
            )}
        </div>
    );
}
