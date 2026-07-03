import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools, McpToolDef } from '../mcp/tools.js';
import { FlagEvaluator } from '../evaluator.js';
import { Storage, Project, Environment, Flag } from '../types.js';

// Storage fake in-memory: implementa solo i metodi usati dai tool.
class FakeStorage implements Partial<Storage> {
  projects: Project[] = [];
  environments: Environment[] = [];
  flags: Flag[] = [];

  async getAllProjects() { return this.projects; }
  async getEnvironmentsByProject(projectId: string) {
    return this.environments.filter(e => e.projectId === projectId);
  }
  async getAllFlags(projectId: string, environment?: string) {
    return this.flags.filter(f => f.projectId === projectId && (!environment || f.environment === environment));
  }
  async getFlag(projectId: string, key: string, environment: string) {
    return this.flags.find(f => f.projectId === projectId && f.key === key && f.environment === environment) ?? null;
  }
  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>) {
    const created: Flag = { ...flag, id: `flag_${this.flags.length}`, createdAt: 't', updatedAt: 't' };
    this.flags.push(created);
    return [created];
  }
  async updateFlag(id: string, updates: Partial<Flag>) {
    const f = this.flags.find(x => x.id === id)!;
    Object.assign(f, updates, { updatedAt: 't2' });
    return f;
  }
}

function tool(tools: McpToolDef[], name: string): McpToolDef {
  const t = tools.find(x => x.name === name);
  if (!t) throw new Error(`tool ${name} mancante`);
  return t;
}
function parse(res: { content: { text: string }[] }) { return JSON.parse(res.content[0].text); }

let storage: FakeStorage;
let tools: McpToolDef[];

beforeEach(() => {
  storage = new FakeStorage();
  tools = buildTools(storage as unknown as Storage, new FlagEvaluator());
  storage.projects.push({ id: 'p1', name: 'App', createdAt: 't' });
  storage.environments.push({ id: 'e1', projectId: 'p1', name: 'production', key: 'ff_secret', createdAt: 't' });
});

describe('buildTools', () => {
  it('espone esattamente i 5 tool previsti e nessun delete', () => {
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['evaluate_flag', 'list_environments', 'list_flags', 'list_projects', 'set_flag']);
  });

  it('list_projects ritorna id e name', async () => {
    const res = await tool(tools, 'list_projects').handler({});
    expect(parse(res)).toEqual([{ id: 'p1', name: 'App' }]);
  });

  it('list_environments NON espone la key ff_', async () => {
    const res = await tool(tools, 'list_environments').handler({ projectId: 'p1' });
    const envs = parse(res);
    expect(envs).toEqual([{ name: 'production' }]);
    expect(JSON.stringify(envs)).not.toContain('ff_secret');
  });

  it('list_environments restituisce SOLO il name, non lʼid', async () => {
    const res = await tool(tools, 'list_environments').handler({ projectId: 'p1' });
    expect(parse(res)).toEqual([{ name: 'production' }]);
    expect(JSON.stringify(res)).not.toContain('e1');
  });

  it('set_flag crea il flag quando non esiste', async () => {
    const res = await tool(tools, 'set_flag').handler({
      projectId: 'p1', environment: 'production', key: 'new-flag', name: 'New', enabled: true,
    });
    const flag = parse(res);
    expect(flag.key).toBe('new-flag');
    expect(flag.enabled).toBe(true);
    expect(storage.flags).toHaveLength(1);
  });

  it('set_flag aggiorna il flag quando esiste (spegnimento)', async () => {
    await tool(tools, 'set_flag').handler({ projectId: 'p1', environment: 'production', key: 'f', name: 'F', enabled: true });
    const res = await tool(tools, 'set_flag').handler({ projectId: 'p1', environment: 'production', key: 'f', enabled: false });
    expect(parse(res).enabled).toBe(false);
    expect(storage.flags).toHaveLength(1);
  });

  it('set_flag rifiuta rollout.percentage fuori [0,100]', async () => {
    const res = await tool(tools, 'set_flag').handler({
      projectId: 'p1', environment: 'production', key: 'f', name: 'F', rollout: { percentage: 150 },
    });
    expect(res.isError).toBe(true);
    expect(storage.flags).toHaveLength(0);
  });

  it('set_flag rifiuta un environment inesistente (es. un id al posto del name) senza scrivere nulla', async () => {
    const res = await tool(tools, 'set_flag').handler({
      projectId: 'p1', environment: 'e1', key: 'f', name: 'F', enabled: true,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('production');
    expect(storage.flags).toHaveLength(0);
  });

  it('set_flag con environment esistente continua a creare/aggiornare correttamente', async () => {
    const res = await tool(tools, 'set_flag').handler({
      projectId: 'p1', environment: 'production', key: 'f', name: 'F', enabled: true,
    });
    const flag = parse(res);
    expect(res.isError).toBeUndefined();
    expect(flag.key).toBe('f');
    expect(flag.environment).toBe('production');
    expect(storage.flags).toHaveLength(1);
  });

  it('list_flags ritorna i flag del contesto', async () => {
    await tool(tools, 'set_flag').handler({ projectId: 'p1', environment: 'production', key: 'f', name: 'F', enabled: true });
    const res = await tool(tools, 'list_flags').handler({ projectId: 'p1', environment: 'production' });
    expect(parse(res)).toHaveLength(1);
  });

  it('evaluate_flag valuta targeting per userId', async () => {
    await tool(tools, 'set_flag').handler({
      projectId: 'p1', environment: 'production', key: 'f', name: 'F', enabled: true,
      targeting: { userIds: ['alice'] },
    });
    const yes = parse(await tool(tools, 'evaluate_flag').handler({ projectId: 'p1', environment: 'production', key: 'f', userId: 'alice' }));
    const no = parse(await tool(tools, 'evaluate_flag').handler({ projectId: 'p1', environment: 'production', key: 'f', userId: 'bob' }));
    expect(yes.enabled).toBe(true);
    expect(yes.reason).toBe('enabled');
    expect(no.enabled).toBe(false);
    expect(no.reason).toBe('targeting-miss');
  });

  it('evaluate_flag ritorna errore se il flag non esiste', async () => {
    const res = await tool(tools, 'evaluate_flag').handler({ projectId: 'p1', environment: 'production', key: 'ghost' });
    expect(res.isError).toBe(true);
  });
});
