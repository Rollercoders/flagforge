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
  it('401 se manca lʼheader Authorization', async () => {
    const res = await request(app('secret')).get('/x');
    expect(res.status).toBe(401);
  });

  it('401 se il token è errato', async () => {
    const res = await request(app('secret')).get('/x').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('401 se lo schema non è Bearer', async () => {
    const res = await request(app('secret')).get('/x').set('Authorization', 'secret');
    expect(res.status).toBe(401);
  });

  it('passa oltre col token corretto', async () => {
    const res = await request(app('secret')).get('/x').set('Authorization', 'Bearer secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
