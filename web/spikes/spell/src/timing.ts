// Zeitmessung je Tastendruck wie in spikes/cm-perf/src/measure.ts (rAF + MessageChannel nach dem Paint).

export interface Stats {
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
    readonly count: number;
}

export interface FrameTiming {
    /** bis nach dem Paint des nächsten Rahmens */
    readonly latency: number;
    /** nur Hauptthread-Arbeit (synchroner Teil + Rahmenarbeit ab Rahmenbeginn) */
    readonly work: number;
}

const PERCENTILE_50 = 0.5;
const PERCENTILE_95 = 0.95;

function percentile(sorted: readonly number[], fraction: number): number {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index] ?? Number.NaN;
}

export function toStats(values: readonly number[]): Stats {
    const sorted = [...values].sort((left, right) => left - right);
    return {
        p50: percentile(sorted, PERCENTILE_50),
        p95: percentile(sorted, PERCENTILE_95),
        max: sorted[sorted.length - 1] ?? Number.NaN,
        count: sorted.length,
    };
}

export function measureFrame(start: number, syncEnd: number): Promise<FrameTiming> {
    return new Promise((resolve) => {
        requestAnimationFrame((frameStart) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                const end = performance.now();
                resolve({ latency: end - start, work: syncEnd - start + (end - Math.max(frameStart, syncEnd)) });
            };
            channel.port2.postMessage(null);
        });
    });
}

export function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
