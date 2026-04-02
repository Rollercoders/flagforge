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
    // Setup storage
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    storage = new SqliteStorage(testDbPath);
    await storage.initialize();

    // Setup Express app (no auth for admin routes)
    app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('POST /admin/api-keys', () => {
    it('should create a new API key', async () => {
      const response = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Production Key',
          environment: 'production'
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.key).toBeDefined();
      expect(response.body.key).toMatch(/^rf_/);
      expect(response.body.name).toBe('Production Key');
      expect(response.body.environment).toBe('production');
      expect(response.body.createdAt).toBeDefined();
    });

    it('should generate unique keys', async () => {
      const response1 = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Key 1',
          environment: 'test'
        });

      const response2 = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Key 2',
          environment: 'test'
        });

      expect(response1.body.key).not.toBe(response2.body.key);
    });

    it('should reject request without name', async () => {
      const response = await request(app)
        .post('/admin/api-keys')
        .send({
          environment: 'production'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name and environment are required');
    });

    it('should reject request without environment', async () => {
      const response = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Test Key'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name and environment are required');
    });

    it('should create keys for different environments', async () => {
      const prodResponse = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Prod Key',
          environment: 'production'
        });

      const stagingResponse = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Staging Key',
          environment: 'staging'
        });

      expect(prodResponse.status).toBe(201);
      expect(stagingResponse.status).toBe(201);
      expect(prodResponse.body.environment).toBe('production');
      expect(stagingResponse.body.environment).toBe('staging');
    });

    it('should generate keys with rf_ prefix', async () => {
      const response = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Test Key',
          environment: 'test'
        });

      expect(response.body.key).toMatch(/^rf_[a-zA-Z0-9_-]{32}$/);
    });
  });

  describe('GET /admin/api-keys', () => {
    beforeEach(async () => {
      await storage.createApiKey({
        key: 'key-1',
        name: 'Key 1',
        environment: 'production'
      });

      // Wait 1ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1));

      await storage.createApiKey({
        key: 'key-2',
        name: 'Key 2',
        environment: 'staging'
      });

      // Wait 1ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1));

      await storage.createApiKey({
        key: 'key-3',
        name: 'Key 3',
        environment: 'development'
      });

      // Wait 1ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1));

      await storage.createApiKey({
        key: 'rf_uiadminkey123',
        name: '__ui_admin__',
        environment: '__admin__'
      });
    });

    it('should return all API keys', async () => {
      const response = await request(app)
        .get('/admin/api-keys');

      expect(response.status).toBe(200);
      // 4 keys were created but __ui_admin__ must be filtered out
      expect(response.body).toHaveLength(3);
      expect(response.body.every((k: { name: string }) => k.name !== '__ui_admin__')).toBe(true);
    });

    it('should return keys in descending order by creation date', async () => {
      const response = await request(app)
        .get('/admin/api-keys');

      expect(response.status).toBe(200);
      expect(response.body[0].key).toBe('key-3'); // Most recent
      expect(response.body[1].key).toBe('key-2');
      expect(response.body[2].key).toBe('key-1'); // Oldest
    });

    it('should include all key properties', async () => {
      const response = await request(app)
        .get('/admin/api-keys');

      expect(response.status).toBe(200);
      const key = response.body[0];
      expect(key.id).toBeDefined();
      expect(key.key).toBeDefined();
      expect(key.name).toBeDefined();
      expect(key.environment).toBeDefined();
      expect(key.createdAt).toBeDefined();
    });

    it('should return empty array when no keys exist', async () => {
      // Delete all keys
      const keys = await storage.getAllApiKeys();
      for (const key of keys) {
        await storage.deleteApiKey(key.id);
      }

      const response = await request(app)
        .get('/admin/api-keys');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('DELETE /admin/api-keys/:id', () => {
    let testKeyId: string;

    beforeEach(async () => {
      const key = await storage.createApiKey({
        key: 'delete-test-key',
        name: 'Delete Test',
        environment: 'test'
      });
      testKeyId = key.id;
    });

    it('should delete an API key', async () => {
      const response = await request(app)
        .delete(`/admin/api-keys/${testKeyId}`);

      expect(response.status).toBe(204);

      // Verify it's deleted
      const keys = await storage.getAllApiKeys();
      expect(keys.find(k => k.id === testKeyId)).toBeUndefined();
    });

    it('should return 204 even for non-existent key', async () => {
      const response = await request(app)
        .delete('/admin/api-keys/non-existent-id');

      expect(response.status).toBe(204);
    });

    it('should not affect other keys when deleting one', async () => {
      const key2 = await storage.createApiKey({
        key: 'keep-this-key',
        name: 'Keep This',
        environment: 'test'
      });

      await request(app)
        .delete(`/admin/api-keys/${testKeyId}`);

      const keys = await storage.getAllApiKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].id).toBe(key2.id);
    });
  });

  describe('GET /admin/ui-token', () => {
    it('should return 404 when __ui_admin__ key does not exist', async () => {
      const response = await request(app).get('/admin/ui-token');
      expect(response.status).toBe(404);
    });

    it('should return the __ui_admin__ key when it exists', async () => {
      await storage.createApiKey({
        key: 'rf_uiadminkey123',
        name: '__ui_admin__',
        environment: '__admin__'
      });

      const response = await request(app).get('/admin/ui-token');
      expect(response.status).toBe(200);
      expect(response.body.key).toBe('rf_uiadminkey123');
    });
  });

  describe('GET /admin/api-keys filters __ui_admin__', () => {
    it('should not return __ui_admin__ key in the list', async () => {
      await storage.createApiKey({
        key: 'rf_uiadminkey123',
        name: '__ui_admin__',
        environment: '__admin__'
      });
      await storage.createApiKey({
        key: 'rf_normalkey456',
        name: 'Production Key',
        environment: 'production'
      });

      const response = await request(app).get('/admin/api-keys');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Production Key');
    });
  });

  describe('Integration scenarios', () => {
    it('should create, list, and delete API keys in sequence', async () => {
      // Create
      const createResponse = await request(app)
        .post('/admin/api-keys')
        .send({
          name: 'Test Key',
          environment: 'test'
        });

      expect(createResponse.status).toBe(201);
      const keyId = createResponse.body.id;

      // List
      const listResponse = await request(app)
        .get('/admin/api-keys');

      expect(listResponse.status).toBe(200);
      expect(listResponse.body).toHaveLength(1);
      expect(listResponse.body[0].id).toBe(keyId);

      // Delete
      const deleteResponse = await request(app)
        .delete(`/admin/api-keys/${keyId}`);

      expect(deleteResponse.status).toBe(204);

      // Verify deleted
      const finalListResponse = await request(app)
        .get('/admin/api-keys');

      expect(finalListResponse.body).toHaveLength(0);
    });

    it('should handle multiple environments', async () => {
      const environments = ['development', 'staging', 'production'];

      for (const env of environments) {
        const response = await request(app)
          .post('/admin/api-keys')
          .send({
            name: `${env} Key`,
            environment: env
          });

        expect(response.status).toBe(201);
        expect(response.body.environment).toBe(env);
      }

      const listResponse = await request(app)
        .get('/admin/api-keys');

      expect(listResponse.body).toHaveLength(3);

      const envs = listResponse.body.map((k: any) => k.environment);
      expect(envs).toContain('development');
      expect(envs).toContain('staging');
      expect(envs).toContain('production');
    });
  });
});
