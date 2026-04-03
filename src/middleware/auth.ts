import { Request, Response, NextFunction } from 'express';
import { Storage } from '../types.js';

export interface AuthRequest extends Request {
  apiKey?: {
    id: string;
    name: string;
    projectId: string;
    environment: string;
  };
}

export function createAuthMiddleware(storage: Storage) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }
    const token = authHeader.substring(7);
    try {
      const env = await storage.getEnvironmentByKey(token);
      if (!env) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }
      req.apiKey = { id: env.id, name: env.name, projectId: env.projectId, environment: env.name };
      next();
    } catch (_error) {
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}
