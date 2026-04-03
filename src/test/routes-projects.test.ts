import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { SqliteStorage } from '../storage/sqlite';
import { createProjectsRouter } from '../routes/projects';
import * as fs from 'fs';
import * as path from 'path';

describe('Projects Routes', () => {
  let app: Express;
  let storage: SqliteStorage;
  const testDbPath = path.join(__dirname, '../../test-data/routes-projects-test.db');

  beforeEach(async () => {
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storage = new SqliteStorage(testDbPath);
    await storage.initialize();
    app = express();
    app.use(express.json());
    app.use('/admin', createProjectsRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('POST /admin/projects', () => {
    it('should create a project', async () => {
      const res = await request(app).post('/admin/projects').send({ name: 'my-app' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('my-app');
      expect(res.body.id).toBeDefined();
    });

    it('should return 400 when name is missing', async () => {
      const res = await request(app).post('/admin/projects').send({});
      expect(res.status).toBe(400);
    });

    it('should return 409 for duplicate name', async () => {
      await request(app).post('/admin/projects').send({ name: 'my-app' });
      const res = await request(app).post('/admin/projects').send({ name: 'my-app' });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /admin/projects', () => {
    it('should list all projects', async () => {
      await request(app).post('/admin/projects').send({ name: 'a' });
      await request(app).post('/admin/projects').send({ name: 'b' });
      const res = await request(app).get('/admin/projects');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe('DELETE /admin/projects/:id', () => {
    it('should delete a project and cascade to environments, flags, and api keys', async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'doomed' });
      const projectId: string = proj.body.id;
      await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'prod' });
      await storage.createApiKey({ key: 'rf_doomed', name: 'Doomed Key', environment: 'prod', projectId });
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'prod' });

      const res = await request(app).delete(`/admin/projects/${projectId}`);
      expect(res.status).toBe(204);

      const envs = await storage.getEnvironmentsByProject(projectId);
      expect(envs).toHaveLength(0);
      const flags = await storage.getAllFlags(projectId);
      expect(flags).toHaveLength(0);
      const keys = await storage.getAllApiKeys(projectId);
      expect(keys).toHaveLength(0);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await request(app).delete('/admin/projects/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /admin/projects/:id/environments', () => {
    it('should list environments for a project', async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'my-app' });
      await request(app).post(`/admin/projects/${proj.body.id}/environments`).send({ name: 'staging' });
      const res = await request(app).get(`/admin/projects/${proj.body.id}/environments`);
      expect(res.status).toBe(200);
      // "Production" is auto-created on project creation, plus the one we added
      expect(res.body).toHaveLength(2);
      const names = res.body.map((e: { name: string }) => e.name);
      expect(names).toContain('staging');
      expect(names).toContain('Production');
    });
  });

  describe('POST /admin/projects/:id/environments', () => {
    let projectId: string;

    beforeEach(async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'my-app' });
      projectId = proj.body.id;
    });

    it('should create an environment', async () => {
      const res = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'production' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('production');
      expect(res.body.projectId).toBe(projectId);
    });

    it('should return 400 when name is missing', async () => {
      const res = await request(app).post(`/admin/projects/${projectId}/environments`).send({});
      expect(res.status).toBe(400);
    });

    it('should return 409 for duplicate env name', async () => {
      await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'prod' });
      const res = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'prod' });
      expect(res.status).toBe(409);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await request(app).post('/admin/projects/nonexistent-id/environments').send({ name: 'prod' });
      expect(res.status).toBe(404);
    });

    it('should create flag rows for existing flags when adding an environment', async () => {
      await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'staging' });
      await storage.createApiKey({ key: 'rf_test', name: 'test', environment: 'staging', projectId });
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'staging' });

      const res = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'production' });
      expect(res.status).toBe(201);

      const flag = await storage.getFlag(projectId, 'feat', 'production');
      expect(flag).not.toBeNull();
      expect(flag?.enabled).toBe(false);
      expect(flag?.key).toBe('feat');
      expect(flag?.name).toBe('Feature');
      expect(flag?.projectId).toBe(projectId);
    });
  });

  describe('DELETE /admin/projects/:id/environments/:envId', () => {
    it('should delete an environment and cascade to its flags and api keys', async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'my-app' });
      const projectId: string = proj.body.id;
      const env = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'staging' });
      const envId: string = env.body.id;
      await storage.createApiKey({ key: 'rf_staging', name: 'Staging Key', environment: 'staging', projectId });
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'staging' });

      const res = await request(app).delete(`/admin/projects/${projectId}/environments/${envId}`);
      expect(res.status).toBe(204);

      const envs = await storage.getEnvironmentsByProject(projectId);
      // "Production" is auto-created; only "staging" was deleted
      expect(envs.find(e => e.name === 'staging')).toBeUndefined();
      const flag = await storage.getFlag(projectId, 'feat', 'staging');
      expect(flag).toBeNull();
      const keys = await storage.getAllApiKeys(projectId);
      expect(keys).toHaveLength(0);
    });

    it('should return 404 for non-existent or wrong-project envId', async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'my-app' });
      const res = await request(app).delete(`/admin/projects/${proj.body.id}/environments/nonexistent-id`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /admin/projects/:id/environments/:envId', () => {
    let projectId: string;
    let envId: string;

    beforeEach(async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'rename-test' });
      projectId = proj.body.id;
      // POST /projects auto-creates "Production"; create an additional "staging" env
      const env = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'staging' });
      envId = env.body.id;
    });

    it('should rename an environment and return the updated object', async () => {
      const res = await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: 'qa' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(envId);
      expect(res.body.name).toBe('qa');
      expect(res.body.projectId).toBe(projectId);
    });

    it('should cascade the rename to flag rows', async () => {
      await storage.createFlag({ projectId, key: 'my-flag', name: 'My Flag', enabled: false, environment: 'staging' });
      await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: 'qa' });
      const flag = await storage.getFlag(projectId, 'my-flag', 'qa');
      expect(flag).not.toBeNull();
      expect(flag?.environment).toBe('qa');
      const oldFlag = await storage.getFlag(projectId, 'my-flag', 'staging');
      expect(oldFlag).toBeNull();
    });

    it('should cascade the rename to api_key rows', async () => {
      await storage.createApiKey({ key: 'rf_staging123', name: 'Staging Key', environment: 'staging', projectId });
      await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: 'qa' });
      const keys = await storage.getAllApiKeys(projectId);
      const renamed = keys.find(k => k.name === 'Staging Key');
      expect(renamed?.environment).toBe('qa');
    });

    it('should return 400 when name is missing', async () => {
      const res = await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({});
      expect(res.status).toBe(400);
    });

    it('should return 400 when name is blank', async () => {
      const res = await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: '   ' });
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent envId', async () => {
      const res = await request(app).patch(`/admin/projects/${projectId}/environments/does-not-exist`).send({ name: 'x' });
      expect(res.status).toBe(404);
    });

    it('should return 404 when envId belongs to a different project', async () => {
      const otherProj = await request(app).post('/admin/projects').send({ name: 'other-project' });
      const res = await request(app).patch(`/admin/projects/${otherProj.body.id}/environments/${envId}`).send({ name: 'x' });
      expect(res.status).toBe(404);
    });

    it('should return 409 when the new name already exists in the same project', async () => {
      const res = await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: 'Production' });
      expect(res.status).toBe(409);
    });

    it('should allow renaming to the same name', async () => {
      const res = await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: 'staging' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('staging');
    });
  });
});
