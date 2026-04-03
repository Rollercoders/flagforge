import { Router } from 'express';
import { Storage } from '../types.js';

export function createProjectsRouter(storage: Storage) {
  const router = Router();

  router.post('/projects', async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }
      const project = await storage.createProject({ name });
      await storage.createEnvironment({ projectId: project.id, name: 'Production' });
      res.status(201).json(project);
    } catch (_error: any) {
      if (_error.message?.includes('UNIQUE constraint') || _error.message?.includes('already exists')) {
        res.status(409).json({ error: 'Project name already exists' });
      } else {
        res.status(500).json({ error: 'Failed to create project' });
      }
    }
  });

  router.get('/projects', async (_req, res) => {
    try {
      res.json(await storage.getAllProjects());
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  });

  router.delete('/projects/:id', async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
      await storage.deleteProject(req.params.id);
      res.status(204).send();
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  router.get('/projects/:id/environments', async (req, res) => {
    try {
      res.json(await storage.getEnvironmentsByProject(req.params.id));
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch environments' });
    }
  });

  router.post('/projects/:id/environments', async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
      const env = await storage.createEnvironment({ projectId, name });
      res.status(201).json(env);
    } catch (_error: any) {
      if (_error.message?.includes('UNIQUE constraint') || _error.message?.includes('already exists')) {
        res.status(409).json({ error: 'Environment already exists in this project' });
      } else {
        res.status(500).json({ error: 'Failed to create environment' });
      }
    }
  });

  router.delete('/projects/:id/environments/:envId', async (req, res) => {
    try {
      const envs = await storage.getEnvironmentsByProject(req.params.id);
      const env = envs.find(e => e.id === req.params.envId);
      if (!env) { res.status(404).json({ error: 'Environment not found' }); return; }
      await storage.deleteEnvironment(req.params.envId);
      res.status(204).send();
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete environment' });
    }
  });

  router.patch('/projects/:id/environments/:envId', async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
      const envs = await storage.getEnvironmentsByProject(req.params.id);
      const env = envs.find(e => e.id === req.params.envId);
      if (!env) { res.status(404).json({ error: 'Environment not found' }); return; }
      const updated = await storage.renameEnvironment(req.params.envId, name.trim());
      res.json(updated);
    } catch (_error: any) {
      if (_error.message?.includes('UNIQUE constraint') || _error.message?.includes('already exists')) {
        res.status(409).json({ error: 'Environment name already exists in this project' });
      } else {
        res.status(500).json({ error: 'Failed to rename environment' });
      }
    }
  });

  return router;
}
