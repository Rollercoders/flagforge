import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { requireAdminSession, SessionStore } from '../middleware/adminAuth.js';
import { createAuthRouter } from '../routes/auth.js';
import { SqliteStorage } from '../storage/sqlite.js';
import { createAdminRouter } from '../routes/admin.js';
import * as path from 'path';
import * as fs from 'fs';

describe('requireAdminSession middleware', () => {
  let app: Express;
  let sessions: SessionStore;

  beforeEach(() => {
    sessions = new Map();
    app = express();
    app.use(cookieParser());
    app.use('/admin', requireAdminSession(sessions), (_req, res) => {
      res.json({ ok: true });
    });
  });

  it('returns 401 with no cookie', async () => {
    const res = await request(app).get('/admin/anything');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 with unknown token', async () => {
    const res = await request(app)
      .get('/admin/anything')
      .set('Cookie', 'rf_session=unknown-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with expired token', async () => {
    const expiredDate = new Date(Date.now() - 1000);
    sessions.set('expired-token', expiredDate);
    const res = await request(app)
      .get('/admin/anything')
      .set('Cookie', 'rf_session=expired-token');
    expect(res.status).toBe(401);
    // Expired token should be cleaned up from map
    expect(sessions.has('expired-token')).toBe(false);
  });

  it('passes through with valid token', async () => {
    const validDate = new Date(Date.now() + 86400000);
    sessions.set('valid-token', validDate);
    const res = await request(app)
      .get('/admin/anything')
      .set('Cookie', 'rf_session=valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 401 with empty token cookie', async () => {
    const res = await request(app)
      .get('/admin/anything')
      .set('Cookie', 'rf_session=');
    expect(res.status).toBe(401);
  });
});

describe('Auth routes', () => {
  let app: Express;
  let sessions: SessionStore;
  const TEST_PASSWORD = 'test-password-123';

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = TEST_PASSWORD;
    sessions = new Map();
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', createAuthRouter(sessions));
  });

  describe('POST /auth/login', () => {
    it('returns 200 and sets cookie on correct password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      const cookie = res.headers['set-cookie'] as string[] | undefined;
      expect(cookie).toBeDefined();
      expect(cookie![0]).toContain('rf_session=');
      expect(cookie![0]).toContain('HttpOnly');
    });

    it('returns 401 on wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid password' });
    });

    it('returns 400 on missing password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Password is required' });
    });

    it('stores session token in sessions map', async () => {
      await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      expect(sessions.size).toBe(1);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the session cookie and removes token from map', async () => {
      // Login first
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      const cookie = (loginRes.headers['set-cookie'] as string[])[0];

      // Logout
      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Cookie', cookie);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body).toEqual({ ok: true });
      expect(sessions.size).toBe(0);
      const clearedCookie = (logoutRes.headers['set-cookie'] as string[])[0];
      expect(clearedCookie).toContain('rf_session=;');
    });
  });

  describe('GET /auth/me', () => {
    it('returns authenticated: true with valid session', async () => {
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      const cookie = (loginRes.headers['set-cookie'] as string[])[0];

      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: true });
    });

    it('returns authenticated: false with no session', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
    });

    it('returns authenticated: false with expired session', async () => {
      sessions.set('expired', new Date(Date.now() - 1000));
      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', 'rf_session=expired');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
    });
  });
});

describe('Admin route protection', () => {
  let appWithAdmin: Express;
  let sessions: SessionStore;
  const TEST_PASSWORD = 'test-password-123';
  const testDbPath = path.join(__dirname, '../../test-data/routes-auth-admin.db');

  beforeEach(async () => {
    process.env.ADMIN_PASSWORD = TEST_PASSWORD;
    sessions = new Map();

    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const storage = new SqliteStorage(testDbPath);
    await storage.initialize();

    appWithAdmin = express();
    appWithAdmin.use(express.json());
    appWithAdmin.use(cookieParser());
    appWithAdmin.use('/auth', createAuthRouter(sessions));
    appWithAdmin.use('/admin', requireAdminSession(sessions), createAdminRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('returns 401 on /admin without session', async () => {
    const res = await request(appWithAdmin).get('/admin/api-keys');
    expect(res.status).toBe(401);
  });

  it('allows /admin with valid session cookie', async () => {
    const loginRes = await request(appWithAdmin)
      .post('/auth/login')
      .send({ password: TEST_PASSWORD });
    const cookie = (loginRes.headers['set-cookie'] as string[])[0];

    const res = await request(appWithAdmin)
      .get('/admin/api-keys')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });
});
