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
  const testDbPath = path.join(__dirname, '../../test-data/routes-test.db');

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

    // Create API key for testing
    const key = await storage.createApiKey({
      key: 'test-api-key',
      name: 'Test Key',
      environment: 'test'
    });
    apiKey = key.key;

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(createAuthMiddleware(storage));
    app.use('/api/flags', createFlagsRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('POST /api/flags', () => {
    it('should create a new flag', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          key: 'new-feature',
          name: 'New Feature',
          description: 'A new feature',
          enabled: true
        });

      expect(response.status).toBe(201);
      expect(response.body.key).toBe('new-feature');
      expect(response.body.name).toBe('New Feature');
      expect(response.body.enabled).toBe(true);
      expect(response.body.environment).toBe('test');
    });

    it('should reject request without key', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          name: 'New Feature',
          enabled: true
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('key and name are required');
    });

    it('should reject request without name', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          key: 'new-feature',
          enabled: true
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('key and name are required');
    });

    it('should reject duplicate flag in same environment', async () => {
      await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          key: 'duplicate',
          name: 'First',
          enabled: true
        });

      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          key: 'duplicate',
          name: 'Second',
          enabled: true
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already exists');
    });

    it('should create flag with targeting', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          key: 'targeted-feature',
          name: 'Targeted Feature',
          enabled: true,
          targeting: {
            userIds: ['user-1', 'user-2']
          }
        });

      expect(response.status).toBe(201);
      expect(response.body.targeting).toBeDefined();
      expect(response.body.targeting.userIds).toEqual(['user-1', 'user-2']);
    });

    it('should create flag with rollout', async () => {
      const response = await request(app)
        .post('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          key: 'rollout-feature',
          name: 'Rollout Feature',
          enabled: true,
          rollout: {
            percentage: 50
          }
        });

      expect(response.status).toBe(201);
      expect(response.body.rollout).toBeDefined();
      expect(response.body.rollout.percentage).toBe(50);
    });
  });

  describe('GET /api/flags', () => {
    beforeEach(async () => {
      await storage.createFlag({
        key: 'flag-1',
        name: 'Flag 1',
        enabled: true,
        environment: 'test'
      });

      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      await storage.createFlag({
        key: 'flag-2',
        name: 'Flag 2',
        enabled: false,
        environment: 'test'
      });
    });

    it('should return all flags for the environment', async () => {
      const response = await request(app)
        .get('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].key).toBe('flag-2'); // Most recent first
      expect(response.body[1].key).toBe('flag-1');
    });

    it('should only return flags for the authenticated environment', async () => {
      // Create flag in different environment
      await storage.createFlag({
        key: 'prod-flag',
        name: 'Production Flag',
        enabled: true,
        environment: 'production'
      });

      const response = await request(app)
        .get('/api/flags')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body.find((f: any) => f.key === 'prod-flag')).toBeUndefined();
    });
  });

  describe('GET /api/flags/:key', () => {
    beforeEach(async () => {
      await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: true,
        environment: 'test'
      });
    });

    it('should return a specific flag', async () => {
      const response = await request(app)
        .get('/api/flags/test-flag')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.key).toBe('test-flag');
      expect(response.body.name).toBe('Test Flag');
    });

    it('should return 404 for non-existent flag', async () => {
      const response = await request(app)
        .get('/api/flags/non-existent')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Flag not found');
    });
  });

  describe('PATCH /api/flags/:key', () => {
    beforeEach(async () => {
      await storage.createFlag({
        key: 'update-flag',
        name: 'Update Flag',
        enabled: false,
        environment: 'test'
      });
    });

    it('should update a flag', async () => {
      const response = await request(app)
        .patch('/api/flags/update-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          enabled: true,
          name: 'Updated Flag'
        });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body.name).toBe('Updated Flag');
    });

    it('should return 404 for non-existent flag', async () => {
      const response = await request(app)
        .patch('/api/flags/non-existent')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          enabled: true
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Flag not found');
    });

    it('should update targeting', async () => {
      const response = await request(app)
        .patch('/api/flags/update-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          targeting: {
            userIds: ['user-1', 'user-2'],
            attributes: {
              plan: ['premium']
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.targeting).toBeDefined();
      expect(response.body.targeting.userIds).toEqual(['user-1', 'user-2']);
    });

    it('should update rollout', async () => {
      const response = await request(app)
        .patch('/api/flags/update-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          rollout: {
            percentage: 75
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.rollout).toBeDefined();
      expect(response.body.rollout.percentage).toBe(75);
    });
  });

  describe('DELETE /api/flags/:key', () => {
    beforeEach(async () => {
      await storage.createFlag({
        key: 'delete-flag',
        name: 'Delete Flag',
        enabled: true,
        environment: 'test'
      });
    });

    it('should delete a flag', async () => {
      const response = await request(app)
        .delete('/api/flags/delete-flag')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(response.status).toBe(204);

      // Verify it's deleted
      const getResponse = await request(app)
        .get('/api/flags/delete-flag')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(getResponse.status).toBe(404);
    });

    it('should return 404 for non-existent flag', async () => {
      const response = await request(app)
        .delete('/api/flags/non-existent')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Flag not found');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without auth header', async () => {
      const response = await request(app)
        .get('/api/flags');

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid API key', async () => {
      const response = await request(app)
        .get('/api/flags')
        .set('Authorization', 'Bearer invalid-key');

      expect(response.status).toBe(401);
    });
  });
});
