import { Router } from 'express';
import { nanoid } from 'nanoid';
import { Storage } from '../types';

export function createAdminRouter(storage: Storage) {
  const router = Router();

  router.post('/api-keys', async (req, res) => {
    try {
      const { name, environment, projectId } = req.body as { name?: string; environment?: string; projectId?: string };
      if (!name || !environment || !projectId) {
        res.status(400).json({ error: 'name, environment, and projectId are required' });
        return;
      }
      if (projectId === '__admin__') {
        res.status(400).json({ error: 'Reserved projectId' });
        return;
      }
      const key = `rf_${nanoid(32)}`;
      const apiKey = await storage.createApiKey({ key, name, environment, projectId });
      res.status(201).json(apiKey);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  router.get('/api-keys', async (req, res) => {
    try {
      const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
      const apiKeys = await storage.getAllApiKeys(projectId);
      res.json(apiKeys.filter(k => k.name !== '__ui_admin__'));
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch API keys' });
    }
  });

  router.delete('/api-keys/:id', async (req, res) => {
    try {
      await storage.deleteApiKey(req.params.id);
      res.status(204).send();
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete API key' });
    }
  });

  router.get('/ui-token', async (_req, res) => {
    try {
      const allKeys = await storage.getAllApiKeys();
      const uiKey = allKeys.find(k => k.name === '__ui_admin__');
      if (!uiKey) { res.status(404).json({ error: 'UI token not found' }); return; }
      res.json({ key: uiKey.key });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch UI token' });
    }
  });

  return router;
}
