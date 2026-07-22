import { Router } from 'express';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';

export function formatSseMessage(change: FlagChange): string {
  return `data: ${JSON.stringify(change)}\n\n`;
}

export function createAdminEventsRouter(bus: FlagChangeBus): Router {
  const router = Router();

  router.get('/', (req, res) => {
    // Un client che chiude bruscamente (es. abort) può far emettere un evento
    // 'error' sul socket della response: senza un listener diventerebbe un'eccezione
    // non gestita. La chiusura effettiva è comunque gestita da req.on('close') sotto.
    res.on('error', () => {});

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = bus.subscribe((change) => {
      res.write(formatSseMessage(change));
    });

    // Heartbeat: commento SSE per tenere viva la connessione attraverso proxy/timeout.
    const heartbeat = setInterval(() => {
      res.write(':\n\n');
    }, 25_000);
    heartbeat.unref?.();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  return router;
}
