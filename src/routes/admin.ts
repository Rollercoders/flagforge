import { Router } from 'express';
import { Storage } from '../types.js';

export function createAdminRouter(storage: Storage) {
  const router = Router();

  router.get('/ui-token', async (_req, res) => {
    try {
      const key = await storage.getAdminKey();
      if (!key) { res.status(404).json({ error: 'UI token not found' }); return; }
      res.json({ key });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch UI token' });
    }
  });

  router.post('/environments/:envId/regenerate-key', async (req, res) => {
    try {
      const role = req.body?.role === 'secret' ? 'secret' : 'client';
      const env = await storage.regenerateEnvironmentKey(req.params.envId, role);
      res.json(env);
    } catch (_error: any) {
      if (_error.message === 'Environment not found') {
        res.status(404).json({ error: 'Environment not found' });
      } else {
        res.status(500).json({ error: 'Failed to regenerate key' });
      }
    }
  });

  return router;
}
