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

    it('returns the updated environment with a new client key when no role is given (default client)', async () => {
      const project = await storage.createProject({ name: 'TestApp' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      const oldKey = env.key;
      const res = await request(app).post(`/admin/environments/${env.id}/regenerate-key`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(env.id);
      expect(res.body.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
      expect(res.body.key).not.toBe(oldKey);
      // secretKey is untouched by a client-role regeneration
      expect(res.body.secretKey).toBe(env.secretKey);
    });

    it('new client key is usable for auth lookup', async () => {
      const project = await storage.createProject({ name: 'TestApp2' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const res = await request(app).post(`/admin/environments/${env.id}/regenerate-key`);
      const newKey: string = res.body.key;
      const found = await storage.getEnvironmentByKey(newKey);
      expect(found?.id).toBe(env.id);
    });

    it('old client key is no longer valid after regeneration', async () => {
      const project = await storage.createProject({ name: 'TestApp3' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const oldKey = env.key;
      await request(app).post(`/admin/environments/${env.id}/regenerate-key`);
      const found = await storage.getEnvironmentByKey(oldKey);
      expect(found).toBeNull();
    });

    it('regenerates the client key when role is explicitly "client"', async () => {
      const project = await storage.createProject({ name: 'TestAppClientRole' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const oldKey = env.key;
      const oldSecretKey = env.secretKey;
      const res = await request(app)
        .post(`/admin/environments/${env.id}/regenerate-key`)
        .send({ role: 'client' });
      expect(res.status).toBe(200);
      expect(res.body.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
      expect(res.body.key).not.toBe(oldKey);
      expect(res.body.secretKey).toBe(oldSecretKey);
    });

    it('regenerates the secret key when role is "secret", leaving the client key untouched', async () => {
      const project = await storage.createProject({ name: 'TestAppSecretRole' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const oldKey = env.key;
      const oldSecretKey = env.secretKey;
      const res = await request(app)
        .post(`/admin/environments/${env.id}/regenerate-key`)
        .send({ role: 'secret' });
      expect(res.status).toBe(200);
      expect(res.body.secretKey).toMatch(/^ffs_[a-zA-Z0-9_-]{32}$/);
      expect(res.body.secretKey).not.toBe(oldSecretKey);
      // client key is untouched by a secret-role regeneration
      expect(res.body.key).toBe(oldKey);
    });

    it('new secret key is usable for auth lookup via getEnvironmentByAnyKey', async () => {
      const project = await storage.createProject({ name: 'TestAppSecretLookup' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const res = await request(app)
        .post(`/admin/environments/${env.id}/regenerate-key`)
        .send({ role: 'secret' });
      const newSecretKey: string = res.body.secretKey;
      const found = await storage.getEnvironmentByAnyKey(newSecretKey);
      expect(found?.environment.id).toBe(env.id);
      expect(found?.role).toBe('secret');
    });

    it('old secret key is no longer valid after a secret-role regeneration', async () => {
      const project = await storage.createProject({ name: 'TestAppOldSecret' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const oldSecretKey = env.secretKey;
      await request(app)
        .post(`/admin/environments/${env.id}/regenerate-key`)
        .send({ role: 'secret' });
      const found = await storage.getEnvironmentByAnyKey(oldSecretKey);
      expect(found).toBeNull();
    });

    it('includes a secretKey field in the regenerate-key response', async () => {
      const project = await storage.createProject({ name: 'TestAppSecretField' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'prod' });
      const res = await request(app).post(`/admin/environments/${env.id}/regenerate-key`);
      expect(res.status).toBe(200);
      expect(res.body.secretKey).toBeDefined();
      expect(typeof res.body.secretKey).toBe('string');
      expect(res.body.secretKey).toMatch(/^ffs_/);
    });
  });
});
