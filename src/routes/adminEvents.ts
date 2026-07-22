import { Router } from 'express';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';

export function formatSseMessage(change: FlagChange): string {
  return `data: ${JSON.stringify(change)}\n\n`;
}

export function createAdminEventsRouter(bus: FlagChangeBus): Router {
  const router = Router();

  router.get('/', (req, res) => {
    // A client that closes abruptly (e.g. abort) can cause an 'error' event to be
    // emitted on the response socket: without a listener it would become an
    // unhandled exception. The actual close is still handled by req.on('close') below.
    res.on('error', () => {});

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = bus.subscribe((change) => {
      res.write(formatSseMessage(change));
    });

    // Heartbeat: SSE comment to keep the connection alive across proxies/timeouts.
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
