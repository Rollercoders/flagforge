import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mcpBearerAuth } from '../mcp/auth.js';

function app(token: string) {
  const a = express();
  a.use(mcpBearerAuth(token));
  a.get('/x', (_req, res) => res.json({ ok: true }));
  return a;
}

describe('mcpBearerAuth', () => {
  it('401 if the Authorization header is missing', async () => {
    const res = await request(app('secret')).get('/x');
    expect(res.status).toBe(401);
  });

  it('401 if the token is wrong', async () => {
    const res = await request(app('secret')).get('/x').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('401 if the scheme is not Bearer', async () => {
    const res = await request(app('secret')).get('/x').set('Authorization', 'secret');
    expect(res.status).toBe(401);
  });

  it('passes through with the correct token', async () => {
    const res = await request(app('secret')).get('/x').set('Authorization', 'Bearer secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
