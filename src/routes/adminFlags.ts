import { Router } from 'express';
import { Storage, Flag } from '../types.js';

export function createAdminFlagsRouter(storage: Storage) {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const { key, name, description, targeting, rollout, projectId, environment } = req.body as {
        key: string;
        name: string;
        description?: string;
        targeting?: Flag['targeting'];
        rollout?: Flag['rollout'];
        projectId: string;
        environment: string;
      };
      if (!key || !name || !projectId || !environment) {
        res.status(400).json({ error: 'key, name, projectId and environment are required' });
        return;
      }
      const flags = await storage.createFlag({ projectId, key, name, description, enabled: false, environment, targeting, rollout });
      const flagForEnv = flags.find(f => f.environment === environment);
      if (!flagForEnv) {
        res.status(500).json({ error: 'Internal error: flag not created for expected environment' });
        return;
      }
      res.status(201).json(flagForEnv);
    } catch (_error: any) {
      if (_error.message?.includes('UNIQUE constraint') || _error.message?.includes('already exists')) {
        res.status(409).json({ error: 'Flag with this key already exists in this project' });
      } else {
        res.status(500).json({ error: 'Failed to create flag' });
      }
    }
  });

  router.get('/', async (req, res) => {
    try {
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
      const flags = await storage.getAllFlags(projectId, environment);
      res.json(flags);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flags' });
    }
  });

  router.get('/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      res.json(flag);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flag' });
    }
  });

  router.patch('/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      const updates: Partial<Pick<Flag, 'name' | 'description' | 'enabled' | 'targeting' | 'rollout'>> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.targeting !== undefined) updates.targeting = req.body.targeting;
      if (req.body.rollout !== undefined) updates.rollout = req.body.rollout;
      const updated = await storage.updateFlag(flag.id, updates);
      res.json(updated);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to update flag' });
    }
  });

  router.delete('/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
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
