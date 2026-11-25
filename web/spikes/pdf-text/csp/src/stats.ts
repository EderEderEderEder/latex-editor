// Kennzahlen einer Messreihe (ms)

export interface Summary {
    count: number;
    p50: number;
    p95: number;
    max: number;
    mean: number;
}

export function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
    return sorted[Math.max(0, index)] ?? 0;
}

export function summarize(values: readonly number[]): Summary {
    const sorted = [...values].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        count: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted[sorted.length - 1] ?? 0,
        mean: sorted.length === 0 ? 0 : total / sorted.length,
    };
}

/** Nach dem Paint des nächsten Rahmens (Methode aus tests/perf/pageProbe.ts) */
export function afterNextPaint(): Promise<number> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => resolve(performance.now());
            channel.port2.postMessage(null);
        });
    });
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sammelt Long Tasks (> 50 ms) des Hauptthreads, solange `stop` nicht aufgerufen wurde */
export function longTaskRecorder(): { stop: () => number[] } {
    const durations: number[] = [];
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    return {
        stop: () => {
            observer.disconnect();
            return durations;
        },
    };
}
