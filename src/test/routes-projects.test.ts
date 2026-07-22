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
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const dir = path.dirname(testDbPath);
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
    it('should delete a project and cascade to environments and flags', async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'doomed' });
      const projectId: string = proj.body.id;
      await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'prod' });
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'prod' });

      const res = await request(app).delete(`/admin/projects/${projectId}`);
      expect(res.status).toBe(204);

      const envs = await storage.getEnvironmentsByProject(projectId);
      expect(envs).toHaveLength(0);
      const flags = await storage.getAllFlags(projectId);
      expect(flags).toHaveLength(0);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await request(app).delete('/admin/projects/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /admin/projects/:id/environments', () => {
    it('should list environments with ff_ keys for a project', async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'my-app' });
      await request(app).post(`/admin/projects/${proj.body.id}/environments`).send({ name: 'staging' });
      const res = await request(app).get(`/admin/projects/${proj.body.id}/environments`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2); // Production (auto) + staging
      expect(res.body.every((e: { key: string }) => e.key.startsWith('ff_'))).toBe(true);
    });
  });

  describe('POST /admin/projects/:id/environments', () => {
    let projectId: string;

    beforeEach(async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'my-app' });
      projectId = proj.body.id;
    });

    it('should create an environment and return a ff_ key', async () => {
      const res = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'production' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('production');
      expect(res.body.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
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
      const stagingRes = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'staging' });
      const stagingEnvName: string = stagingRes.body.name;
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: stagingEnvName });

      const res = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'production' });
      expect(res.status).toBe(201);

      const flag = await storage.getFlag(projectId, 'feat', 'production');
      expect(flag).not.toBeNull();
      expect(flag?.enabled).toBe(false);
    });
  });

  describe('DELETE /admin/projects/:id/environments/:envId', () => {
    it('should delete an environment and cascade to its flags', async () => {
      const proj = await request(app).post('/admin/projects').send({ name: 'my-app' });
      const projectId: string = proj.body.id;
      const env = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'staging' });
      const envId: string = env.body.id;
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'staging' });

      const res = await request(app).delete(`/admin/projects/${projectId}/environments/${envId}`);
      expect(res.status).toBe(204);

      const envs = await storage.getEnvironmentsByProject(projectId);
      expect(envs.find(e => e.name === 'staging')).toBeUndefined();
      const flag = await storage.getFlag(projectId, 'feat', 'staging');
      expect(flag).toBeNull();
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
      const env = await request(app).post(`/admin/projects/${projectId}/environments`).send({ name: 'staging' });
      envId = env.body.id;
    });

    it('should rename an environment and return the updated object', async () => {
      const res = await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: 'qa' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(envId);
      expect(res.body.name).toBe('qa');
    });

    it('should cascade the rename to flag rows', async () => {
      await storage.createFlag({ projectId, key: 'my-flag', name: 'My Flag', enabled: false, environment: 'staging' });
      await request(app).patch(`/admin/projects/${projectId}/environments/${envId}`).send({ name: 'qa' });
      const flag = await storage.getFlag(projectId, 'my-flag', 'qa');
      expect(flag).not.toBeNull();
      const oldFlag = await storage.getFlag(projectId, 'my-flag', 'staging');
      expect(oldFlag).toBeNull();
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
