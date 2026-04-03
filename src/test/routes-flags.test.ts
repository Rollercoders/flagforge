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
    await storage.createEnvironment({ projectId, name: 'test' });

    const key = await storage.createApiKey({ key: 'test-api-key', name: 'Test Key', environment: 'test', projectId });
    apiKey = key.key;

    app = express();
    app.use(express.json());
    app.use(createAuthMiddleware(storage));
    app.use('/api/flags', createFlagsRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('POST /api/flags', () => {
    it('should create a new flag', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ key: 'new-feature', name: 'New Feature', description: 'A new feature' });
      expect(response.status).toBe(201);
      expect(response.body.key).toBe('new-feature');
      expect(response.body.name).toBe('New Feature');
      expect(response.body.enabled).toBe(false);
      expect(response.body.environment).toBe('test');
      expect(response.body.projectId).toBe(projectId);
    });

    it('should reject request without key', async () => {
      const response = await request(app).post('/api/flags').set('Authorization', `Bearer ${apiKey}`).send({ name: 'New Feature' });
      expect(response.status).toBe(400);
    });

    it('should reject request without name', async () => {
      const response = await request(app).post('/api/flags').set('Authorization', `Bearer ${apiKey}`).send({ key: 'feat' });
      expect(response.status).toBe(400);
    });

    it('should reject duplicate flag key in same project', async () => {
      await request(app).post('/api/flags').set('Authorization', `Bearer ${apiKey}`).send({ key: 'dup', name: 'Dup' });
      const response = await request(app).post('/api/flags').set('Authorization', `Bearer ${apiKey}`).send({ key: 'dup', name: 'Dup 2' });
      expect(response.status).toBe(409);
    });

    it('should create flag with targeting', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ key: 'targeted', name: 'Targeted', targeting: { userIds: ['u1', 'u2'] } });
      expect(response.status).toBe(201);
      expect(response.body.targeting.userIds).toEqual(['u1', 'u2']);
    });

    it('should create flag with rollout', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ key: 'rollout', name: 'Rollout', rollout: { percentage: 50 } });
      expect(response.status).toBe(201);
      expect(response.body.rollout.percentage).toBe(50);
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

  describe('PATCH /api/flags/:key', () => {
    beforeEach(async () => {
      await storage.createFlag({ projectId, key: 'update-flag', name: 'Update Flag', enabled: false, environment: 'test' });
    });

    it('should update a flag', async () => {
      const response = await request(app).patch('/api/flags/update-flag').set('Authorization', `Bearer ${apiKey}`).send({ enabled: true, name: 'Updated' });
      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body.name).toBe('Updated');
    });

    it('should return 404 for non-existent flag', async () => {
      const response = await request(app).patch('/api/flags/nope').set('Authorization', `Bearer ${apiKey}`).send({ enabled: true });
      expect(response.status).toBe(404);
    });

    it('should update targeting', async () => {
      const response = await request(app).patch('/api/flags/update-flag').set('Authorization', `Bearer ${apiKey}`).send({ targeting: { userIds: ['u1', 'u2'], attributes: { plan: ['premium'] } } });
      expect(response.status).toBe(200);
      expect(response.body.targeting.userIds).toEqual(['u1', 'u2']);
    });

    it('should update rollout', async () => {
      const response = await request(app).patch('/api/flags/update-flag').set('Authorization', `Bearer ${apiKey}`).send({ rollout: { percentage: 75 } });
      expect(response.status).toBe(200);
      expect(response.body.rollout.percentage).toBe(75);
    });
  });

  describe('DELETE /api/flags/:key', () => {
    beforeEach(async () => {
      await storage.createFlag({ projectId, key: 'del-flag', name: 'Delete Flag', enabled: true, environment: 'test' });
    });

    it('should delete a flag', async () => {
      const response = await request(app).delete('/api/flags/del-flag').set('Authorization', `Bearer ${apiKey}`);
      expect(response.status).toBe(204);
      const get = await request(app).get('/api/flags/del-flag').set('Authorization', `Bearer ${apiKey}`);
      expect(get.status).toBe(404);
    });

    it('should return 404 for non-existent flag', async () => {
      const response = await request(app).delete('/api/flags/nope').set('Authorization', `Bearer ${apiKey}`);
      expect(response.status).toBe(404);
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
