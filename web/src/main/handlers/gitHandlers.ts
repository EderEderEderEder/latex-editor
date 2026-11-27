import { GitService, type GitServiceOptions } from '../git';
import type { GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';

// Git-Kanäle (W6-2, nur lesen): `git:status` für das aktuelle Projekt des Main. Der Renderer schickt keinen Pfad;
// die Absenderprüfung macht `ipc.ts` für alle Kanäle. Kein Git bzw. kein Repository: Fehler `gitMissing` bzw.
// `notARepository`. Schreibende Kanäle (Bereitstellen, Commit, Pull, Push) folgen in W6-4/W6-6; spätestens mit den
// Netzbefehlen gehört `GitService.dispose` in die Quit-Aufgaben (Status hat ein Zeitlimit von 30 s).

export type GitHandlers = Pick<IpcHandlers, 'git:status'>;

export interface GitHandlerOptions {
    readonly grants: GrantStore;
    // Nur Tests: Git-Pfad, Prozessstart und Umgebung ersetzen.
    readonly service?: Omit<GitServiceOptions, 'platform'>;
}

export function createGitHandlers(options: GitHandlerOptions): GitHandlers {
    const { grants } = options;
    const service = new GitService({ ...options.service, platform: grants.platform });
    return {
        // `async`: ohne Projekt wirft `requireProject` sonst synchron statt als abgelehntes Promise.
        'git:status': async () => service.status(grants.requireProject()),
    };
}
