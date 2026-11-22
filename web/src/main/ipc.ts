import type { IpcMainInvokeEvent } from 'electron';
import {
    type EventChannel,
    type IpcEvents,
    type IpcResult,
    REQUEST_CHANNELS,
    type RequestChannel,
} from '../shared/contract';
import { fail, ok, toIpcError } from '../shared/ipcResult';
import type { IpcHandlers } from './ipcHandlers';
import { areArgsValid } from './ipcValidation';
import type { PathPlatform } from './paths';
import { isTrustedRendererUrl, type RendererLocation, type SecurityLog } from './security';

// IPC im Main-Prozess: Absenderprüfung, Argumentprüfung, einheitliche Fehler. `ipcMain` kommt
// als Parameter herein (nur Typimport von Electron), damit Vitest mit gefälschten Ereignissen prüft.

export interface SenderFrameLike {
    readonly url: string;
    readonly parent: object | null;
}

export interface InvokeEventLike {
    readonly sender: { readonly id: number };
    readonly senderFrame: SenderFrameLike | null;
}

export interface IpcMainLike {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>): void;
}

export interface SenderPolicy {
    // `null`, solange kein Hauptfenster existiert: dann wird jede Anfrage abgelehnt.
    readonly getTrustedWebContentsId: () => number | null;
    readonly location: RendererLocation;
    readonly platform: PathPlatform;
}

export interface IpcDependencies {
    readonly handlers: IpcHandlers;
    readonly policy: SenderPolicy;
    readonly log: SecurityLog;
}

const FORBIDDEN_SENDER_MESSAGE = 'Absender nicht erlaubt';

// Liefert den Ablehnungsgrund oder `null`, wenn der Absender der Hauptframe des eigenen Fensters ist.
export function senderRejection(event: InvokeEventLike, policy: SenderPolicy): string | null {
    const trustedId = policy.getTrustedWebContentsId();
    if (trustedId === null) return 'kein Hauptfenster';
    if (event.sender.id !== trustedId) return `fremdes webContents ${event.sender.id}`;
    const frame = event.senderFrame;
    if (frame === null) return 'Frame nicht mehr vorhanden';
    if (frame.parent !== null) return 'Anfrage aus einem Unterframe';
    if (!isTrustedRendererUrl(frame.url, policy.location, policy.platform)) return `URL nicht erlaubt: ${frame.url}`;
    return null;
}

async function callHandler(handlers: IpcHandlers, channel: RequestChannel, args: readonly unknown[]): Promise<unknown> {
    // Die Argumente sind durch `areArgsValid` geprüft; der Aufruf über die Kanal-Union braucht die Umwandlung.
    const handler = handlers[channel] as (...handlerArgs: readonly unknown[]) => Promise<unknown>;
    return handler(...args);
}

export async function dispatchRequest(
    channel: RequestChannel,
    event: InvokeEventLike,
    args: readonly unknown[],
    deps: IpcDependencies,
): Promise<IpcResult<unknown>> {
    const rejection = senderRejection(event, deps.policy);
    if (rejection !== null) {
        deps.log(`IPC „${channel}“ abgelehnt: ${rejection}`);
        return fail({ kind: 'forbiddenSender', message: FORBIDDEN_SENDER_MESSAGE });
    }
    if (!areArgsValid(channel, args)) {
        return fail({ kind: 'invalidInput', message: `Ungültige Argumente für „${channel}“` });
    }
    try {
        return ok(await callHandler(deps.handlers, channel, args));
    } catch (error) {
        const ipcError = toIpcError(error);
        if (ipcError.kind === 'internal') deps.log(`IPC „${channel}“: ${ipcError.message}`);
        return fail(ipcError);
    }
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcDependencies): void {
    for (const channel of REQUEST_CHANNELS) {
        ipcMain.handle(channel, (event, ...args) => dispatchRequest(channel, event, args, deps));
    }
}

export interface EventTargetLike {
    isDestroyed(): boolean;
    send(channel: string, ...args: unknown[]): void;
}

export type EventSender = <E extends EventChannel>(event: E, payload: IpcEvents[E]) => void;

// Typisiertes Senden an das Hauptfenster; ohne Fenster geht das Ereignis verloren (gewollt).
export function createEventSender(getTarget: () => EventTargetLike | null): EventSender {
    return (event, payload) => {
        const target = getTarget();
        if (target === null || target.isDestroyed()) return;
        target.send(event, payload);
    };
}
