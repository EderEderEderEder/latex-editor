// Minimale Typen für nspell 2.1.5 (bringt keine mit; nur im Spike, nicht in web/package.json).
declare module 'nspell' {
    import type { Hunspell } from './checker';
    export default function nspell(aff: string, dic: string): Hunspell;
}
