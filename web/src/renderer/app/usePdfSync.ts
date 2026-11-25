// Einhängen der PDF-Synchronisierung (`pdfSync.ts`) mit den App-Stores und dem Ereignis `build:finished`.
import { useEffect } from 'react';
import { onMainEvent } from '../ipc/events';
import { pdfStore } from '../stores/pdf';
import { projectStore } from '../stores/project';
import { connectPdfSync } from './pdfSync';

export function usePdfSync(): void {
    useEffect(() => connectPdfSync({
        pdf: pdfStore,
        project: projectStore,
        onBuildFinished: (listener) => onMainEvent('build:finished', listener),
    }), []);
}
