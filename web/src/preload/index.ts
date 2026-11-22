import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from 'electron';
import { type ApiTransport, buildRendererApi } from '../shared/apiBuilder';
import type { IpcResult } from '../shared/contract';

// Das IpcRendererEvent enthält `sender` (= ipcRenderer) und darf nie in den Renderer gelangen;
// weitergereicht wird nur die Nutzlast.
const transport: ApiTransport = {
    invoke: (channel, args) => ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<unknown>>,
    subscribe: (event, listener) => {
        const forward = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
        ipcRenderer.on(event, forward);
        return () => {
            ipcRenderer.removeListener(event, forward);
        };
    },
    getPathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('api', buildRendererApi(transport));
