import { useEffect, useRef } from 'react';

export interface FlagChange {
  projectId: string;
  environment?: string;
}

export function useFlagChanges(onChange: (change: FlagChange) => void): void {
  // Ref al callback per non ricreare l'EventSource ad ogni render.
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const es = new EventSource('/admin/events');
    es.onmessage = (ev: MessageEvent) => {
      try {
        const change = JSON.parse(ev.data) as FlagChange;
        cb.current(change);
      } catch {
        // ignora messaggi non-JSON (es. heartbeat, che comunque è un commento e non arriva come onmessage)
      }
    };
    // onerror: EventSource ritenta automaticamente; non chiudiamo.
    return () => es.close();
  }, []);
}
