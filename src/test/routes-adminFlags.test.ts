import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SqliteStorage } from '../storage/sqlite';
import { requireAdminSession, SessionStore } from '../middleware/adminAuth';
import { createAdminFlagsRouter } from '../routes/adminFlags';
import * as fs from 'fs';
import * as path from 'path';

describe('Admin Flags Routes', () => {
  let app: Express;
  let storage: SqliteStorage;
  let projectId: string;
  let envName: string;
  let sessions: SessionStore;
  const sessionToken = 'test-session-token';
  const testDbPath = path.join(__dirname, '../../test-data/routes-adminFlags-test.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    storage = new SqliteStorage(testDbPath);
    await storage.initialize();

    const project = await storage.createProject({ name: 'test-project' });
    projectId = project.id;
    const env = await storage.createEnvironment({ projectId, name: 'production' });
    envName = env.name;

    sessions = new Map();
    sessions.set(sessionToken, new Date(Date.now() + 3_600_000)); // expires in 1h

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/admin/flags', requireAdminSession(sessions), createAdminFlagsRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('should return 401 without session cookie', async () => {
    const res = await request(app)
      .get(`/admin/flags?projectId=${projectId}&environment=${envName}`);
    expect(res.status).toBe(401);
  });

  it('should return empty list when no flags exist', async () => {
    const res = await request(app)
      .get(`/admin/flags?projectId=${projectId}&environment=${envName}`)
      .set('Cookie', `rf_session=${sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should create a flag', async () => {
    const res = await request(app)
      .post('/admin/flags')
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ key: 'my-feature', name: 'My Feature', projectId, environment: envName });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe('my-feature');
    expect(res.body.enabled).toBe(false);
  });

  it('should return 400 if projectId or environment missing on create', async () => {
    const res = await request(app)
      .post('/admin/flags')
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ key: 'x', name: 'X' });
    expect(res.status).toBe(400);
  });

  it('should get a single flag', async () => {
    await request(app)
      .post('/admin/flags')
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ key: 'flag-a', name: 'Flag A', projectId, environment: envName });

    const res = await request(app)
      .get(`/admin/flags/flag-a?projectId=${projectId}&environment=${envName}`)
      .set('Cookie', `rf_session=${sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('flag-a');
  });

  it('should update a flag', async () => {
    await request(app)
      .post('/admin/flags')
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ key: 'flag-b', name: 'Flag B', projectId, environment: envName });

    const res = await request(app)
      .patch(`/admin/flags/flag-b?projectId=${projectId}&environment=${envName}`)
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('should clear targeting when patched with null', async () => {
    await request(app)
      .post('/admin/flags')
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ key: 'flag-t', name: 'Flag T', projectId, environment: envName, targeting: { userIds: ['u1'] } });

    const res = await request(app)
      .patch(`/admin/flags/flag-t?projectId=${projectId}&environment=${envName}`)
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ targeting: null });
    expect(res.status).toBe(200);
    expect(res.body.targeting).toBeUndefined();

    const get = await request(app)
      .get(`/admin/flags/flag-t?projectId=${projectId}&environment=${envName}`)
      .set('Cookie', `rf_session=${sessionToken}`);
    expect(get.body.targeting).toBeUndefined();
  });

  it('should delete a flag', async () => {
    await request(app)
      .post('/admin/flags')
      .set('Cookie', `rf_session=${sessionToken}`)
      .send({ key: 'flag-c', name: 'Flag C', projectId, environment: envName });

    const del = await request(app)
      .delete(`/admin/flags/flag-c?projectId=${projectId}&environment=${envName}`)
      .set('Cookie', `rf_session=${sessionToken}`);
    expect(del.status).toBe(204);

    const get = await request(app)
      .get(`/admin/flags/flag-c?projectId=${projectId}&environment=${envName}`)
      .set('Cookie', `rf_session=${sessionToken}`);
    expect(get.status).toBe(404);
  });
});
