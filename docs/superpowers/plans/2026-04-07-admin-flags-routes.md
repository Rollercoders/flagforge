# Admin Flags Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere route `/admin/flags` e `/admin/evaluate` protette da session auth per la UI, lasciando invariate le route `/api/flags` e `/api/evaluate` per i client SDK.

**Architecture:** Si aggiungono due nuovi router (`createAdminFlagsRouter`, `createAdminEvaluateRouter`) montati sotto `/admin` con `requireAdminSession`. La UI viene aggiornata per chiamare i nuovi path. Le route `/api/*` restano intatte. I nuovi router per la UI non derivano `projectId`/`environment` dall'API key ma li leggono da query params/body (già passati dalla UI).

**Tech Stack:** Node.js, TypeScript, Express, Vitest + Supertest

---

## File Map

| File | Azione |
|---|---|
| `src/routes/adminFlags.ts` | Crea: router flags per UI (session auth) |
| `src/routes/adminEvaluate.ts` | Crea: router evaluate per UI (session auth) |
| `src/index.ts` | Modifica: monta i nuovi router sotto `/admin` |
| `ui/src/api/client.ts` | Modifica: rimuove la logica del bearer token UI |
| `ui/src/api/flags.ts` | Modifica: cambia i path da `/api/flags` a `/admin/flags` |
| `src/test/routes-adminFlags.test.ts` | Crea: test di integrazione per i nuovi router |

---

### Task 1: Creare `src/routes/adminFlags.ts`

**Files:**
- Create: `src/routes/adminFlags.ts`

- [ ] **Step 1: Scrivere il file**

```typescript
import { Router } from 'express';
import { Storage, Flag } from '../types.js';

export function createAdminFlagsRouter(storage: Storage) {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const { key, name, description, targeting, rollout, projectId, environment } = req.body as {
        key: string;
        name: string;
        description?: string;
        targeting?: Flag['targeting'];
        rollout?: Flag['rollout'];
        projectId: string;
        environment: string;
      };
      if (!key || !name || !projectId || !environment) {
        res.status(400).json({ error: 'key, name, projectId and environment are required' });
        return;
      }
      const flags = await storage.createFlag({ projectId, key, name, description, enabled: false, environment, targeting, rollout });
      const flagForEnv = flags.find(f => f.environment === environment);
      if (!flagForEnv) {
        res.status(500).json({ error: 'Internal error: flag not created for expected environment' });
        return;
      }
      res.status(201).json(flagForEnv);
    } catch (_error: any) {
      if (_error.message?.includes('UNIQUE constraint') || _error.message?.includes('already exists')) {
        res.status(409).json({ error: 'Flag with this key already exists in this project' });
      } else {
        res.status(500).json({ error: 'Failed to create flag' });
      }
    }
  });

  router.get('/', async (req, res) => {
    try {
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
      const flags = await storage.getAllFlags(projectId, environment);
      res.json(flags);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flags' });
    }
  });

  router.get('/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      res.json(flag);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch flag' });
    }
  });

  router.patch('/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      const updates: Partial<Pick<Flag, 'name' | 'description' | 'enabled' | 'targeting' | 'rollout'>> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.targeting !== undefined) updates.targeting = req.body.targeting;
      if (req.body.rollout !== undefined) updates.rollout = req.body.rollout;
      const updated = await storage.updateFlag(flag.id, updates);
      res.json(updated);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to update flag' });
    }
  });

  router.delete('/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const projectId = req.query['projectId'];
      const environment = req.query['environment'];
      if (typeof projectId !== 'string' || typeof environment !== 'string') {
        res.status(400).json({ error: 'projectId and environment query params are required' });
        return;
      }
      const flag = await storage.getFlag(projectId, key, environment);
      if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
      await storage.deleteFlag(projectId, key);
      res.status(204).send();
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete flag' });
    }
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/adminFlags.ts
git commit -m "feat: add admin flags router for UI session auth"
```

---

### Task 2: Creare `src/routes/adminEvaluate.ts`

**Files:**
- Create: `src/routes/adminEvaluate.ts`

- [ ] **Step 1: Scrivere il file**

```typescript
import { Router } from 'express';
import { Storage, FlagEvaluationContext } from '../types.js';
import { FlagEvaluator } from '../evaluator.js';

export function createAdminEvaluateRouter(storage: Storage, evaluator: FlagEvaluator) {
  const router = Router();

  router.post('/all', async (req, res) => {
    try {
      const { projectId, environment, userId, attributes } = req.body as {
        projectId: string;
        environment: string;
        userId?: string;
        attributes?: Record<string, string>;
      };
      if (!projectId || !environment) {
        res.status(400).json({ error: 'projectId and environment are required' });
        return;
      }
      const context: FlagEvaluationContext = { userId, attributes };
      const flags = await storage.getAllFlags(projectId, environment);
      const results: Record<string, boolean> = {};
      for (const flag of flags) {
        results[flag.key] = evaluator.evaluate(flag, context);
      }
      res.json(results);
    } catch (_error) {
      res.status(500).json({ error: 'Failed to evaluate flags' });
    }
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/adminEvaluate.ts
git commit -m "feat: add admin evaluate router for UI session auth"
```

---

### Task 3: Montare i nuovi router in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Aggiungere gli import**

Aggiungere dopo la riga `import { createProjectsRouter } from './routes/projects.js';`:

```typescript
import { createAdminFlagsRouter } from './routes/adminFlags.js';
import { createAdminEvaluateRouter } from './routes/adminEvaluate.js';
```

- [ ] **Step 2: Montare le route**

Aggiungere dopo `app.use('/admin', requireAdminSession(sessions), createProjectsRouter(storage));`:

```typescript
app.use('/admin/flags', requireAdminSession(sessions), createAdminFlagsRouter(storage));
app.use('/admin/evaluate', requireAdminSession(sessions), createAdminEvaluateRouter(storage, evaluator));
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: mount admin flags and evaluate routes"
```

---

### Task 4: Aggiornare la UI — rimuovere il bearer token e puntare ai nuovi path

**Files:**
- Modify: `ui/src/api/client.ts`
- Modify: `ui/src/api/flags.ts`

- [ ] **Step 1: Riscrivere `ui/src/api/client.ts`**

Sostituire l'intero contenuto con:

```typescript
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'same-origin',
  });
}
```

- [ ] **Step 2: Aggiornare i path in `ui/src/api/flags.ts`**

Cambiare tutte le occorrenze di `/api/flags` con `/admin/flags`:

- riga `getFlags`: url `/api/flags?...` → `/admin/flags?...`
- riga `createFlag`: `'/api/flags'` → `'/admin/flags'`
- riga `updateFlag`: `` `/api/flags/${key}?...` `` → `` `/admin/flags/${key}?...` ``
- riga `deleteFlag`: `` `/api/flags/${key}?...` `` → `` `/admin/flags/${key}?...` ``

Il file risultante:

```typescript
import { apiFetch } from './client';

export interface Flag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  environment: string;
  targeting?: {
    userIds?: string[];
    attributes?: Record<string, string[]>;
  };
  rollout?: {
    percentage: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlagPayload {
  key: string;
  name: string;
  description?: string;
  targeting?: Flag['targeting'];
  rollout?: Flag['rollout'];
}

export interface UpdateFlagPayload {
  name?: string;
  description?: string;
  enabled?: boolean;
  targeting?: Flag['targeting'];
  rollout?: Flag['rollout'];
}

export async function getFlags(projectId: string, environment: string): Promise<Flag[]> {
  const url = `/admin/flags?projectId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to fetch flags');
  return res.json() as Promise<Flag[]>;
}

export async function createFlag(projectId: string, environment: string, payload: CreateFlagPayload): Promise<Flag> {
  const res = await apiFetch('/admin/flags', {
    method: 'POST',
    body: JSON.stringify({ ...payload, projectId, environment }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to create flag');
  }
  return res.json() as Promise<Flag>;
}

export async function updateFlag(key: string, projectId: string, environment: string, payload: UpdateFlagPayload): Promise<Flag> {
  const url = `/admin/flags/${key}?projectId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}`;
  const res = await apiFetch(url, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to update flag');
  }
  return res.json() as Promise<Flag>;
}

export async function deleteFlag(key: string, projectId: string, environment: string): Promise<void> {
  const url = `/admin/flags/${key}?projectId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}`;
  const res = await apiFetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete flag');
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/api/client.ts ui/src/api/flags.ts
git commit -m "feat: update UI to use /admin/flags routes with session auth"
```

---

### Task 5: Scrivere i test di integrazione per i nuovi router

**Files:**
- Create: `src/test/routes-adminFlags.test.ts`

- [ ] **Step 1: Scrivere il test**

```typescript
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
```

- [ ] **Step 2: Eseguire i test per verificare che passino**

```bash
yarn test src/test/routes-adminFlags.test.ts
```

Expected: tutti i test PASS.

- [ ] **Step 3: Eseguire tutti i test per verificare nessuna regressione**

```bash
yarn test
```

Expected: tutti i test PASS.

- [ ] **Step 4: Commit**

```bash
git add src/test/routes-adminFlags.test.ts
git commit -m "test: add integration tests for admin flags routes"
```

---

### Task 6: Build UI e verifica finale

**Files:**
- Nessun file modificato

- [ ] **Step 1: Build della UI**

```bash
cd ui && yarn build
```

Expected: build completata senza errori TypeScript.

- [ ] **Step 2: Avviare il server e verificare manualmente**

```bash
yarn dev
```

Aprire il browser, fare login con la password admin, verificare che i flag vengano caricati senza errore "Invalid API key".

- [ ] **Step 3: Commit finale se tutto ok**

```bash
git add -A
git commit -m "chore: verify admin flags UI integration"
```
