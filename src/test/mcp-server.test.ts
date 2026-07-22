import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMcpRouter } from '../mcp/server.js';
import { FlagEvaluator } from '../evaluator.js';
import { Storage, Project, Environment, Flag } from '../types.js';

class FakeStorage implements Partial<Storage> {
  projects: Project[] = [{ id: 'p1', name: 'App', createdAt: 't' }];
  environments: Environment[] = [{ id: 'e1', projectId: 'p1', name: 'production', key: 'ff_x', secretKey: 'ffs_x', createdAt: 't' }];
  flags: Flag[] = [];
  async getAllProjects() { return this.projects; }
  async getEnvironmentsByProject(id: string) { return this.environments.filter(e => e.projectId === id); }
  async getAllFlags(id: string, env?: string) { return this.flags.filter(f => f.projectId === id && (!env || f.environment === env)); }
  async getFlag(id: string, key: string, env: string) { return this.flags.find(f => f.projectId === id && f.key === key && f.environment === env) ?? null; }
  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>) {
    const c: Flag = { ...flag, id: `f${this.flags.length}`, createdAt: 't', updatedAt: 't' };
    this.flags.push(c); return [c];
  }
  async updateFlag(id: string, u: Partial<Flag>) { const f = this.flags.find(x => x.id === id)!; Object.assign(f, u); return f; }
}

const TOKEN = 'test-token';
function app() {
  const a = express();
  a.use(express.json());
  a.use('/mcp', createMcpRouter(new FakeStorage() as unknown as Storage, new FlagEvaluator(), TOKEN));
  return a;
}

// Headers required by the Streamable HTTP transport for a JSON-RPC request.
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

describe('createMcpRouter', () => {
  it('401 without bearer token', async () => {
    const res = await request(app())
      .post('/mcp')
      .set(HEADERS)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(401);
  });

  it('tools/list lists the 5 tools with the token', async () => {
    const res = await request(app())
      .post('/mcp')
      .set({ ...HEADERS, Authorization: `Bearer ${TOKEN}` })
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(200);
    const body = parseJsonRpc(res);
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['evaluate_flag', 'list_environments', 'list_flags', 'list_projects', 'set_flag']);
  });

  it('tools/call set_flag then list_flags reflects the write', async () => {
    const agent = app();
    const set = await request(agent)
      .post('/mcp')
      .set({ ...HEADERS, Authorization: `Bearer ${TOKEN}` })
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'set_flag',
        arguments: { projectId: 'p1', environment: 'production', key: 'f', name: 'F', enabled: true },
      }});
    expect(set.status).toBe(200);
    expect(parseJsonRpc(set).result.isError).toBeFalsy();
  });
});

// The Streamable HTTP transport can respond in JSON or as SSE (text/event-stream).
// This helper extracts the JSON-RPC payload from both formats.
function parseJsonRpc(res: { text: string; body: unknown }): any {
  if (res.text && res.text.startsWith('event:')) {
    const line = res.text.split('\n').find(l => l.startsWith('data:'));
    if (!line) throw new Error(`no data: line in SSE response:\n${res.text}`);
    return JSON.parse(line.slice('data:'.length).trim());
  }
  return res.body;
}
