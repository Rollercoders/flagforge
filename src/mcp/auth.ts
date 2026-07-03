import { timingSafeEqual } from 'crypto';
import type { RequestHandler } from 'express';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function mcpBearerAuth(token: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const provided = header.slice('Bearer '.length);
    if (!safeEqual(provided, token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
