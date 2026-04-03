import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { SqliteStorage } from '../storage/sqlite';
import { createAdminRouter } from '../routes/admin';
import * as fs from 'fs';
import * as path from 'path';

describe('Admin Routes', () => {
  let app: Express;
  let storage: SqliteStorage;
  const testDbPath = path.join(__dirname, '../../test-data/admin-test.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storage = new SqliteStorage(testDbPath);
    await storage.initialize();
    app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('GET /admin/ui-token', () => {
    it('returns 404 when no admin key exists', async () => {
      const res = await request(app).get('/admin/ui-token');
      expect(res.status).toBe(404);
    });

    it('returns the admin key after bootstrap', async () => {
      await storage.bootstrapAdminKey();
      const key = await storage.getAdminKey();
      const res = await request(app).get('/admin/ui-token');
      expect(res.status).toBe(200);
      expect(res.body.key).toBe(key);
      expect(res.body.key).toMatch(/^ff_/);
    });
  });

  describe('POST /admin/environments/:envId/regenerate-key', () => {
    it('returns 404 for unknown envId', async () => {
      const res = await request(app).post('/admin/environments/nope/regenerate-key');
      expect(res.status).toBe(404);
    });

    it('returns the updated environment with a new key', async () => {
      const project = await storage.createProject({ name: 'TestApp' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      const oldKey = env.key;
      const res = await request(app).post(`/admin/environments/${env.id}/regenerate-key`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(env.id);
      expect(res.body.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
      expect(res.body.key).not.toBe(oldKey);
    });

    it('new key is usable for auth lookup', async () => {
      const project = await storage.createProject({ name: 'TestApp2' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const res = await request(app).post(`/admin/environments/${env.id}/regenerate-key`);
      const newKey: string = res.body.key;
      const found = await storage.getEnvironmentByKey(newKey);
      expect(found?.id).toBe(env.id);
    });

    it('old key is no longer valid after regeneration', async () => {
      const project = await storage.createProject({ name: 'TestApp3' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const oldKey = env.key;
      await request(app).post(`/admin/environments/${env.id}/regenerate-key`);
      const found = await storage.getEnvironmentByKey(oldKey);
      expect(found).toBeNull();
    });
  });
});
