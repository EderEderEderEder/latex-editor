// Entprellen mit nachlaufender Ausführung (Statusleiste: 150 ms wie die Cursormeldung der Swift-Version).
export interface Debounced {
    call(): void;
    cancel(): void;
}

export function createDebounced(action: () => void, delayMs: number): Debounced {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
    };
    return {
        call: () => {
            cancel();
            timer = setTimeout(() => {
                timer = null;
                action();
            }, delayMs);
        },
        cancel,
    };
}
