import { Request, Response, NextFunction } from 'express';

export type SessionStore = Map<string, Date>; // token → expiresAt

export function requireAdminSession(sessions: SessionStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = (req.cookies as Record<string, string | undefined>)?.rf_session;

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const expiresAt = sessions.get(token);

    if (!expiresAt) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (expiresAt <= new Date()) {
      sessions.delete(token);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}
