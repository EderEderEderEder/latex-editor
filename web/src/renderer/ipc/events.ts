import type { EventChannel, EventListener, Unsubscribe } from '../../shared/contract';

// Abonniert ein Ereignis des Main-Prozesses; die zurückgegebene Funktion meldet wieder ab
// (z. B. als Aufräumfunktion eines `useEffect`).
export function onMainEvent<E extends EventChannel>(event: E, listener: EventListener<E>): Unsubscribe {
    return window.api.events.on(event, listener);
}
