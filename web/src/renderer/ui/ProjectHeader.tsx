// Projekt-Leiste: Name und Hauptdatei im Kopf der Seitenleiste mit „Projekt öffnen …“; ohne Projekt die Startansicht
// mit großem Knopf und der Liste „Zuletzt geöffnet“. Öffnen und Wechseln laufen über `app/projectFlow.ts`.
import { chooseAndOpenProject, openProjectByGrant } from '../app/projectFlow';
import { relativeToProject } from '../app/pathBarData';
import { projectFlowDeps } from '../app/projectRuntime';
import { useProjectStore } from '../stores/project';
import type { ProjectView } from '../stores/project';

export const PROJECT_TEXTS = {
    open: 'Projekt öffnen …',
    noProject: 'Kein Projekt geöffnet',
    hint: 'Einen LaTeX-Projektordner öffnen, um Dateien, Gliederung und Fehler zu sehen.',
    recent: 'Zuletzt geöffnet',
    noRecent: 'Noch keine Projekte geöffnet.',
    mainFile: (name: string) => `Hauptdatei: ${name}`,
    noMainFile: 'Keine Hauptdatei gefunden',
    truncated: 'Der Baum ist gekürzt: Das Projekt hat zu viele Einträge.',
} as const;

const openProjectDialog = (): void => void chooseAndOpenProject(projectFlowDeps());

function mainFileText(project: ProjectView): string {
    if (project.mainFile === null) return PROJECT_TEXTS.noMainFile;
    return PROJECT_TEXTS.mainFile(relativeToProject(project.root, project.mainFile) ?? project.mainFile);
}

export function ProjectHeader({ project }: { readonly project: ProjectView }) {
    return (
        <div className="project-header" role="group" aria-label="Projekt">
            <div className="project-header-text">
                <span className="project-name" title={project.root}>{project.name}</span>
                <span className="project-main-file">{mainFileText(project)}</span>
                {project.truncated && <span className="project-truncated" role="status">{PROJECT_TEXTS.truncated}</span>}
            </div>
            <button type="button" className="project-open-button" onClick={openProjectDialog} title={PROJECT_TEXTS.open}>
                {PROJECT_TEXTS.open}
            </button>
        </div>
    );
}

export function StartView() {
    const recent = useProjectStore((state) => state.recent);
    return (
        <div className="start-view">
            <h2 className="start-title">{PROJECT_TEXTS.noProject}</h2>
            <span className="start-hint">{PROJECT_TEXTS.hint}</span>
            <button type="button" className="start-open-button" onClick={openProjectDialog}>
                {PROJECT_TEXTS.open}
            </button>
            <h3 className="start-recent-title">{PROJECT_TEXTS.recent}</h3>
            {recent.length === 0 ? (
                <span className="start-hint">{PROJECT_TEXTS.noRecent}</span>
            ) : (
                <ul className="start-recent" aria-label={PROJECT_TEXTS.recent}>
                    {recent.map((entry) => (
                        <li key={entry.grantId}>
                            <button type="button" onClick={() => void openProjectByGrant(projectFlowDeps(), entry.grantId)}>
                                {entry.name}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
