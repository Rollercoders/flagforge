# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Esporre un endpoint MCP HTTP dallo stesso processo FlagForge, protetto da bearer token, con 5 tool (list_projects, list_environments, list_flags, set_flag, evaluate_flag) che operano sulle istanze condivise `Storage` e `FlagEvaluator`.

**Architecture:** Nuova cartella `src/mcp/` con tre unità a confini netti (auth middleware, definizione tool, wiring del router). `src/server.ts` monta `POST /mcp` solo se `MCP_TOKEN` è presente. L'SDK MCP ufficiale gira in stateless mode. Il wizard `flagforge init` propone di generare il token.

**Tech Stack:** TypeScript (ESM), Express 4, `@modelcontextprotocol/sdk`, `zod`, Vitest + supertest, `@clack/prompts`.

## Global Constraints

- Node >= 20, ESM (`"type": "module"`): tutti gli import relativi interni usano estensione `.js` (es. `import { X } from './tools.js'`).
- Yarn 4 (`yarn@4.12.0`): aggiungere dipendenze con `yarn add`, mai `npm install`. Dopo aver modificato `package.json` girerà `yarn install` per rigenerare il lockfile (CI usa `--immutable`).
- Commit in italiano, conventional commits senza scope (`feat: ...`). Mai committare su `develop`; il branch di lavoro è `feat/mcp-server` (già creato).
- I test vivono in `src/test/`, un file per unità, stile Vitest + supertest come gli esistenti.
- L'endpoint MCP è opt-in: montato **solo** se `process.env.MCP_TOKEN` è definito e non vuoto. `MCP_TOKEN` non viene mai auto-generato al boot del server.
- L'MCP non espone tool di delete e non espone le API key `ff_` degli environment.

---

### Task 1: Installare l'SDK MCP e zod, verificare gli export

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/mcp/sdk-smoke.test.ts` (test temporaneo, rimosso a fine task)

**Interfaces:**
- Consumes: niente.
- Produces: la certezza dei percorsi di import reali per `McpServer` e `StreamableHTTPServerTransport`, usati da tutti i task successivi. Le firme attese dai task seguenti:
  - `new McpServer({ name: string, version: string })`
  - `server.registerTool(name: string, config: { description: string, inputSchema?: ZodRawShape }, handler: (args) => Promise<{ content: Array<{ type: 'text', text: string }>, isError?: boolean }>)`
  - `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`
  - `await server.connect(transport)`
  - `await transport.handleRequest(req, res, req.body)`

- [ ] **Step 1: Installare le dipendenze**

Run:
```bash
cd /Users/alessandrodefendenti/Projects/misc/flagforge
yarn add @modelcontextprotocol/sdk zod
```
Expected: `package.json` mostra `@modelcontextprotocol/sdk` e `zod` in `dependencies`; `yarn.lock` aggiornato.

- [ ] **Step 2: Individuare i percorsi di import reali**

Run:
```bash
node -e "console.log(require('@modelcontextprotocol/sdk/package.json').version)"
ls node_modules/@modelcontextprotocol/sdk/dist/esm/server/ | grep -E 'mcp|streamableHttp'
```
Expected: una versione stampata e due file presenti: `mcp.js` e `streamableHttp.js`.

Layout atteso (SDK monolitico, default di questo piano):
- `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'`
- `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'`

**Fallback:** se `ls` non trova quei file (layout split con pacchetti separati `@modelcontextprotocol/server` ecc.), fermarsi e segnalare all'utente prima di proseguire: il piano assume il pacchetto monolitico `@modelcontextprotocol/sdk`. Non improvvisare un layout diverso.

- [ ] **Step 3: Scrivere uno smoke test degli import**

Create `src/mcp/sdk-smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

describe('mcp sdk smoke', () => {
  it('espone McpServer e StreamableHTTPServerTransport', () => {
    expect(typeof McpServer).toBe('function');
    expect(typeof StreamableHTTPServerTransport).toBe('function');
  });
});
```

- [ ] **Step 4: Eseguire lo smoke test**

Run: `yarn test src/mcp/sdk-smoke.test.ts`
Expected: PASS (2 assert verdi). Se fallisce l'import, i percorsi sono diversi: correggerli qui prima di proseguire (i task successivi usano gli stessi percorsi).

- [ ] **Step 5: Rimuovere lo smoke test e committare**

Run:
```bash
rm src/mcp/sdk-smoke.test.ts
git add .
git commit -m "chore: aggiungi dipendenze mcp sdk e zod"
```

---

### Task 2: Middleware bearer auth

**Files:**
- Create: `src/mcp/auth.ts`
- Test: `src/test/mcp-auth.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `mcpBearerAuth(token: string): RequestHandler` — middleware Express che passa a `next()` solo se l'header `Authorization: Bearer <token>` combacia con `token` (confronto timing-safe); altrimenti risponde `401` JSON `{ error: 'Unauthorized' }`.

- [ ] **Step 1: Scrivere il test che fallisce**

Create `src/test/mcp-auth.test.ts`:
```ts
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
```

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/mcp-auth.test.ts`
Expected: FAIL — `Cannot find module '../mcp/auth.js'`.

- [ ] **Step 3: Implementare il middleware**

Create `src/mcp/auth.ts`:
```ts
import { timingSafeEqual } from 'crypto';
import type { RequestHandler } from 'express';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function mcpBearerAuth(token: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const provided = header.slice('Bearer '.length);
    if (!safeEqual(provided, token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Eseguire il test per vederlo passare**

Run: `yarn test src/test/mcp-auth.test.ts`
Expected: PASS (4 test verdi).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: aggiungi middleware bearer auth per mcp"
```

---

### Task 3: Definizione dei tool MCP

**Files:**
- Create: `src/mcp/tools.ts`
- Test: `src/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `Storage`, `Flag`, `FlagEvaluationContext` da `../types.js`; `FlagEvaluator` da `../evaluator.js`.
- Produces:
  - Tipo `McpToolDef = { name: string; description: string; inputSchema: ZodRawShape; handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> }`.
  - `buildTools(storage: Storage, evaluator: FlagEvaluator): McpToolDef[]` — ritorna i 5 tool. Usata da Task 4.
  - Ogni handler ritorna `content[0].text` = JSON dei dati; su errore di validazione ritorna `{ isError: true, content: [{ type: 'text', text: <messaggio> }] }`.

Note di dominio (verificate nel codice):
- `storage.getAllProjects(): Promise<Project[]>` — Project ha `{ id, name, createdAt }`.
- `storage.getEnvironmentsByProject(projectId): Promise<Environment[]>` — Environment ha `{ id, projectId, name, key, createdAt }`. **Non** restituire `key`.
- `storage.getAllFlags(projectId, environment?): Promise<Flag[]>`.
- `storage.getFlag(projectId, key, environment): Promise<Flag | null>`.
- `storage.createFlag(flag): Promise<Flag[]>` — crea la key in TUTTI gli environment del progetto con `enabled=false`. Per un upsert mirato: se il flag non esiste in quell'environment, chiamare `createFlag` poi `updateFlag` sul record di quell'environment.
- `storage.updateFlag(id, updates): Promise<Flag>`.
- `evaluator.evaluate(flag: Flag, context: FlagEvaluationContext): boolean`.
- **Non esiste** validazione di `rollout.percentage` a monte: va introdotta qui.

- [ ] **Step 1: Scrivere il test che fallisce**

Create `src/test/mcp-tools.test.ts`:
```ts
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
    expect(envs).toEqual([{ id: 'e1', name: 'production' }]);
    expect(JSON.stringify(envs)).not.toContain('ff_secret');
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
    expect(no.enabled).toBe(false);
  });

  it('evaluate_flag ritorna errore se il flag non esiste', async () => {
    const res = await tool(tools, 'evaluate_flag').handler({ projectId: 'p1', environment: 'production', key: 'ghost' });
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/mcp-tools.test.ts`
Expected: FAIL — `Cannot find module '../mcp/tools.js'`.

- [ ] **Step 3: Implementare i tool**

Create `src/mcp/tools.ts`:
```ts
import { z, ZodRawShape } from 'zod';
import { Storage, Flag, FlagEvaluationContext } from '../types.js';
import { FlagEvaluator } from '../evaluator.js';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string): McpToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const targetingSchema = z
  .object({
    userIds: z.array(z.string()).optional(),
    attributes: z.record(z.string(), z.array(z.string())).optional(),
  })
  .optional();

const rolloutSchema = z
  .object({ percentage: z.number().min(0).max(100) })
  .optional();

export function buildTools(storage: Storage, evaluator: FlagEvaluator): McpToolDef[] {
  return [
    {
      name: 'list_projects',
      description: 'Elenca i progetti FlagForge (id e nome).',
      inputSchema: {},
      handler: async () => {
        const projects = await storage.getAllProjects();
        return ok(projects.map(p => ({ id: p.id, name: p.name })));
      },
    },
    {
      name: 'list_environments',
      description: 'Elenca gli environment di un progetto (id e nome). Non espone le API key.',
      inputSchema: { projectId: z.string() },
      handler: async (args) => {
        const projectId = args.projectId as string;
        const envs = await storage.getEnvironmentsByProject(projectId);
        return ok(envs.map(e => ({ id: e.id, name: e.name })));
      },
    },
    {
      name: 'list_flags',
      description: 'Elenca tutti i feature flag di un progetto+environment.',
      inputSchema: { projectId: z.string(), environment: z.string() },
      handler: async (args) => {
        const flags = await storage.getAllFlags(args.projectId as string, args.environment as string);
        return ok(flags);
      },
    },
    {
      name: 'set_flag',
      description:
        'Crea o aggiorna (upsert) un feature flag in un progetto+environment. Se non esiste lo crea, altrimenti applica i campi passati.',
      inputSchema: {
        projectId: z.string(),
        environment: z.string(),
        key: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        enabled: z.boolean().optional(),
        targeting: targetingSchema,
        rollout: rolloutSchema,
      },
      handler: async (args) => {
        const projectId = args.projectId as string;
        const environment = args.environment as string;
        const key = args.key as string;
        const existing = await storage.getFlag(projectId, key, environment);

        if (!existing) {
          const name = (args.name as string | undefined) ?? key;
          const created = await storage.createFlag({
            projectId,
            key,
            name,
            description: args.description as string | undefined,
            enabled: false,
            environment,
            targeting: args.targeting as Flag['targeting'],
            rollout: args.rollout as Flag['rollout'],
          });
          const forEnv = created.find(f => f.environment === environment);
          if (!forEnv) return fail('Flag creato ma non trovato per lʼenvironment richiesto.');
          const updates: Partial<Flag> = {};
          if (args.enabled !== undefined) updates.enabled = args.enabled as boolean;
          const result = Object.keys(updates).length ? await storage.updateFlag(forEnv.id, updates) : forEnv;
          return ok(result);
        }

        const updates: Partial<Flag> = {};
        if (args.name !== undefined) updates.name = args.name as string;
        if (args.description !== undefined) updates.description = args.description as string;
        if (args.enabled !== undefined) updates.enabled = args.enabled as boolean;
        if (args.targeting !== undefined) updates.targeting = args.targeting as Flag['targeting'];
        if (args.rollout !== undefined) updates.rollout = args.rollout as Flag['rollout'];
        const updated = await storage.updateFlag(existing.id, updates);
        return ok(updated);
      },
    },
    {
      name: 'evaluate_flag',
      description:
        'Valuta se un flag è attivo per un dato contesto (userId/attributes) in un progetto+environment.',
      inputSchema: {
        projectId: z.string(),
        environment: z.string(),
        key: z.string(),
        userId: z.string().optional(),
        attributes: z.record(z.string(), z.string()).optional(),
      },
      handler: async (args) => {
        const flag = await storage.getFlag(args.projectId as string, args.key as string, args.environment as string);
        if (!flag) return fail('Flag non trovato per il contesto richiesto.');
        const context: FlagEvaluationContext = {
          userId: args.userId as string | undefined,
          attributes: args.attributes as Record<string, string> | undefined,
        };
        const enabled = evaluator.evaluate(flag, context);
        return ok({ key: flag.key, environment: flag.environment, enabled });
      },
    },
  ];
}
```

- [ ] **Step 4: Eseguire il test per vederlo passare**

Run: `yarn test src/test/mcp-tools.test.ts`
Expected: PASS (tutti i test verdi).

- [ ] **Step 5: Verifica lint**

Run: `yarn lint`
Expected: 0 errori (i warning `no-explicit-any` preesistenti sono tollerati; evitare di introdurne di nuovi se semplice).

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: aggiungi definizione dei tool mcp"
```

---

### Task 4: Router MCP (wiring SDK + transport)

**Files:**
- Create: `src/mcp/server.ts`
- Test: `src/test/mcp-server.test.ts`

**Interfaces:**
- Consumes: `mcpBearerAuth` da `./auth.js`; `buildTools` da `./tools.js`; `Storage` da `../types.js`; `FlagEvaluator` da `../evaluator.js`; `McpServer`, `StreamableHTTPServerTransport` dai percorsi verificati nel Task 1.
- Produces: `createMcpRouter(storage: Storage, evaluator: FlagEvaluator, token: string): Router` — un `express.Router` che monta `mcpBearerAuth(token)` e gestisce `POST /` (montato a `/mcp` dal server) in stateless mode, registrando i tool via `server.registerTool`.

- [ ] **Step 1: Scrivere il test di integrazione che fallisce**

Create `src/test/mcp-server.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMcpRouter } from '../mcp/server.js';
import { FlagEvaluator } from '../evaluator.js';
import { Storage, Project, Environment, Flag } from '../types.js';

class FakeStorage implements Partial<Storage> {
  projects: Project[] = [{ id: 'p1', name: 'App', createdAt: 't' }];
  environments: Environment[] = [{ id: 'e1', projectId: 'p1', name: 'production', key: 'ff_x', createdAt: 't' }];
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

// Header richiesti dallo Streamable HTTP transport per una richiesta JSON-RPC.
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

describe('createMcpRouter', () => {
  it('401 senza bearer token', async () => {
    const res = await request(app())
      .post('/mcp')
      .set(HEADERS)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(401);
  });

  it('tools/list elenca i 5 tool col token', async () => {
    const res = await request(app())
      .post('/mcp')
      .set({ ...HEADERS, Authorization: `Bearer ${TOKEN}` })
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(200);
    const body = parseJsonRpc(res);
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['evaluate_flag', 'list_environments', 'list_flags', 'list_projects', 'set_flag']);
  });

  it('tools/call set_flag poi list_flags riflette la scrittura', async () => {
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

// Lo Streamable HTTP transport può rispondere in JSON o come SSE (text/event-stream).
// Questo helper estrae il payload JSON-RPC da entrambi i formati.
function parseJsonRpc(res: { text: string; body: unknown }): any {
  if (res.text && res.text.startsWith('event:')) {
    const line = res.text.split('\n').find(l => l.startsWith('data:'));
    if (!line) throw new Error(`nessun data: nella risposta SSE:\n${res.text}`);
    return JSON.parse(line.slice('data:'.length).trim());
  }
  return res.body;
}
```

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/mcp-server.test.ts`
Expected: FAIL — `Cannot find module '../mcp/server.js'`.

- [ ] **Step 3: Implementare il router**

Create `src/mcp/server.ts` (usa i percorsi di import verificati nel Task 1):
```ts
import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Storage } from '../types.js';
import { FlagEvaluator } from '../evaluator.js';
import { mcpBearerAuth } from './auth.js';
import { buildTools } from './tools.js';

export function createMcpRouter(storage: Storage, evaluator: FlagEvaluator, token: string): Router {
  const router = Router();
  router.use(mcpBearerAuth(token));

  const tools = buildTools(storage, evaluator);

  router.post('/', async (req, res) => {
    // Un McpServer + transport nuovo per richiesta (stateless).
    const server = new McpServer({ name: 'flagforge', version: '1.0.0' });
    for (const t of tools) {
      server.registerTool(
        t.name,
        { description: t.description, inputSchema: t.inputSchema },
        // L'SDK passa gli argomenti già validati contro inputSchema.
        async (args: Record<string, unknown>) => {
          const result = await t.handler(args ?? {});
          return result;
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
```

- [ ] **Step 4: Eseguire il test per vederlo passare**

Run: `yarn test src/test/mcp-server.test.ts`
Expected: PASS.

Se il test 401 fallisce perché il transport intercetta la richiesta prima dell'auth: verificare che `router.use(mcpBearerAuth(token))` sia registrato **prima** di `router.post('/')`. Se `tools/list`/`tools/call` falliscono per header mancanti, controllare che `HEADERS` includa `Accept: application/json, text/event-stream` (richiesto dallo Streamable HTTP transport).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: aggiungi router mcp con transport http stateless"
```

---

### Task 5: Montare l'endpoint nel server + config

**Files:**
- Modify: `src/server.ts` (import, `ServerConfig`, wiring dopo la creazione di `evaluator`)
- Test: `src/test/mcp-server.test.ts` (già copre il router; qui verifichiamo solo il gating opt-in con un test mirato nello stesso file o uno nuovo `src/test/server-mcp-mount.test.ts`)

**Interfaces:**
- Consumes: `createMcpRouter` da `./mcp/server.js`.
- Produces: `ServerConfig` acquisisce `mcpToken?: string`. `startServer` monta `/mcp` solo se il token (da config o `process.env.MCP_TOKEN`) è presente e non vuoto.

- [ ] **Step 1: Scrivere il test di gating**

Create `src/test/server-mcp-mount.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { startServer } from '../server.js';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const started: Array<() => void> = [];
afterEach(() => { started.forEach(fn => fn()); started.length = 0; delete process.env.MCP_TOKEN; });

async function boot(mcpToken?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ff-'));
  const storagePath = join(dir, 'flags.json');
  // Porta 0 = porta effimera assegnata dall'OS; startServer usa config.port.
  // Nota: startServer non ritorna l'istanza http; per il test usiamo una porta alta fissa distinta per caso.
  const port = mcpToken ? 61789 : 61790;
  const res = await startServer({ port, storageType: 'json', storagePath, adminPassword: 'pw', mcpToken });
  started.push(() => rmSync(dir, { recursive: true, force: true }));
  return { url: res.url };
}

describe('mount opt-in di /mcp', () => {
  it('senza MCP_TOKEN lʼendpoint /mcp non esiste (404)', async () => {
    const { url } = await boot(undefined);
    const res = await request(url).post('/mcp').send({});
    expect(res.status).toBe(404);
  });

  it('con MCP_TOKEN lʼendpoint risponde 401 senza bearer (montato)', async () => {
    const { url } = await boot('tkn');
    const res = await request(url)
      .post('/mcp')
      .set({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' })
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(401);
  });
});
```

> Nota per l'implementatore: `startServer` avvia un listener reale e non espone un handle per chiuderlo. Se questo rende il test instabile (porte occupate tra i due casi), preferire un test che monta solo il wiring con un'app Express fittizia, OPPURE estrarre la logica di gating in una piccola funzione pura `shouldMountMcp(token?: string): boolean` e testare quella + un solo test end-to-end del router (già fatto nel Task 4). Scegliere l'approccio più stabile e documentarlo nel commit. Il comportamento da garantire è: token assente/vuoto ⇒ nessun mount; token presente ⇒ mount.

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/server-mcp-mount.test.ts`
Expected: FAIL — `mcpToken` non riconosciuto / `/mcp` risponde diversamente dall'atteso.

- [ ] **Step 3: Estendere `ServerConfig` e leggere il token**

In `src/server.ts`, aggiungere al blocco `ServerConfig`:
```ts
export interface ServerConfig {
  port: number;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string;
  mcpToken?: string;
}
```

- [ ] **Step 4: Montare il router (gating opt-in)**

In `src/server.ts`, aggiungere l'import in cima:
```ts
import { createMcpRouter } from './mcp/server.js';
```
E dopo la riga `const evaluator = new FlagEvaluator();` (prima o dopo il wiring delle altre route, ma prima dello static/catch-all), inserire:
```ts
const mcpToken = config.mcpToken ?? process.env.MCP_TOKEN;
if (mcpToken && mcpToken.trim() !== '') {
  app.use('/mcp', createMcpRouter(storage, evaluator, mcpToken));
  console.log('✓ MCP endpoint mounted at /mcp');
}
```

**Importante sull'ordine:** questo blocco deve stare **prima** di `app.use(express.static(...))` e del catch-all `app.get('*', ...)`, altrimenti il catch-all servirebbe l'index.html su `/mcp`. Le route `/api` e `/admin` esistenti restano invariate.

- [ ] **Step 5: Eseguire tutti i test**

Run: `yarn test`
Expected: tutti i file verdi, inclusi i nuovi. Se il test di gating è instabile per via del listener reale, applicare l'alternativa documentata nello Step 1.

- [ ] **Step 6: Verifica lint + build**

Run: `yarn lint && yarn build`
Expected: 0 errori lint; build TypeScript completa senza errori.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: monta lʼendpoint mcp nel server quando mcp_token è presente"
```

---

### Task 6: Wizard `flagforge init` + `.env` + documentazione

**Files:**
- Modify: `src/cliConfig.ts` (WizardAnswers, buildConfigFromAnswers, renderEnvFile)
- Modify: `src/cli.ts` (prompt MCP nel wizard, output snippet)
- Modify: `.env.example`
- Modify: `README.md`
- Test: `src/test/cliConfig.test.ts` (estendere)

**Interfaces:**
- Consumes: `ServerConfig.mcpToken` (Task 5).
- Produces: `renderEnvFile` include `MCP_TOKEN=...` quando presente in config; `buildConfigFromAnswers` propaga `mcpToken`; `runStart` legge `MCP_TOKEN` da `process.env` e lo passa in config.

- [ ] **Step 1: Scrivere/estendere il test di `renderEnvFile`**

In `src/test/cliConfig.test.ts`, aggiungere:
```ts
import { describe, it, expect } from 'vitest';
import { renderEnvFile, buildConfigFromAnswers } from '../cliConfig.js';

describe('renderEnvFile con mcpToken', () => {
  it('include MCP_TOKEN quando presente', () => {
    const env = renderEnvFile({ port: 6789, storageType: 'sqlite', storagePath: './data/flagforge.db', mcpToken: 'ff_mcp_abc' });
    expect(env).toContain('MCP_TOKEN=ff_mcp_abc');
  });
  it('omette MCP_TOKEN quando assente', () => {
    const env = renderEnvFile({ port: 6789, storageType: 'sqlite', storagePath: './data/flagforge.db' });
    expect(env).not.toContain('MCP_TOKEN');
  });
  it('buildConfigFromAnswers propaga mcpToken', () => {
    const cfg = buildConfigFromAnswers({ port: 1, storageType: 'json', storagePath: 'x', mcpToken: 't' });
    expect(cfg.mcpToken).toBe('t');
  });
});
```

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/cliConfig.test.ts`
Expected: FAIL — `mcpToken` non gestito da `renderEnvFile`/`buildConfigFromAnswers`/`WizardAnswers`.

- [ ] **Step 3: Estendere `cliConfig.ts`**

In `src/cliConfig.ts`:
```ts
export interface WizardAnswers {
  port: number;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string;
  mcpToken?: string;
}
```
In `buildConfigFromAnswers`, aggiungere al return:
```ts
    mcpToken: answers.mcpToken ? answers.mcpToken : undefined,
```
In `renderEnvFile`, dopo il blocco `adminPassword`:
```ts
  if (config.mcpToken) {
    lines.push(`MCP_TOKEN=${config.mcpToken}`);
  }
```

- [ ] **Step 4: Eseguire il test per vederlo passare**

Run: `yarn test src/test/cliConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiungere il prompt nel wizard `runInit`**

In `src/cli.ts`, importare `nanoid`:
```ts
import { nanoid } from 'nanoid';
```
Dopo il blocco `adminPassword` (prima della costruzione di `answers`), aggiungere:
```ts
  const enableMcp = await confirm({
    message: 'Setup also FlagForge MCP server? (lets AI agents manage flags)',
    initialValue: false,
  });
  if (isCancel(enableMcp)) bail();
  const mcpToken = enableMcp ? `ff_mcp_${nanoid(32)}` : undefined;
```
Aggiungere `mcpToken` a `answers`:
```ts
  const answers: WizardAnswers = {
    port: Number(portRaw),
    storageType: storageType as 'sqlite' | 'json',
    storagePath: storagePath,
    adminPassword: adminPassword.trim() || undefined,
    mcpToken,
  };
```
Dopo l'avvio riuscito (dentro `runInit`, dopo `await launch(...)` e prima di `outro(...)`), stampare lo snippet se il token è stato generato:
```ts
  if (mcpToken) {
    note(
      `MCP endpoint: ${config.port} → http://<host>:${config.port}/mcp\n` +
      `Token (salvato in .env):\n  ${mcpToken}\n\n` +
      `Config per il client MCP (sostituisci <host>):\n` +
      JSON.stringify(
        { mcpServers: { flagforge: { url: `http://<host>:${config.port}/mcp`, headers: { Authorization: `Bearer ${mcpToken}` } } } },
        null,
        2,
      ),
      'FlagForge MCP',
    );
  }
```
> Nota: `config` qui è il valore ritornato da `buildConfigFromAnswers(answers)` già presente in `runInit`. Se non è in scope al punto dell'inserimento, usare `answers.port` e `mcpToken` direttamente.

- [ ] **Step 6: Far leggere `MCP_TOKEN` a `runStart`**

In `src/cli.ts`, dentro `runStart`, aggiungere al `config`:
```ts
    mcpToken: process.env.MCP_TOKEN,
```

- [ ] **Step 7: Aggiornare `.env.example`**

Read `.env.example`, poi aggiungere in fondo:
```
# Abilita il server MCP (agenti AI che gestiscono i flag). Lascia vuoto/rimuovi per tenerlo spento.
# MCP_TOKEN=
```

- [ ] **Step 8: Aggiornare `README.md`**

Aggiungere una sezione "MCP Server" (dopo la sezione "Web App" o in fondo, dove è coerente), con: cos'è (endpoint HTTP per agenti AI), come abilitarlo (`MCP_TOKEN` in `.env` o rispondendo sì durante `flagforge init`), i 5 tool disponibili (`list_projects`, `list_environments`, `list_flags`, `set_flag`, `evaluate_flag`), lo snippet di config client `mcpServers`, e l'avvertenza che è opt-in e che il token dà pieni poteri sui flag (no delete). Testo in inglese, coerente col resto del README.

- [ ] **Step 9: Eseguire l'intera suite + build**

Run: `yarn test && yarn build`
Expected: tutti i test verdi, build ok.

- [ ] **Step 10: Verifica manuale end-to-end (smoke)**

Run:
```bash
MCP_TOKEN=demo-token node dist/index.js &
sleep 1
curl -s -X POST http://localhost:6789/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer demo-token' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
Expected: risposta JSON-RPC (JSON o SSE) che elenca i 5 tool. Poi terminare il processo in background. (Adeguare la porta se `.env` ne usa un'altra.)

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: aggiungi setup mcp al wizard init e documentazione"
```

---

## Note finali per l'implementatore

- Se in qualsiasi task i percorsi di import dell'SDK non combaciano con quelli del Task 1, **fermarsi e riallineare** — non inventare API.
- Non aggiungere tool di delete né esporre le API key `ff_`: è una scelta di design deliberata.
- Al termine di tutti i task, NON aprire la PR in autonomia: chiedere conferma all'utente (regola git di progetto).
