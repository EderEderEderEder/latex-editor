import type { Extension } from '@codemirror/state';
import { diagnosticsExtension } from './diagnostics';
import { foldingExtension } from './folding';
import { gutterExtension } from './gutter';
import { typingExtension } from './typing';

/** Was eine Editor-Funktion über die Sitzung wissen darf */
export interface FeatureContext {
    /** Pfad der Datei der Sitzung (Kennung für Analysen) */
    readonly path: string;
}

/** Alle Editor-Funktionen, die jede Sitzung bekommt (eine Datei je Funktion, hier nur die Liste) */
export function featureExtensions(context: FeatureContext): Extension[] {
    return [
        gutterExtension(context),
        foldingExtension(context),
        diagnosticsExtension(context),
        typingExtension(context),
    ];
}
