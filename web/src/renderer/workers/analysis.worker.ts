import { handleAnalysisRequest, type AnalysisRequest, type AnalysisResponse } from './analysisLogic';

// Dünne Hülle um `handleAnalysisRequest`. Ein Fehler in einer Anfrage wird als Antwort `error` gemeldet;
// der Worker läuft weiter.

interface AnalysisWorkerScope {
    onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
    postMessage(message: AnalysisResponse): void;
}

const scope = self as unknown as AnalysisWorkerScope;

function errorResponse(request: AnalysisRequest, error: unknown): AnalysisResponse {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'error', docId: request.docId, version: request.version, message };
}

scope.onmessage = (event) => {
    const request = event.data;
    try {
        scope.postMessage(handleAnalysisRequest(request));
    } catch (error) {
        scope.postMessage(errorResponse(request, error));
    }
};
