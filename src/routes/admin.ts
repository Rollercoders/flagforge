import { Router } from 'express';
import { nanoid } from 'nanoid';
import { Storage } from '../types';

export function createAdminRouter(storage: Storage) {
  const router = Router();

  // Create a new API key
  router.post('/api-keys', async (req, res) => {
    try {
      const { name, environment } = req.body as { name?: string; environment?: string };

      if (!name || !environment) {
        res.status(400).json({ error: 'name and environment are required' });
        return;
      }

      const key = `rf_${nanoid(32)}`;

      const apiKey = await storage.createApiKey({
        key,
        name,
        environment
      });

      res.status(201).json(apiKey);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  // List all API keys (excluding internal __ui_admin__ key)
  router.get('/api-keys', async (_req, res) => {
    try {
      const apiKeys = await storage.getAllApiKeys();
      res.json(apiKeys.filter(k => k.name !== '__ui_admin__'));
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch API keys' });
    }
  });

  // Delete an API key
  router.delete('/api-keys/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteApiKey(id);
      res.status(204).send();
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete API key' });
    }
  });

  // Return the internal UI admin token
  router.get('/ui-token', async (_req, res) => {
    try {
      const allKeys = await storage.getAllApiKeys();
      const uiKey = allKeys.find(k => k.name === '__ui_admin__');
      if (!uiKey) {
        res.status(404).json({ error: 'UI token not found' });
        return;
      }
      res.json({ key: uiKey.key });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch UI token' });
    }
  });

  return router;
}
