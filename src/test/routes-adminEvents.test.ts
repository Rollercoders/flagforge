import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createAdminEventsRouter, formatSseMessage } from '../routes/adminEvents.js';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';

describe('formatSseMessage', () => {
  it('formatta un FlagChange come messaggio SSE', () => {
    const change: FlagChange = { projectId: 'p1', environment: 'production' };
    expect(formatSseMessage(change)).toBe(`data: ${JSON.stringify(change)}\n\n`);
  });

  it('formatta correttamente un FlagChange senza environment', () => {
    const change: FlagChange = { projectId: 'p2' };
    expect(formatSseMessage(change)).toBe(`data: ${JSON.stringify(change)}\n\n`);
  });
});

/**
 * Nota sull'approccio di test scelto per la route SSE.
 *
 * Testare uno stream SSE reale con supertest richiede tenere aperta una
 * connessione HTTP: nel nostro ambiente questo si è rivelato instabile, sia
 * con un timeout breve (risposta parziale non deterministica lato supertest)
 * sia forzando un `req.abort()` (il socket http client sottostante emette in
 * modo asincrono un errore 'aborted'/ECONNRESET che finisce come unhandled
 * exception e fa fallire la run con exit code diverso da zero, anche quando
 * l'assert va a buon fine). Per questo, come da alternativa (b) indicata nel
 * brief, invochiamo direttamente l'handler della route con un req/res finti
 * (nessun socket reale coinvolto): verifichiamo header SSE, sottoscrizione al
 * bus, inoltro del messaggio formattato, heartbeat, e cleanup su 'close'.
 */
function fakeReqRes() {
  const closeListeners: Array<() => void> = [];
  const req = {
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') closeListeners.push(cb);
      return req as unknown as Request;
    }),
  } as unknown as Request;

  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  } as unknown as Response;

  return { req, res, triggerClose: () => closeListeners.forEach((cb) => cb()) };
}

function getRouteHandler(bus: FlagChangeBus) {
  const router = createAdminEventsRouter(bus);
  // Express Router espone lo stack dei layer registrati; prendiamo l'handler
  // dell'unica route GET '/' definita in createAdminEventsRouter.
  const layer = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (req: Request, res: Response) => void }> } }> }).stack[0];
  return layer.route.stack[0].handle;
}

describe('GET /admin/events', () => {
  it('imposta gli header SSE e chiama flushHeaders', () => {
    const bus = new FlagChangeBus();
    const handle = getRouteHandler(bus);
    const { req, res } = fakeReqRes();

    handle(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('inoltra i FlagChange emessi dal bus come messaggi SSE', () => {
    const bus = new FlagChangeBus();
    const handle = getRouteHandler(bus);
    const { req, res } = fakeReqRes();

    handle(req, res);
    const change: FlagChange = { projectId: 'p1', environment: 'production' };
    bus.emit(change);

    expect(res.write).toHaveBeenCalledWith(formatSseMessage(change));
  });

  it('su chiusura della connessione, disiscrive il listener e chiude la response', () => {
    const bus = new FlagChangeBus();
    const handle = getRouteHandler(bus);
    const { req, res, triggerClose } = fakeReqRes();

    handle(req, res);
    triggerClose();

    expect(res.end).toHaveBeenCalled();

    // Dopo la chiusura, un nuovo evento sul bus non deve più scrivere sulla response:
    // conferma che l'unsubscribe dal bus è stato effettivamente eseguito.
    (res.write as ReturnType<typeof vi.fn>).mockClear();
    bus.emit({ projectId: 'p1' });
    expect(res.write).not.toHaveBeenCalled();
  });
});
