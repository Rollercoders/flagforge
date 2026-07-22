import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { SqliteStorage } from '../storage/sqlite';
import { createAuthMiddleware } from '../middleware/auth';
import * as fs from 'fs';
import * as path from 'path';

describe('Auth Middleware', () => {
  let app: Express;
  let storage: SqliteStorage;
  const testDbPath = path.join(__dirname, '../../test-data/auth-middleware-test.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storage = new SqliteStorage(testDbPath);
    await storage.initialize();

    app = express();
    app.use(express.json());
    app.use('/protected', createAuthMiddleware(storage), (_req, res) => {
      res.json({ ok: true });
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a non-Bearer token', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('rejects an unknown key', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer ff_unknownkey');
    expect(res.status).toBe(401);
  });

  it('accepts a valid environment key', async () => {
    const project = await storage.createProject({ name: 'TestProject' });
    const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${env.key}`);
    expect(res.status).toBe(200);
  });

  it('sets req.apiKey from the matched environment', async () => {
    let captured: any;
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/protected', createAuthMiddleware(storage), (req: any, res) => {
      captured = req.apiKey;
      res.json({ ok: true });
    });
    const project = await storage.createProject({ name: 'TestProject2' });
    const env = await storage.createEnvironment({ projectId: project.id, name: 'staging' });
    await request(testApp).get('/protected').set('Authorization', `Bearer ${env.key}`);
    expect(captured.projectId).toBe(project.id);
    expect(captured.environment).toBe('staging');
    expect(captured.id).toBe(env.id);
  });
});
