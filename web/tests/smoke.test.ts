import { describe, expect, it } from 'vitest';
import config from '../vitest.config';

describe('Gerüst', () => {
    it('lädt die Vitest-Konfiguration mit Node-Umgebung', () => {
        expect(config.test?.environment).toBe('node');
    });
});
