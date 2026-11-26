import {
    CompletionIndexBuilder,
    handleCompletionIndexRequest,
    type CompletionIndexResponse,
    type CompletionIndexUpdate,
} from '../app/completionIndexLogic';

// Dünne Hülle um den Projektindex der Vervollständigung (W4-6). Der Zustand (je Datei das letzte Ergebnis) bleibt
// zwischen den Anfragen im Worker; ein Fehler in einer Anfrage wird als Antwort `error` gemeldet.

interface CompletionWorkerScope {
    onmessage: ((event: MessageEvent<CompletionIndexUpdate>) => void) | null;
    postMessage(message: CompletionIndexResponse): void;
}

const scope = self as unknown as CompletionWorkerScope;
const builder = new CompletionIndexBuilder();

scope.onmessage = (event) => {
    scope.postMessage(handleCompletionIndexRequest(builder, event.data));
};
