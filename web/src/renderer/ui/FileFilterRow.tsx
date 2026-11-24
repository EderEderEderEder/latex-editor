// Filterfeld über dem Baum (nach Dateinamen) mit dem Dateitypmenü; der Text liegt im Sidebar-Store.
import type { KeyboardEvent } from 'react';
import { sidebarStore, useSidebarStore } from '../stores/sidebar';
import { FileTypeMenu } from './FileTypeMenu';

export const FILE_FILTER_TEXTS = { placeholder: 'Dateien filtern', clear: 'Filter löschen' } as const;

export function FileFilterRow() {
    const text = useSidebarStore((state) => state.fileFilter);
    const clear = (): void => sidebarStore.getState().setFileFilter('');
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || text === '') return;
        event.preventDefault();
        clear();
    };
    return (
        <div className="file-filter-row">
            <FileTypeMenu />
            <input
                type="text"
                className="file-filter-input"
                value={text}
                placeholder={FILE_FILTER_TEXTS.placeholder}
                aria-label={FILE_FILTER_TEXTS.placeholder}
                spellCheck={false}
                onChange={(event) => sidebarStore.getState().setFileFilter(event.target.value)}
                onKeyDown={onKeyDown}
            />
            {text !== '' && (
                <button type="button" className="file-filter-clear" aria-label={FILE_FILTER_TEXTS.clear} onClick={clear}>
                    ×
                </button>
            )}
        </div>
    );
}
