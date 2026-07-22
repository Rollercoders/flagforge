import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { SqliteStorage } from '../storage/sqlite';
import { createAuthMiddleware } from '../middleware/auth';
import { createFlagsRouter } from '../routes/flags';
import * as fs from 'fs';
import * as path from 'path';

describe('Flags Routes', () => {
  let app: Express;
  let storage: SqliteStorage;
  let apiKey: string;
  let projectId: string;
  const testDbPath = path.join(__dirname, '../../test-data/routes-test.db');

  beforeEach(async () => {
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    storage = new SqliteStorage(testDbPath);
    await storage.initialize();

    const project = await storage.createProject({ name: 'test-project' });
    projectId = project.id;
    const env = await storage.createEnvironment({ projectId, name: 'test' });
    apiKey = env.key;

    app = express();
    app.use(express.json());
    app.use(createAuthMiddleware(storage));
    app.use('/api/flags', createFlagsRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  // Le API key di environment sono di sola lettura: la scrittura sui flag è
  // vietata (403) e resta possibile solo via sessione admin (UI).
  describe('POST /api/flags (read-only API key)', () => {
    it('should reject flag creation with 403', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ key: 'new-feature', name: 'New Feature', description: 'A new feature' });
      expect(response.status).toBe(403);
    });

    it('should reject with 403 even when the body is incomplete', async () => {
      const response = await request(app).post('/api/flags').set('Authorization', `Bearer ${apiKey}`).send({ name: 'No Key' });
      expect(response.status).toBe(403);
    });

    it('should not create the flag in storage', async () => {
      await request(app).post('/api/flags').set('Authorization', `Bearer ${apiKey}`).send({ key: 'blocked', name: 'Blocked' });
      const flag = await storage.getFlag(projectId, 'blocked', 'test');
      expect(flag).toBeNull();
    });
  });

  describe('GET /api/flags', () => {
    beforeEach(async () => {
      await storage.createFlag({ projectId, key: 'flag-1', name: 'Flag 1', enabled: true, environment: 'test' });
      await new Promise(r => setTimeout(r, 10));
      await storage.createFlag({ projectId, key: 'flag-2', name: 'Flag 2', enabled: false, environment: 'test' });
    });

    it('should return all flags for the environment', async () => {
      const response = await request(app).get('/api/flags').set('Authorization', `Bearer ${apiKey}`);
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('should only return flags for this project', async () => {
      const other = await storage.createProject({ name: 'other' });
      await storage.createEnvironment({ projectId: other.id, name: 'test' });
      await storage.createFlag({ projectId: other.id, key: 'other-flag', name: 'Other', enabled: false, environment: 'test' });
      const response = await request(app).get('/api/flags').set('Authorization', `Bearer ${apiKey}`);
      expect(response.body.find((f: any) => f.key === 'other-flag')).toBeUndefined();
    });
  });

  describe('GET /api/flags/:key', () => {
    beforeEach(async () => {
      await storage.createFlag({ projectId, key: 'test-flag', name: 'Test Flag', enabled: true, environment: 'test' });
    });

    it('should return a specific flag', async () => {
      const response = await request(app).get('/api/flags/test-flag').set('Authorization', `Bearer ${apiKey}`);
      expect(response.status).toBe(200);
      expect(response.body.key).toBe('test-flag');
    });

    it('should return 404 for non-existent flag', async () => {
      const response = await request(app).get('/api/flags/nope').set('Authorization', `Bearer ${apiKey}`);
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/flags/:key (read-only API key)', () => {
    beforeEach(async () => {
      await storage.createFlag({ projectId, key: 'update-flag', name: 'Update Flag', enabled: false, environment: 'test' });
    });

    it('should reject flag update with 403', async () => {
      const response = await request(app).patch('/api/flags/update-flag').set('Authorization', `Bearer ${apiKey}`).send({ enabled: true, name: 'Updated' });
      expect(response.status).toBe(403);
    });

    it('should reject with 403 even for a non-existent flag (guard runs before lookup)', async () => {
      const response = await request(app).patch('/api/flags/nope').set('Authorization', `Bearer ${apiKey}`).send({ enabled: true });
      expect(response.status).toBe(403);
    });

    it('should not modify the flag in storage', async () => {
      await request(app).patch('/api/flags/update-flag').set('Authorization', `Bearer ${apiKey}`).send({ enabled: true, name: 'Updated' });
      const flag = await storage.getFlag(projectId, 'update-flag', 'test');
      expect(flag?.enabled).toBe(false);
      expect(flag?.name).toBe('Update Flag');
    });
  });

  describe('DELETE /api/flags/:key (read-only API key)', () => {
    beforeEach(async () => {
      await storage.createFlag({ projectId, key: 'del-flag', name: 'Delete Flag', enabled: true, environment: 'test' });
    });

    it('should reject flag deletion with 403', async () => {
      const response = await request(app).delete('/api/flags/del-flag').set('Authorization', `Bearer ${apiKey}`);
      expect(response.status).toBe(403);
    });

    it('should reject with 403 even for a non-existent flag (guard runs before lookup)', async () => {
      const response = await request(app).delete('/api/flags/nope').set('Authorization', `Bearer ${apiKey}`);
      expect(response.status).toBe(403);
    });

    it('should not delete the flag from storage', async () => {
      await request(app).delete('/api/flags/del-flag').set('Authorization', `Bearer ${apiKey}`);
      const flag = await storage.getFlag(projectId, 'del-flag', 'test');
      expect(flag).not.toBeNull();
    });
  });

  describe('Cross-project isolation on single-flag endpoints', () => {
    let projectBApiKey: string;

    beforeEach(async () => {
      // Create a second project with its own environment
      const projectB = await storage.createProject({ name: 'project-b' });
      const envB = await storage.createEnvironment({ projectId: projectB.id, name: 'test' });
      projectBApiKey = envB.key;

      // Create a flag in project A
      await storage.createFlag({ projectId, key: 'project-a-flag', name: 'Project A Flag', enabled: true, environment: 'test' });
    });

    it('should return 404 when GET a flag from another project', async () => {
      const response = await request(app).get('/api/flags/project-a-flag').set('Authorization', `Bearer ${projectBApiKey}`);
      expect(response.status).toBe(404);
    });

    it('should return 403 when PATCH a flag from another project (write blocked)', async () => {
      const response = await request(app).patch('/api/flags/project-a-flag').set('Authorization', `Bearer ${projectBApiKey}`).send({ enabled: false });
      expect(response.status).toBe(403);
    });

    it('should return 403 when DELETE a flag from another project (write blocked)', async () => {
      const response = await request(app).delete('/api/flags/project-a-flag').set('Authorization', `Bearer ${projectBApiKey}`);
      expect(response.status).toBe(403);
    });
  });

  describe('Multi-environment flag visibility', () => {
    it('should list a flag in all environments of the project', async () => {
      // Create a second environment for the test project
      const stagingEnv = await storage.createEnvironment({ projectId, name: 'staging' });
      const stagingApiKey = stagingEnv.key;

      // Create a flag via storage (API keys are read-only); createFlag fans it
      // out across all environments of the project.
      await storage.createFlag({ projectId, key: 'multi-env-flag', name: 'Multi Env Flag', enabled: false, environment: 'test' });

      // Verify the flag appears when listing with the 'test' environment key
      const testListResponse = await request(app).get('/api/flags').set('Authorization', `Bearer ${apiKey}`);
      expect(testListResponse.status).toBe(200);
      expect(testListResponse.body.find((f: any) => f.key === 'multi-env-flag')).toBeDefined();

      // Verify the flag also appears when listing with the 'staging' environment key
      const stagingListResponse = await request(app).get('/api/flags').set('Authorization', `Bearer ${stagingApiKey}`);
      expect(stagingListResponse.status).toBe(200);
      expect(stagingListResponse.body.find((f: any) => f.key === 'multi-env-flag')).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should reject requests without auth header', async () => {
      expect((await request(app).get('/api/flags')).status).toBe(401);
    });

    it('should reject requests with invalid API key', async () => {
      expect((await request(app).get('/api/flags').set('Authorization', 'Bearer invalid')).status).toBe(401);
    });
  });
});
