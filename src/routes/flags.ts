import { Router } from 'express';
import { Storage } from '../types';
import { AuthRequest } from '../middleware/auth';

export function createFlagsRouter(storage: Storage) {
  const router = Router();

  // Create a new flag
  router.post('/', async (req: AuthRequest, res) => {
    try {
      const { key, name, description, enabled, targeting, rollout } = req.body;

      if (!key || !name) {
        res.status(400).json({ error: 'key and name are required' });
        return;
      }

      const isAdmin = req.apiKey!.environment === '__admin__';
      const environment = isAdmin
        ? (req.body.environment as string | undefined) ?? '__admin__'
        : req.apiKey!.environment;

      const projectId = req.apiKey!.projectId ?? '';
      const flags = await storage.createFlag({
        projectId,
        key,
        name,
        description,
        enabled: enabled ?? false,
        environment,
        targeting,
        rollout
      });

      const flag = flags.find(f => f.environment === environment) ?? flags[0];
      res.status(201).json(flag);
    } catch (_error: any) {
      if (_error.message?.includes('UNIQUE constraint')) {
        res.status(409).json({ error: 'Flag with this key already exists in this environment' });
      } else {
        res.status(500).json({ error: 'Failed to create flag' });
      }
    }
  });

  // Get all flags
  router.get('/', async (req: AuthRequest, res) => {
    try {
      const isAdmin = req.apiKey!.environment === '__admin__';
      const environment = isAdmin && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : req.apiKey!.environment;
      const projectId = req.apiKey!.projectId ?? '';
      const flags = await storage.getAllFlags(projectId, environment);
      res.json(flags);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flags' });
    }
  });

  // Get a specific flag
  router.get('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const isAdmin = req.apiKey!.environment === '__admin__';
      const environment = isAdmin && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : req.apiKey!.environment;

      const projectId = req.apiKey!.projectId ?? '';
      const flag = await storage.getFlag(projectId, key, environment);

      if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
      }

      res.json(flag);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flag' });
    }
  });

  // Update a flag
  router.patch('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const isAdmin = req.apiKey!.environment === '__admin__';
      const environment = isAdmin && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : req.apiKey!.environment;

      const projectId = req.apiKey!.projectId ?? '';
      const flag = await storage.getFlag(projectId, key, environment);

      if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
      }

      const { name, description, enabled, targeting, rollout } = req.body;

      const updated = await storage.updateFlag(flag.id, {
        name,
        description,
        enabled,
        targeting,
        rollout
      });

      res.json(updated);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to update flag' });
    }
  });

  // Delete a flag
  router.delete('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const isAdmin = req.apiKey!.environment === '__admin__';
      const environment = isAdmin && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : req.apiKey!.environment;

      const projectId = req.apiKey!.projectId ?? '';
      const flag = await storage.getFlag(projectId, key, environment);

      if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
      }

      await storage.deleteFlag(projectId, key);
      res.status(204).send();
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete flag' });
    }
  });

  return router;
}
