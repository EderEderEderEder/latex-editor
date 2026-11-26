import type { Extension } from '@codemirror/state';
import { autoCapitalizeExtension } from './autocap';
import { buildMarksExtension } from './buildMarks';
import { completionExtension } from './completion';
import { diagnosticsExtension } from './diagnostics';
import { foldingExtension } from './folding';
import { gutterExtension } from './gutter';
import { searchExtension } from './search';
import { typingExtension } from './typing';
import { writingHintsExtension } from './writingHints';

/** Was eine Editor-Funktion über die Sitzung wissen darf */
export interface FeatureContext {
    /** Schlüssel der Sitzung (Projektpfad oder `GrantId`; Kennung für Analysen) */
    readonly path: string;
    /** Anzeigename mit Endung; bestimmt die Sprache (ohne Angabe gilt `path`) */
    readonly name?: string;
}

/** Alle Editor-Funktionen, die jede Sitzung bekommt (eine Datei je Funktion, hier nur die Liste) */
export function featureExtensions(context: FeatureContext): Extension[] {
    return [
        gutterExtension(context),
        foldingExtension(context),
        diagnosticsExtension(context),
        buildMarksExtension(),
        typingExtension(context),
        autoCapitalizeExtension(context),
        writingHintsExtension(context),
        searchExtension(),
        completionExtension(context),
    ];
}
