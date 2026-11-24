// Seitenleiste (W2-3, Vorlage `SidebarView`): Tab-Leiste mit Symbol und Beschriftung (Dateien, Gliederung; Platz für
// ein Fehler-Badge), Statistik, dann Dateibaum mit Filterfeld oder Gliederung. Der Zustand liegt im Sidebar-Store.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { revealLine } from '../app/revealLine';
import { outlineStore } from '../app/outlineRuntime';
import { revealDeps } from '../app/projectRuntime';
import { useOutlineStore } from '../stores/outline';
import { useProjectStore } from '../stores/project';
import type { ProjectView } from '../stores/project';
import { sidebarStore, useSidebarStore } from '../stores/sidebar';
import type { SidebarTab } from '../stores/sidebar';
import { FileFilterRow } from './FileFilterRow';
import { FileTree, useProjectFileCount } from './FileTree';
import { OutlineList } from './OutlineList';
import type { OutlineTarget } from './OutlineList';
import { ProjectHeader, StartView } from './ProjectHeader';
import './sidebar.css';

export const SIDEBAR_LABEL = 'Seitenleiste';
const TAB_GROUP_LABEL = 'Ansicht der Seitenleiste';
const MAX_BADGE = 99;

interface TabSpec {
    readonly tab: SidebarTab;
    readonly title: string;
    readonly icon: ReactNode;
}

const TAB_SPECS: readonly TabSpec[] = [
    {
        tab: 'files',
        title: 'Dateien',
        icon: <path d="M1.5 4h4.5l1.5 1.5h7v8h-13z" />,
    },
    {
        tab: 'outline',
        title: 'Gliederung',
        icon: <path d="M2 3.5h12 M5 7h9 M5 10.5h9 M8 14h6 M2.5 7h.01 M2.5 10.5h.01 M2.5 14h.01" />,
    },
];

export interface SidebarProps {
    /** Zähler je Tab für ein Badge (später Fehler und Warnungen); 0 oder fehlend zeigt keins */
    readonly badges?: Readonly<Partial<Record<SidebarTab, number>>>;
    /** Gibt dem Editor den Fokus (nach einem Sprung aus der Gliederung) */
    readonly onFocusEditor: () => void;
}

function TabButton({ spec, badge }: { readonly spec: TabSpec; readonly badge: number }) {
    const isActive = useSidebarStore((state) => state.tab === spec.tab);
    return (
        <button
            type="button"
            className={isActive ? 'sidebar-tab is-active' : 'sidebar-tab'}
            aria-pressed={isActive}
            onClick={() => sidebarStore.getState().setTab(spec.tab)}
        >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {spec.icon}
            </svg>
            <span className="sidebar-tab-title">{spec.title}</span>
            {badge > 0 && (
                <span className="sidebar-tab-badge" aria-label={`${badge} Meldungen`}>
                    {badge > MAX_BADGE ? `${MAX_BADGE}+` : badge}
                </span>
            )}
        </button>
    );
}

function SidebarTabs({ badges }: Pick<SidebarProps, 'badges'>) {
    return (
        <div className="sidebar-tabs" role="group" aria-label={TAB_GROUP_LABEL}>
            {TAB_SPECS.map((spec) => (
                <TabButton key={spec.tab} spec={spec} badge={badges?.[spec.tab] ?? 0} />
            ))}
        </div>
    );
}

function SidebarStatistics() {
    const files = useProjectFileCount();
    const sections = useOutlineStore(outlineStore, (state) => state.entries.length);
    return (
        <div className="sidebar-statistics" role="group" aria-label="Statistik">
            <span>{`Dateien ${files}`}</span>
            <span>{`Abschnitte ${sections}`}</span>
        </div>
    );
}

function OutlinePanel({ onFocusEditor }: Pick<SidebarProps, 'onFocusEditor'>) {
    const tree = useOutlineStore(outlineStore, (state) => state.tree);
    const currentEntryId = useOutlineStore(outlineStore, (state) => state.currentEntryId);
    const select = useMemo(
        () => (target: OutlineTarget): void => void revealLine(revealDeps(onFocusEditor), target.file, target.line),
        [onFocusEditor],
    );
    return (
        <div className="sidebar-scroll">
            <OutlineList tree={tree} currentEntryId={currentEntryId} onSelect={select} />
        </div>
    );
}

function SidebarContent({ project, onFocusEditor }: { project: ProjectView } & Pick<SidebarProps, 'onFocusEditor'>) {
    const tab = useSidebarStore((state) => state.tab);
    if (tab === 'outline') return <OutlinePanel onFocusEditor={onFocusEditor} />;
    return (
        <>
            <FileFilterRow />
            <FileTree project={project} />
        </>
    );
}

export function Sidebar({ badges, onFocusEditor }: SidebarProps) {
    const project = useProjectStore((state) => state.current);
    return (
        <aside className="sidebar" aria-label={SIDEBAR_LABEL}>
            {project === null ? (
                <StartView />
            ) : (
                <>
                    <ProjectHeader project={project} />
                    <SidebarTabs badges={badges} />
                    <SidebarStatistics />
                    <SidebarContent project={project} onFocusEditor={onFocusEditor} />
                </>
            )}
        </aside>
    );
}
