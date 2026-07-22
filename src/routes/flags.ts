import { Router, Response } from 'express';
import { Storage, Flag } from '../types';
import { AuthRequest } from '../middleware/auth';

export function createFlagsRouter(storage: Storage) {
  const router = Router();

  // Le API key di environment sono di sola lettura: bloccano ogni scrittura
  // sui flag prima di raggiungere gli handler. La scrittura resta disponibile
  // solo tramite la sessione admin (UI). Gli handler di scrittura sono lasciati
  // intatti sotto la guardia: verranno riabilitati quando esisteranno API key
  // con permessi di scrittura dedicati.
  const denyWrites = (_req: AuthRequest, res: Response) => {
    res.status(403).json({ error: 'API keys are read-only; use the admin UI to modify flags' });
  };
  router.post('/', denyWrites);
  router.patch('/:key', denyWrites);
  router.delete('/:key', denyWrites);

  router.post('/', async (req: AuthRequest, res) => {
    try {
      const { key, name, description, targeting, rollout } = req.body;
      if (!key || !name) {
        res.status(400).json({ error: 'key and name are required' });
        return;
      }
      const { projectId: tokenProjectId, environment: tokenEnvironment } = req.apiKey!;
      const projectId = tokenProjectId === '__admin__' && typeof req.body['projectId'] === 'string'
        ? req.body['projectId']
        : tokenProjectId;
      const environment = tokenProjectId === '__admin__' && typeof req.body['environment'] === 'string'
        ? req.body['environment']
        : tokenEnvironment;
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

  router.get('/', async (req: AuthRequest, res) => {
    try {
      const { projectId: tokenProjectId, environment: tokenEnvironment } = req.apiKey!;
      // Admin UI token allows scoping by query params; regular API keys use their own projectId/environment
      const projectId = tokenProjectId === '__admin__' && typeof req.query['projectId'] === 'string'
        ? req.query['projectId']
        : tokenProjectId;
      const environment = tokenProjectId === '__admin__' && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : tokenEnvironment;
      const flags = await storage.getAllFlags(projectId, environment);
      res.json(flags);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flags' });
    }
  });

  router.get('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const { projectId: tokenProjectId, environment: tokenEnvironment } = req.apiKey!;
      const projectId = tokenProjectId === '__admin__' && typeof req.query['projectId'] === 'string'
        ? req.query['projectId']
        : tokenProjectId;
      const environment = tokenProjectId === '__admin__' && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : tokenEnvironment;
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
      const { projectId: tokenProjectId, environment: tokenEnvironment } = req.apiKey!;
      const projectId = tokenProjectId === '__admin__' && typeof req.query['projectId'] === 'string'
        ? req.query['projectId']
        : tokenProjectId;
      const environment = tokenProjectId === '__admin__' && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : tokenEnvironment;
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

  router.delete('/:key', async (req: AuthRequest, res) => {
    try {
      const { key } = req.params;
      const { projectId: tokenProjectId, environment: tokenEnvironment } = req.apiKey!;
      const projectId = tokenProjectId === '__admin__' && typeof req.query['projectId'] === 'string'
        ? req.query['projectId']
        : tokenProjectId;
      const environment = tokenProjectId === '__admin__' && typeof req.query['environment'] === 'string'
        ? req.query['environment']
        : tokenEnvironment;
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
