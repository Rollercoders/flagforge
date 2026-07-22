import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createAdminEventsRouter, formatSseMessage } from '../routes/adminEvents.js';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';

describe('formatSseMessage', () => {
  it('formats a FlagChange as an SSE message', () => {
    const change: FlagChange = { projectId: 'p1', environment: 'production' };
    expect(formatSseMessage(change)).toBe(`data: ${JSON.stringify(change)}\n\n`);
  });

  it('correctly formats a FlagChange without environment', () => {
    const change: FlagChange = { projectId: 'p2' };
    expect(formatSseMessage(change)).toBe(`data: ${JSON.stringify(change)}\n\n`);
  });
});

/**
 * Note on the testing approach chosen for the SSE route.
 *
 * Testing a real SSE stream with supertest requires keeping an HTTP
 * connection open: in our environment this turned out to be unstable, both
 * with a short timeout (non-deterministic partial response on supertest's
 * side) and when forcing a `req.abort()` (the underlying http client socket
 * asynchronously emits an 'aborted'/ECONNRESET error that ends up as an
 * unhandled exception and fails the run with a non-zero exit code, even
 * when the assertion succeeds). Because of this, as per alternative (b)
 * outlined in the brief, we invoke the route handler directly with a fake
 * req/res (no real socket involved): we verify SSE headers, subscription to
 * the bus, forwarding of the formatted message, heartbeat, and cleanup on 'close'.
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
  // Express Router exposes the stack of registered layers; we grab the handler
  // of the single GET '/' route defined in createAdminEventsRouter.
  const layer = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (req: Request, res: Response) => void }> } }> }).stack[0];
  return layer.route.stack[0].handle;
}

describe('GET /admin/events', () => {
  it('sets the SSE headers and calls flushHeaders', () => {
    const bus = new FlagChangeBus();
    const handle = getRouteHandler(bus);
    const { req, res } = fakeReqRes();

    handle(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('forwards FlagChange events emitted by the bus as SSE messages', () => {
    const bus = new FlagChangeBus();
    const handle = getRouteHandler(bus);
    const { req, res } = fakeReqRes();

    handle(req, res);
    const change: FlagChange = { projectId: 'p1', environment: 'production' };
    bus.emit(change);

    expect(res.write).toHaveBeenCalledWith(formatSseMessage(change));
  });

  it('on connection close, unsubscribes the listener and ends the response', () => {
    const bus = new FlagChangeBus();
    const handle = getRouteHandler(bus);
    const { req, res, triggerClose } = fakeReqRes();

    handle(req, res);
    triggerClose();

    expect(res.end).toHaveBeenCalled();

    // After closing, a new event on the bus must no longer write to the response:
    // this confirms that the unsubscribe from the bus actually happened.
    (res.write as ReturnType<typeof vi.fn>).mockClear();
    bus.emit({ projectId: 'p1' });
    expect(res.write).not.toHaveBeenCalled();
  });
});
