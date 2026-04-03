import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { SqliteStorage } from '../storage/sqlite';
import { FlagEvaluator } from '../evaluator';
import { createAuthMiddleware } from '../middleware/auth';
import { createEvaluateRouter } from '../routes/evaluate';
import * as fs from 'fs';
import * as path from 'path';

describe('Evaluate Routes', () => {
  let app: Express;
  let storage: SqliteStorage;
  let evaluator: FlagEvaluator;
  let apiKey: string;
  let projectId: string;
  const testDbPath = path.join(__dirname, '../../test-data/evaluate-test.db');

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

    evaluator = new FlagEvaluator();

    // Create project + environment for testing
    const project = await storage.createProject({ name: 'test-project' });
    projectId = project.id;
    const env = await storage.createEnvironment({ projectId, name: 'test' });
    apiKey = env.key;

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(createAuthMiddleware(storage));
    app.use('/api/evaluate', createEvaluateRouter(storage, evaluator));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('POST /api/evaluate/:key', () => {
    it('should evaluate an enabled flag', async () => {
      await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: true,
        environment: 'test',
        projectId
      });

      const response = await request(app)
        .post('/api/evaluate/test-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-123'
        });

      expect(response.status).toBe(200);
      expect(response.body.key).toBe('test-flag');
      expect(response.body.enabled).toBe(true);
      expect(response.body.metadata.flagEnabled).toBe(true);
    });

    it('should evaluate a disabled flag', async () => {
      await storage.createFlag({
        key: 'disabled-flag',
        name: 'Disabled Flag',
        enabled: false,
        environment: 'test',
        projectId
      });

      const response = await request(app)
        .post('/api/evaluate/disabled-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-123'
        });

      expect(response.status).toBe(200);
      expect(response.body.key).toBe('disabled-flag');
      expect(response.body.enabled).toBe(false);
      expect(response.body.metadata.flagEnabled).toBe(false);
    });

    it('should return 404 for non-existent flag', async () => {
      const response = await request(app)
        .post('/api/evaluate/non-existent')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-123'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Flag not found');
    });

    it('should evaluate flag with user targeting', async () => {
      await storage.createFlag({
        key: 'targeted-flag',
        name: 'Targeted Flag',
        enabled: true,
        environment: 'test',
        projectId,
        targeting: {
          userIds: ['user-1', 'user-2']
        }
      });

      // User in targeting list
      const response1 = await request(app)
        .post('/api/evaluate/targeted-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-1'
        });

      expect(response1.body.enabled).toBe(true);

      // User not in targeting list
      const response2 = await request(app)
        .post('/api/evaluate/targeted-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-999'
        });

      expect(response2.body.enabled).toBe(false);
    });

    it('should evaluate flag with attribute targeting', async () => {
      await storage.createFlag({
        key: 'premium-flag',
        name: 'Premium Flag',
        enabled: true,
        environment: 'test',
        projectId,
        targeting: {
          attributes: {
            plan: ['premium', 'enterprise']
          }
        }
      });

      // User with matching attribute
      const response1 = await request(app)
        .post('/api/evaluate/premium-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-123',
          attributes: {
            plan: 'premium'
          }
        });

      expect(response1.body.enabled).toBe(true);

      // User without matching attribute
      const response2 = await request(app)
        .post('/api/evaluate/premium-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-456',
          attributes: {
            plan: 'free'
          }
        });

      expect(response2.body.enabled).toBe(false);
    });

    it('should evaluate flag with percentage rollout', async () => {
      await storage.createFlag({
        key: 'rollout-flag',
        name: 'Rollout Flag',
        enabled: true,
        environment: 'test',
        projectId,
        rollout: {
          percentage: 100
        }
      });

      const response = await request(app)
        .post('/api/evaluate/rollout-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-123'
        });

      expect(response.body.enabled).toBe(true);
    });

    it('should include metadata about flag configuration', async () => {
      await storage.createFlag({
        key: 'complex-flag',
        name: 'Complex Flag',
        enabled: true,
        environment: 'test',
        projectId,
        targeting: {
          userIds: ['user-1']
        },
        rollout: {
          percentage: 50
        }
      });

      const response = await request(app)
        .post('/api/evaluate/complex-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          userId: 'user-1'
        });

      expect(response.body.metadata.flagEnabled).toBe(true);
      expect(response.body.metadata.hasTargeting).toBe(true);
      expect(response.body.metadata.hasRollout).toBe(true);
    });

    it('should handle evaluation without userId', async () => {
      await storage.createFlag({
        key: 'simple-flag',
        name: 'Simple Flag',
        enabled: true,
        environment: 'test',
        projectId
      });

      const response = await request(app)
        .post('/api/evaluate/simple-flag')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
    });
  });

  describe('POST /api/evaluate (batch)', () => {
    beforeEach(async () => {
      await storage.createFlag({
        key: 'flag-a',
        name: 'Flag A',
        enabled: true,
        environment: 'test',
        projectId
      });

      await storage.createFlag({
        key: 'flag-b',
        name: 'Flag B',
        enabled: false,
        environment: 'test',
        projectId
      });

      await storage.createFlag({
        key: 'flag-c',
        name: 'Flag C',
        enabled: true,
        environment: 'test',
        projectId,
        targeting: {
          userIds: ['user-premium']
        }
      });
    });

    it('should evaluate multiple flags at once', async () => {
      const response = await request(app)
        .post('/api/evaluate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          flags: ['flag-a', 'flag-b', 'flag-c'],
          context: {
            userId: 'user-123'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body['flag-a']).toBe(true);
      expect(response.body['flag-b']).toBe(false);
      expect(response.body['flag-c']).toBe(false); // Not targeted
    });

    it('should return false for non-existent flags', async () => {
      const response = await request(app)
        .post('/api/evaluate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          flags: ['flag-a', 'non-existent', 'flag-b'],
          context: {
            userId: 'user-123'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body['flag-a']).toBe(true);
      expect(response.body['non-existent']).toBe(false);
      expect(response.body['flag-b']).toBe(false);
    });

    it('should evaluate with attributes', async () => {
      await storage.createFlag({
        key: 'premium-feature',
        name: 'Premium Feature',
        enabled: true,
        environment: 'test',
        projectId,
        targeting: {
          attributes: {
            plan: ['premium']
          }
        }
      });

      const response = await request(app)
        .post('/api/evaluate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          flags: ['premium-feature', 'flag-a'],
          context: {
            userId: 'user-123',
            attributes: {
              plan: 'premium'
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body['premium-feature']).toBe(true);
      expect(response.body['flag-a']).toBe(true);
    });

    it('should reject request without flags array', async () => {
      const response = await request(app)
        .post('/api/evaluate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          context: {
            userId: 'user-123'
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('flags must be an array');
    });

    it('should handle empty flags array', async () => {
      const response = await request(app)
        .post('/api/evaluate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          flags: [],
          context: {
            userId: 'user-123'
          }
        });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toHaveLength(0);
    });

    it('should work without context', async () => {
      const response = await request(app)
        .post('/api/evaluate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          flags: ['flag-a', 'flag-b']
        });

      expect(response.status).toBe(200);
      expect(response.body['flag-a']).toBe(true);
      expect(response.body['flag-b']).toBe(false);
    });
  });

  describe('Authentication', () => {
    it('should reject requests without auth header', async () => {
      const response = await request(app)
        .post('/api/evaluate/test-flag')
        .send({
          userId: 'user-123'
        });

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid API key', async () => {
      const response = await request(app)
        .post('/api/evaluate/test-flag')
        .set('Authorization', 'Bearer invalid-key')
        .send({
          userId: 'user-123'
        });

      expect(response.status).toBe(401);
    });
  });
});
