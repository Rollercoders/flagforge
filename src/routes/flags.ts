import { Router } from 'express';
import { Storage } from '../types';
import { AuthRequest } from '../middleware/auth';

export function createFlagsRouter(storage: Storage) {
  const router = Router();

  router.post('/', async (req: AuthRequest, res) => {
    try {
      const { key, name, description, targeting, rollout } = req.body;
      if (!key || !name) {
        res.status(400).json({ error: 'key and name are required' });
        return;
      }
      const { projectId, environment } = req.apiKey!;
      const flags = await storage.createFlag({ projectId, key, name, description, enabled: false, environment, targeting, rollout });
      const flagForEnv = flags.find(f => f.environment === environment) ?? flags[0];
      res.status(201).json(flagForEnv);
    } catch (_error: any) {
      if (_error.message?.includes('UNIQUE constraint') || _error.message?.includes('already exists')) {
        res.status(409).json({ error: 'Flag with this key already exists in this project' });
      } else {
        res.status(500).json({ error: 'Failed to create flag' });
      }
    }
  });

  router.get('/', async (req: AuthRequest, res) => {
    try {
      const { projectId, environment } = req.apiKey!;
      const flags = await storage.getAllFlags(projectId, environment);
      res.json(flags);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flags' });
    }
  });

  router.get('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const { projectId, environment } = req.apiKey!;
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      res.json(flag);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flag' });
    }
  });

  router.patch('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const { projectId, environment } = req.apiKey!;
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      const { name, description, enabled, targeting, rollout } = req.body;
      const updated = await storage.updateFlag(flag.id, { name, description, enabled, targeting, rollout });
      res.json(updated);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to update flag' });
    }
  });

  router.delete('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const { projectId, environment } = req.apiKey!;
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      await storage.deleteFlag(projectId, key);
      res.status(204).send();
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete flag' });
    }
  });

  return router;
}
