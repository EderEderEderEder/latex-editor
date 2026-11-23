import type { EventChannel, EventListener, Unsubscribe } from '../../shared/contract';
import { getApi } from './api';

// Abonniert ein Ereignis des Main-Prozesses; die zurückgegebene Funktion meldet wieder ab
// (z. B. als Aufräumfunktion eines `useEffect`).
export function onMainEvent<E extends EventChannel>(event: E, listener: EventListener<E>): Unsubscribe {
    return getApi().events.on(event, listener);
}
