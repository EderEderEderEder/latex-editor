import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebounced } from '../../src/renderer/app/debounce';

afterEach(() => vi.useRealTimers());

describe('Entprellen', () => {
    it('führt nach der Ruhezeit einmal aus', () => {
        vi.useFakeTimers();
        const action = vi.fn();
        const debounced = createDebounced(action, 150);
        debounced.call();
        vi.advanceTimersByTime(100);
        debounced.call();
        vi.advanceTimersByTime(100);
        expect(action).not.toHaveBeenCalled();
        vi.advanceTimersByTime(50);
        expect(action).toHaveBeenCalledTimes(1);
    });

    it('kann abgebrochen werden', () => {
        vi.useFakeTimers();
        const action = vi.fn();
        const debounced = createDebounced(action, 150);
        debounced.call();
        debounced.cancel();
        vi.advanceTimersByTime(500);
        expect(action).not.toHaveBeenCalled();
    });
});
