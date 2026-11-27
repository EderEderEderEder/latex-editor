// Strg-Klick mit den App-Singletons (W4-13): meldet die Abläufe aus `referenceCheckJump.ts` beim Editor an
// (`connectNavigation`). „Text → PDF“ ist dieselbe Vorwärtssuche wie Strg+J; `commandsRuntime` wird erst beim Klick
// geladen (es startet seinerseits den Index und damit diese Verdrahtung).
import { connectNavigation } from '../editor/navigation';
import { hintsStore } from '../stores/hints';
import { statusStore } from '../stores/status';
import type { ProjectFiles } from './completionIndexLogic';
import { followJumpTarget } from './referenceCheckJump';
import type { JumpFlowDeps } from './referenceCheckJump';
import { revealDeps } from './projectRuntime';
import { revealLine } from './revealLine';

const EDITOR_CONTENT_SELECTOR = '.editor-host .cm-content';

function focusEditorAfterLayout(): void {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(EDITOR_CONTENT_SELECTOR)?.focus());
}

function jumpDeps(projectFiles: () => ProjectFiles | null): JumpFlowDeps {
    return {
        references: () => hintsStore.getState().references,
        project: projectFiles,
        reveal: (path, line) => revealLine(revealDeps(focusEditorAfterLayout), path, line),
        report: (message) => statusStore.getState().show(message),
    };
}

async function showCursorInPdf(): Promise<void> {
    const [{ syncTeXFlowDeps }, { revealCursorInPdf }] = await Promise.all([import('./commandsRuntime'), import('./synctexFlow')]);
    await revealCursorInPdf(syncTeXFlowDeps(), 'explicit');
}

/** Meldet Strg-Klick an; die Rückgabe meldet wieder ab */
export function connectAppNavigation(projectFiles: () => ProjectFiles | null): () => void {
    const deps = jumpDeps(projectFiles);
    connectNavigation({
        follow: (target, fromPath) => void followJumpTarget(deps, target, fromPath),
        showInPdf: () => void showCursorInPdf(),
    });
    return () => connectNavigation(null);
}
