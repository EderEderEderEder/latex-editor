// Typen für Module ohne eigene Typen (W7-2): `nspell` 2.1.5 bringt keine mit, `?url` ist ein Vite-Import (Pfad
// einer gebündelten Datei). Nur, was die Rechtschreibprüfung nutzt.

declare module 'nspell' {
    interface NSpell {
        correct(word: string): boolean;
        suggest(word: string): string[];
    }
    export default function nspell(affix: string, dictionary: string): NSpell;
}

declare module '*?url' {
    const url: string;
    export default url;
}
