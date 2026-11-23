// Variante A: `StreamLanguage` (CodeMirror verwaltet Zustände, Baum und Hintergrund-Parsen).
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { StringStream } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { NORMAL_STATE, beginLine, endLine, scanToken } from './tokenizer';
import type { LexState, TokenKind } from './tokenizer';

interface StreamState {
    lex: LexState;
}

const STYLE_BY_KIND: Record<TokenKind, string> = {
    command: 'keyword',
    delimiter: 'bracket',
    keyArgument: 'labelName',
    math: 'string',
    comment: 'comment',
    verbatim: 'monospace',
};

function readToken(stream: StringStream, state: StreamState): string | null {
    if (stream.sol()) state.lex = beginLine(stream.string, state.lex);
    const scanned = scanToken(stream.string, stream.pos, state.lex);
    stream.pos = scanned.end;
    state.lex = stream.eol() ? endLine(scanned.state) : scanned.state;
    return scanned.kind === null ? null : STYLE_BY_KIND[scanned.kind];
}

const latexStream = StreamLanguage.define<StreamState>({
    name: 'latex-spike',
    startState: () => ({ lex: NORMAL_STATE }),
    token: readToken,
    blankLine: (state) => {
        state.lex = beginLine('', state.lex);
    },
    copyState: (state) => ({ lex: state.lex }),
});

const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#1f5fbf' },
    { tag: tags.bracket, color: '#8a5a00' },
    { tag: tags.labelName, color: '#6b3fa0' },
    { tag: tags.string, color: '#0b7a3e' },
    { tag: tags.comment, color: '#888888', fontStyle: 'italic' },
    { tag: tags.monospace, color: '#a0303a' },
]);

export function streamLanguageExtension(): Extension {
    return [latexStream, syntaxHighlighting(highlightStyle)];
}
