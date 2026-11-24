// Pfadzeile über dem Editor: Include-Kette von der Hauptdatei bis zur gezeigten Datei. Feste Höhe, `overflow: hidden`,
// damit der Editor nie von ihrem Inhalt abhängt. Ein Klick auf ein Glied öffnet die Datei.
import { useMemo } from 'react';
import { includeChain } from '../../shared/core/latex/outline';
import { pathBarSegments } from '../app/pathBarData';
import { outlineStore } from '../app/outlineRuntime';
import { openProjectFile } from '../app/projectFiles';
import { projectFileDeps } from '../app/projectRuntime';
import { useEditorStore } from '../stores/editor';
import { useOutlineStore } from '../stores/outline';
import { useProjectStore } from '../stores/project';

export const PATH_BAR_LABEL = 'Pfad der Datei';
const SEPARATOR = '›';

export function PathBar() {
    const root = useProjectStore((state) => state.current?.root ?? null);
    const active = useEditorStore((state) => state.tabs.active);
    const title = useEditorStore((state) => (state.tabs.active === null ? null : (state.files[state.tabs.active]?.title ?? null)));
    const mainFile = useOutlineStore(outlineStore, (state) => state.mainFile);
    const includingFile = useOutlineStore(outlineStore, (state) => state.includingFile);
    const segments = useMemo(() => {
        if (active === null || title === null) return [];
        return pathBarSegments(includeChain(active, mainFile, includingFile), { path: active, title }, root);
    }, [active, title, mainFile, includingFile, root]);
    return (
        <nav className="path-bar" aria-label={PATH_BAR_LABEL}>
            {segments.map((segment, index) => (
                <span key={`${index}:${segment.path}`} className="path-bar-item">
                    {index > 0 && <span className="path-bar-separator" aria-hidden="true">{SEPARATOR}</span>}
                    <button
                        type="button"
                        className="path-bar-segment"
                        title={segment.path}
                        aria-current={index === segments.length - 1 ? 'page' : undefined}
                        onClick={() => void openProjectFile(projectFileDeps(), segment.path, true)}
                    >
                        {segment.label}
                    </button>
                </span>
            ))}
        </nav>
    );
}
