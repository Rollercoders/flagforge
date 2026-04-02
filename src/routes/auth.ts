import { Router } from 'express';
import { nanoid } from 'nanoid';
import { timingSafeEqual } from 'crypto';
import { SessionStore } from '../middleware/adminAuth.js';

export function createAuthRouter(sessions: SessionStore) {
  const router = Router();

  const isSecure = process.env.NODE_ENV === 'production';

  router.post('/login', (req, res): void => {
    const { password } = req.body as { password?: string };

    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const adminPassword = process.env.ADMIN_PASSWORD ?? '';

    // Constant-time comparison to prevent timing attacks
    let passwordsMatch = false;
    try {
      const a = Buffer.from(password);
      const b = Buffer.from(adminPassword);
      passwordsMatch = a.length === b.length && timingSafeEqual(a, b);
    } catch {
      passwordsMatch = false;
    }

    if (!passwordsMatch) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    const token = nanoid(48);
    const expiresAt = new Date(Date.now() + 86400000); // 24h
    sessions.set(token, expiresAt);

    res.cookie('rf_session', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 86400000,
    });

    res.json({ ok: true });
  });

  router.post('/logout', (req, res): void => {
    const token: unknown = (req.cookies as Record<string, unknown>).rf_session;
    if (token && typeof token === 'string') {
      sessions.delete(token);
    }
    res.clearCookie('rf_session');
    res.json({ ok: true });
  });

  router.get('/me', (req, res): void => {
    const token: unknown = (req.cookies as Record<string, unknown>).rf_session;

    if (!token || typeof token !== 'string') {
      res.json({ authenticated: false });
      return;
    }

    const expiresAt = sessions.get(token);

    if (!expiresAt || expiresAt <= new Date()) {
      if (typeof token === 'string') sessions.delete(token);
      res.json({ authenticated: false });
      return;
    }

    res.json({ authenticated: true });
  });

  return router;
}
