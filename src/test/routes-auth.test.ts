import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { requireAdminSession, SessionStore } from '../middleware/adminAuth.js';

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
});
