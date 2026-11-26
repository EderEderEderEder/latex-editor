// Web Worker für Spike S8: nspell + Syntaxfilter + Fachvokabular + Zerlegung über den sichtbaren Bereich.
import nspell from 'nspell';
import { getStandardVocabulary } from '../../../src/shared/core/spelling/technicalVocabulary';
import { SpellChecker } from './checker';
import { withoutCompoundOnlyEntries } from './dictionaryFix';
import type { CheckRequest, CheckResponse, WorkerRequest, WorkerResponse } from './workerProtocol';
import { findWords } from './words';

let checker: SpellChecker | null = null;

function reply(message: WorkerResponse): void {
    (self as unknown as Worker).postMessage(message);
}

function load(aff: string, dic: string): void {
    const start = performance.now();
    const cleaned = withoutCompoundOnlyEntries(aff, dic).dic;
    checker = new SpellChecker(nspell(aff, cleaned), { vocabulary: getStandardVocabulary(), splitCompounds: true });
    reply({ type: 'loaded', buildMs: performance.now() - start });
}

function check(request: CheckRequest, active: SpellChecker): CheckResponse {
    const start = performance.now();
    const errors: [number, number][] = [];
    let words = 0;
    for (const occurrence of findWords(request.text, request.offset)) {
        if (occurrence.inSyntax || occurrence.from < request.visibleFrom || occurrence.to > request.visibleTo) continue;
        words++;
        if (active.verdict(occurrence.word, occurrence.followedByDot) === 'unknown') errors.push([occurrence.from, occurrence.to]);
    }
    return { type: 'result', id: request.id, errors, words, checkMs: performance.now() - start };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const message = event.data;
    if (message.type === 'load') {
        load(message.aff, message.dic);
        return;
    }
    if (checker !== null) reply(check(message, checker));
};
