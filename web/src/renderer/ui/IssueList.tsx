// Meldungsliste der Seitenleiste (W2-12): Fehler, Warnungen und Boxen des letzten Builds, nach Datei gruppiert, mit
// Filter nach Schwere. Klick und Enter springen zur Stelle, Pfeiltasten wandern durch die Liste (Roving Tabindex);
// Prozessprobleme (Meldungen ohne Datei) stehen als eigene Gruppe oben. Schwere zeigt die Form (Kreis, Dreieck, Raute)
// und ein verstecktes Wort für Screenreader, nie nur die Farbe.
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { flattenGroups, groupIssues } from '../app/issueNavigation';
import type {
    IssueCounts, IssueEntry, IssueFilter, IssueFilterKey, IssueGroup, IssueGroups,
} from '../app/issueNavigation';
import { openIssue } from '../app/issueActions';
import { buildStore, useBuildStore } from '../app/buildRuntime';
import { revealDeps } from '../app/projectRuntime';
import { useProjectStore } from '../stores/project';
import './issueList.css';

export const ISSUE_TEXTS = {
    list: 'Meldungen',
    filters: 'Meldungen filtern',
    empty: 'Keine Meldungen',
    notCompiled: 'Noch nicht kompiliert. Strg+B startet den Lauf.',
    hidden: (count: number) => (count === 1 ? 'Eine Meldung ist ausgeblendet.' : `${count} Meldungen sind ausgeblendet.`),
    process: 'Kompilierlauf',
    unavailable: 'Kompilieren nicht möglich',
    notOpenable: 'Diese Datei liegt außerhalb des Projekts und lässt sich nicht öffnen.',
    line: (line: number) => `Zeile ${line}`,
} as const;

const SEVERITY_WORDS = { error: 'Fehler', warning: 'Warnung', badBox: 'Box', info: 'Hinweis' } as const;
const FILTER_LABELS: Readonly<Record<IssueFilterKey, string>> = { error: 'Fehler', warning: 'Warnungen', badBox: 'Boxen' };
const FILTER_ORDER: readonly IssueFilterKey[] = ['error', 'warning', 'badBox'];
const SHAPE_FOR_FILTER: Readonly<Record<IssueFilterKey, ShapeKind>> = { error: 'error', warning: 'warning', badBox: 'badBox' };

type ShapeKind = keyof typeof SEVERITY_WORDS;

const SHAPES: Readonly<Record<ShapeKind, React.JSX.Element>> = {
    error: <circle cx="6" cy="6" r="4.5" />,
    warning: <path d="M6 1.2l5 9.3h-10z" />,
    badBox: <path d="M6 0.8l5.2 5.2-5.2 5.2-5.2-5.2z" />,
    info: <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />,
};

function IssueShape({ kind }: { readonly kind: ShapeKind }) {
    return (
        <svg className={`issue-shape issue-shape-${kind}`} viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">
            {SHAPES[kind]}
        </svg>
    );
}

export interface IssueListProps {
    readonly groups: IssueGroups;
    readonly counts: IssueCounts;
    readonly filter: IssueFilter;
    readonly selectedKey: string | null;
    /** Meldungen insgesamt (auch ausgeblendete), für den Text im leeren Zustand */
    readonly totalCount: number;
    readonly hasResult: boolean;
    /** Erklärung, wenn Kompilieren nicht möglich ist (latexmk fehlt) */
    readonly unavailableDetail: string | null;
    readonly onFilter: (key: IssueFilterKey, isOn: boolean) => void;
    readonly onOpen: (entry: IssueEntry, canOpen: boolean) => void;
}

function FilterBar({ counts, filter, onFilter }: Pick<IssueListProps, 'counts' | 'filter' | 'onFilter'>) {
    return (
        <div className="issue-filters" role="group" aria-label={ISSUE_TEXTS.filters}>
            {FILTER_ORDER.map((key) => (
                <button
                    key={key}
                    type="button"
                    className="issue-filter"
                    aria-pressed={filter[key]}
                    title={`${FILTER_LABELS[key]} ${filter[key] ? 'ausblenden' : 'anzeigen'}`}
                    onClick={() => onFilter(key, !filter[key])}
                >
                    <IssueShape kind={SHAPE_FOR_FILTER[key]} />
                    <span>{`${FILTER_LABELS[key]} ${counts[key]}`}</span>
                </button>
            ))}
        </div>
    );
}

interface RowProps {
    readonly entry: IssueEntry;
    readonly canOpen: boolean;
    readonly isSelected: boolean;
    readonly isTabStop: boolean;
    readonly onOpen: IssueListProps['onOpen'];
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

function IssueRow({ entry, canOpen, isSelected, isTabStop, onOpen, onKeyDown }: RowProps) {
    const { issue } = entry;
    return (
        <div
            className={isSelected ? 'issue-row is-selected' : 'issue-row'}
            role="option"
            data-issue-key={entry.key}
            aria-selected={isSelected}
            aria-disabled={issue.file !== null && !canOpen ? true : undefined}
            tabIndex={isTabStop ? 0 : -1}
            title={issue.file !== null && !canOpen ? ISSUE_TEXTS.notOpenable : issue.message}
            onClick={() => onOpen(entry, canOpen)}
            onKeyDown={onKeyDown}
        >
            <IssueShape kind={issue.severity} />
            <span className="issue-text">
                <span className="issue-severity">{`${SEVERITY_WORDS[issue.severity]}: `}</span>
                {issue.message}
            </span>
            {issue.line !== null && <span className="issue-line">{ISSUE_TEXTS.line(issue.line)}</span>}
        </div>
    );
}

interface GroupViewProps extends Pick<RowProps, 'onOpen'> {
    readonly title: string;
    readonly fullTitle: string;
    readonly canOpen: boolean;
    readonly entries: readonly IssueEntry[];
    readonly selectedKey: string | null;
    readonly tabStopKey: string | null;
    readonly onRowKeyDown: (event: KeyboardEvent<HTMLDivElement>, entry: IssueEntry, canOpen: boolean) => void;
}

function GroupView(props: GroupViewProps) {
    const { title, fullTitle, canOpen, entries, selectedKey, tabStopKey, onOpen, onRowKeyDown } = props;
    return (
        <div role="group" aria-label={`${title}, ${entries.length}`} className="issue-group">
            <div className="issue-group-title" title={fullTitle}>
                <span className="issue-group-name">{title}</span>
                <span className="issue-group-count">{entries.length}</span>
            </div>
            {entries.map((entry) => (
                <IssueRow
                    key={entry.key}
                    entry={entry}
                    canOpen={canOpen}
                    isSelected={entry.key === selectedKey}
                    isTabStop={entry.key === tabStopKey}
                    onOpen={onOpen}
                    onKeyDown={(event) => onRowKeyDown(event, entry, canOpen)}
                />
            ))}
        </div>
    );
}

function nextKey(keys: readonly string[], current: string, key: string): string | null {
    const index = keys.indexOf(current);
    switch (key) {
        case 'ArrowDown': return keys[Math.min(index + 1, keys.length - 1)] ?? null;
        case 'ArrowUp': return keys[Math.max(index - 1, 0)] ?? null;
        case 'Home': return keys[0] ?? null;
        case 'End': return keys.at(-1) ?? null;
        default: return null;
    }
}

function EmptyState({ props }: { readonly props: IssueListProps }) {
    const hiddenCount = props.totalCount;
    const hint = !props.hasResult ? ISSUE_TEXTS.notCompiled : hiddenCount > 0 ? ISSUE_TEXTS.hidden(hiddenCount) : null;
    return (
        <div className="issue-empty">
            <p className="issue-empty-title">{ISSUE_TEXTS.empty}</p>
            {hint !== null && <p className="issue-empty-hint">{hint}</p>}
        </div>
    );
}

function GroupsView({ props }: { readonly props: IssueListProps }) {
    const { groups, selectedKey, onOpen } = props;
    const [focusKey, setFocusKey] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const keys = useMemo(() => flattenGroups(groups).map((entry) => entry.key), [groups]);
    const tabStopKey = [focusKey, selectedKey].find((key) => key !== null && keys.includes(key)) ?? keys[0] ?? null;
    const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, entry: IssueEntry, canOpen: boolean): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(entry, canOpen);
            return;
        }
        const target = nextKey(keys, entry.key, event.key);
        if (target === null) return;
        event.preventDefault();
        setFocusKey(target);
        listRef.current?.querySelector<HTMLElement>(`[data-issue-key="${CSS.escape(target)}"]`)?.focus();
    };
    const shared = { selectedKey, tabStopKey, onOpen, onRowKeyDown };
    return (
        <div ref={listRef} className="issue-groups" role="listbox" aria-label={ISSUE_TEXTS.list}>
            {groups.problems.length > 0 && (
                <GroupView {...shared} title={ISSUE_TEXTS.process} fullTitle={ISSUE_TEXTS.process} canOpen={false} entries={groups.problems} />
            )}
            {groups.files.map((group: IssueGroup) => (
                <GroupView {...shared} key={group.file} title={group.label} fullTitle={group.file} canOpen={group.canOpen} entries={group.entries} />
            ))}
        </div>
    );
}

export function IssueList(props: IssueListProps) {
    const { groups, unavailableDetail } = props;
    const isEmpty = groups.problems.length === 0 && groups.files.length === 0;
    return (
        <div className="issue-panel">
            <FilterBar counts={props.counts} filter={props.filter} onFilter={props.onFilter} />
            <div className="issue-scroll">
                {unavailableDetail !== null && (
                    <div className="issue-notice" role="note">
                        <strong>{ISSUE_TEXTS.unavailable}</strong>
                        <span>{unavailableDetail}</span>
                    </div>
                )}
                {isEmpty ? <EmptyState props={props} /> : <GroupsView props={props} />}
            </div>
        </div>
    );
}

function useUnavailableDetail(): string | null {
    const tools = useBuildStore((state) => state.tools);
    if (tools === null || tools.latexmk !== null) return null;
    return tools.problems.find((problem) => problem.tool === 'latexmk')?.message ?? ISSUE_TEXTS.unavailable;
}

/** Verbindet die Liste mit Build-Store und Editor; `onFocusEditor` gibt dem Editor nach dem Sprung den Fokus */
export function IssuesPanel({ onFocusEditor }: { readonly onFocusEditor: () => void }) {
    const issues = useBuildStore((state) => state.issues);
    const filter = useBuildStore((state) => state.filter);
    const root = useProjectStore((state) => state.current?.root ?? null);
    const groups = useMemo(() => groupIssues(issues, filter, root), [issues, filter, root]);
    const onOpen = (entry: IssueEntry, canOpen: boolean): void => {
        buildStore.getState().select(entry.key);
        if (canOpen) void openIssue(revealDeps(onFocusEditor), buildStore, entry);
    };
    return (
        <IssueList
            groups={groups}
            counts={useBuildStore((state) => state.counts)}
            filter={filter}
            selectedKey={useBuildStore((state) => state.selectedKey)}
            totalCount={issues.length}
            hasResult={useBuildStore((state) => state.lastResult !== null)}
            unavailableDetail={useUnavailableDetail()}
            onFilter={(key, isOn) => buildStore.getState().setFilter(key, isOn)}
            onOpen={onOpen}
        />
    );
}
