import type { RendererApi } from '../shared/contract';

declare global {
    interface Window {
        readonly api: RendererApi;
    }
}
