import { contextBridge } from 'electron';
import type { RendererApi } from '../shared/api';

const api: RendererApi = {
    ping: () => 'pong',
};

contextBridge.exposeInMainWorld('api', api);
