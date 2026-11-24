import { describe, expect, it } from 'vitest';
import {
    ALL_BUDGETS,
    BUDGET_KEYSTROKE_DOLLAR_P95_MS,
    BUDGET_KEYSTROKE_ENTER_P95_MS,
    BUDGET_KEYSTROKE_MIDDLE_P95_MS,
    BUDGET_KEYSTROKE_START_P95_MS,
    BUDGET_OPEN_MS,
    TARGET_KEYSTROKE_P95_MS,
    TARGET_OPEN_MS,
} from '../perf/budgets';

// Die Budgets selbst sind Konstanten; geprüft wird, dass sie sinnvoll sind (die Messung läuft nur mit `--perf`).

describe('Leistungsbudgets', () => {
    it('sind endlich und größer als null, mit eindeutigen Namen', () => {
        for (const budget of ALL_BUDGETS) {
            expect(Number.isFinite(budget.milliseconds), budget.name).toBe(true);
            expect(budget.milliseconds, budget.name).toBeGreaterThan(0);
        }
        expect(new Set(ALL_BUDGETS.map((budget) => budget.name)).size).toBe(ALL_BUDGETS.length);
    });

    it('jede Tasten-Messung bleibt unter dem Rahmenbudget von 16 ms', () => {
        const keystrokeBudgets = [
            BUDGET_KEYSTROKE_MIDDLE_P95_MS,
            BUDGET_KEYSTROKE_START_P95_MS,
            BUDGET_KEYSTROKE_DOLLAR_P95_MS,
            BUDGET_KEYSTROKE_ENTER_P95_MS,
        ];
        for (const budget of keystrokeBudgets) expect(budget).toBeLessThanOrEqual(TARGET_KEYSTROKE_P95_MS);
        expect(TARGET_KEYSTROKE_P95_MS).toBeLessThanOrEqual(16);
    });

    it('Öffnen bleibt unter 200 ms', () => {
        expect(BUDGET_OPEN_MS).toBeLessThanOrEqual(TARGET_OPEN_MS);
        expect(TARGET_OPEN_MS).toBeLessThanOrEqual(200);
    });
});
