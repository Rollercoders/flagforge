# API Key Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone API Keys model; embed one auto-generated `ff_`-prefixed key per Environment, move the admin UI key to a dedicated `admin_keys` table, and remove the API Keys screen from the frontend.

**Architecture:** The `Environment` type gains a `key` field generated at creation time. The `Storage` interface loses all `ApiKey` methods and gains `regenerateEnvironmentKey`. Auth middleware looks up the bearer token in `environments` instead of `api_keys`. The frontend removes `ApiKeysPage` and adds key display + regenerate UI directly into `ProjectsPage`.

**Tech Stack:** Node.js, TypeScript, Express, better-sqlite3, nanoid, React, Vitest, Supertest.

---

## File Map

| Action | File |
|--------|------|
| Modify | `src/types.ts` |
| Modify | `src/storage/sqlite.ts` |
| Modify | `src/storage/json.ts` |
| Modify | `src/middleware/auth.ts` |
| Modify | `src/routes/admin.ts` |
| Modify | `src/index.ts` |
| Modify | `src/test/storage-sqlite.test.ts` |
| Modify | `src/test/storage-json.test.ts` |
| Modify | `src/test/middleware-auth.test.ts` |
| Modify | `src/test/routes-admin.test.ts` |
| Modify | `src/test/routes-projects.test.ts` |
| Modify | `ui/src/api/projects.ts` |
| Modify | `ui/src/pages/ProjectsPage.tsx` |
| Modify | `ui/src/App.tsx` |
| Delete | `ui/src/pages/ApiKeysPage.tsx` |
| Delete | `ui/src/api/apiKeys.ts` |

---

## Task 1: Update types — add `key` to `Environment`, remove `ApiKey`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Replace the contents of `src/types.ts`**

Replace with:

```typescript
export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  key: string;
  createdAt: string;
}

export interface Flag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  environment: string;
  targeting?: Targeting;
  rollout?: Rollout;
  createdAt: string;
  updatedAt: string;
}

export interface Targeting {
  userIds?: string[];
  attributes?: Record<string, string[]>;
}

export interface Rollout {
  percentage: number;
}

export interface FlagEvaluationContext {
  userId?: string;
  attributes?: Record<string, string>;
}

export interface Storage {
  initialize(): Promise<void>;

  // Projects
  createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  getAllProjects(): Promise<Project[]>;
  deleteProject(id: string): Promise<void>;

  // Environments
  createEnvironment(env: Omit<Environment, 'id' | 'createdAt' | 'key'>): Promise<Environment>;
  getEnvironmentsByProject(projectId: string): Promise<Environment[]>;
  deleteEnvironment(id: string): Promise<void>;
  renameEnvironment(id: string, name: string): Promise<Environment>;
  regenerateEnvironmentKey(envId: string): Promise<Environment>;
  getEnvironmentByKey(key: string): Promise<Environment | null>;

  // Flags
  createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]>;
  getFlag(projectId: string, key: string, environment: string): Promise<Flag | null>;
  getAllFlags(projectId: string, environment?: string): Promise<Flag[]>;
  updateFlag(id: string, updates: Partial<Flag>): Promise<Flag>;
  deleteFlag(projectId: string, key: string): Promise<void>;

  // Admin key (UI authentication)
  getAdminKey(): Promise<string | null>;
  bootstrapAdminKey(): Promise<void>;
}
```

- [ ] **Step 2: Verify TypeScript compilation (expect errors — implementations not updated yet)**

Run: `yarn build 2>&1 | head -40`
Expected: errors about missing methods. That is fine for now.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: update Storage interface — embed key in Environment, remove ApiKey"
```

---

## Task 2: Update SqliteStorage

**Files:**
- Modify: `src/storage/sqlite.ts`
- Modify: `src/test/storage-sqlite.test.ts`

- [ ] **Step 1: Write failing tests for the new storage shape**

Replace `src/test/storage-sqlite.test.ts` with tests that:
- Assert `createEnvironment` returns an `env.key` matching `/^ff_[a-zA-Z0-9_-]{32}$/`
- Assert `getEnvironmentByKey(key)` returns the matching environment, or null
- Assert `regenerateEnvironmentKey(envId)` returns a new key different from the old one
- Assert `regenerateEnvironmentKey('nope')` throws `'Environment not found'`
- Assert `bootstrapAdminKey()` creates a `ff_` key retrievable via `getAdminKey()`
- Assert `bootstrapAdminKey()` is idempotent
- Keep existing tests for projects, flags (adjusted for no api_keys)

- [ ] **Step 2: Run tests — expect failures**

Run: `yarn test src/test/storage-sqlite.test.ts 2>&1 | tail -20`
Expected: failures.

- [ ] **Step 3: Implement new `SqliteStorage`**

Key changes to `src/storage/sqlite.ts`:
1. `initialize()`: replace `api_keys` table with `admin_keys(id, key, name, created_at)`. Add `key TEXT UNIQUE NOT NULL DEFAULT ''` column to `environments`. Add index `idx_environments_key ON environments(key)`.
2. `createEnvironment(env)`: generate `key = \`ff_\${nanoid(32)}\``, insert it, return environment with `key` field.
3. `getEnvironmentsByProject(projectId)`: map `r.key` in the returned objects.
4. `getEnvironmentByKey(key)`: `SELECT * FROM environments WHERE key = ?`, return null if not found.
5. `regenerateEnvironmentKey(envId)`: fetch row, throw if not found, generate new key, `UPDATE environments SET key = ?`, return updated environment.
6. `deleteProject(id)`: remove `DELETE FROM api_keys` line.
7. `deleteEnvironment(id)`: remove `DELETE FROM api_keys` line.
8. `renameEnvironment(id, name)`: remove `UPDATE api_keys` line from the transaction.
9. Add `getAdminKey()`: `SELECT key FROM admin_keys LIMIT 1`, return key or null.
10. Add `bootstrapAdminKey()`: check if row exists; if not, insert `\`ff_\${nanoid(32)}\``.
11. Remove `createApiKey`, `getApiKey`, `getAllApiKeys`, `deleteApiKey` methods.
12. Remove `rowToApiKey` helper.
13. Add `rowToEnvironment(row)` helper returning `{ id, projectId: row.project_id, name, key, createdAt }`.

- [ ] **Step 4: Run SQLite storage tests**

Run: `yarn test src/test/storage-sqlite.test.ts 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/sqlite.ts src/test/storage-sqlite.test.ts
git commit -m "feat: SqliteStorage — environment key, admin_keys table, remove api_keys"
```

---

## Task 3: Update JsonStorage

**Files:**
- Modify: `src/storage/json.ts`
- Modify: `src/test/storage-json.test.ts`

- [ ] **Step 1: Write failing tests**

Replace `src/test/storage-json.test.ts` with tests that mirror the SQLite ones:
- `createEnvironment` returns `key` matching `/^ff_[a-zA-Z0-9_-]{32}$/`
- Key persists to disk (load a second `JsonStorage` from same file, check key)
- `getEnvironmentByKey` works
- `regenerateEnvironmentKey` works and throws for unknown id
- `bootstrapAdminKey` / `getAdminKey` work and are idempotent
- `deleteProject` cascades to environments and flags (no api_keys)

- [ ] **Step 2: Run — expect failures**

Run: `yarn test src/test/storage-json.test.ts 2>&1 | tail -20`

- [ ] **Step 3: Implement new `JsonStorage`**

Key changes to `src/storage/json.ts`:
1. Replace `apiKeys: ApiKey[]` in `JsonData` with `adminKey: AdminKey | null` where `AdminKey = { id, key, name, createdAt }`.
2. `initialize()`: if loading existing file that lacks `adminKey`, set it to `null`.
3. `createEnvironment(env)`: add `key: \`ff_\${nanoid(32)}\`` to `newEnv`.
4. `getEnvironmentByKey(key)`: find in `this.data.environments` by key.
5. `regenerateEnvironmentKey(envId)`: find env, throw if not found, set new key, save, return copy.
6. `deleteProject(id)`: remove `this.data.apiKeys` filter line.
7. `deleteEnvironment(id)`: remove `this.data.apiKeys` filter line.
8. `renameEnvironment(id, name)`: remove `for (const key of this.data.apiKeys)` loop.
9. Add `getAdminKey()` and `bootstrapAdminKey()`.
10. Remove `createApiKey`, `getApiKey`, `getAllApiKeys`, `deleteApiKey`.

- [ ] **Step 4: Run JSON storage tests**

Run: `yarn test src/test/storage-json.test.ts 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/json.ts src/test/storage-json.test.ts
git commit -m "feat: JsonStorage — environment key, adminKey field, remove apiKeys"
```

---

## Task 4: Update auth middleware

**Files:**
- Modify: `src/middleware/auth.ts`
- Modify: `src/test/middleware-auth.test.ts`

- [ ] **Step 1: Write failing tests**

Replace `src/test/middleware-auth.test.ts`:
- Test rejects missing `Authorization` header → 401
- Test rejects non-Bearer header → 401
- Test rejects unknown key → 401
- Test accepts a valid environment key: create project, create environment, use `env.key` as bearer → 200
- Test `req.apiKey` is set from environment: `{ id: env.id, name: env.name, projectId, environment: env.name }`

- [ ] **Step 2: Run — expect failures**

Run: `yarn test src/test/middleware-auth.test.ts 2>&1 | tail -20`

- [ ] **Step 3: Replace `src/middleware/auth.ts`**

Replace `storage.getApiKey(token)` with `storage.getEnvironmentByKey(token)`.
Set `req.apiKey` from the environment: `{ id: env.id, name: env.name, projectId: env.projectId, environment: env.name }`.

Full file:

```typescript
import { Request, Response, NextFunction } from 'express';
import { Storage } from '../types.js';

export interface AuthRequest extends Request {
  apiKey?: {
    id: string;
    name: string;
    projectId: string;
    environment: string;
  };
}

export function createAuthMiddleware(storage: Storage) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }
    const token = authHeader.substring(7);
    try {
      const env = await storage.getEnvironmentByKey(token);
      if (!env) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }
      req.apiKey = { id: env.id, name: env.name, projectId: env.projectId, environment: env.name };
      next();
    } catch (_error) {
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}
```

- [ ] **Step 4: Run auth middleware tests**

Run: `yarn test src/test/middleware-auth.test.ts 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.ts src/test/middleware-auth.test.ts
git commit -m "feat: auth middleware — look up bearer token in environments table"
```

---

## Task 5: Update admin routes and bootstrap

**Files:**
- Modify: `src/routes/admin.ts`
- Modify: `src/index.ts`
- Modify: `src/test/routes-admin.test.ts`

- [ ] **Step 1: Replace `src/routes/admin.ts`**

Remove all api-keys routes. Keep only `GET /ui-token` (reads from `storage.getAdminKey()`) and add `POST /environments/:envId/regenerate-key`.

Full file:

```typescript
import { Router } from 'express';
import { Storage } from '../types.js';

export function createAdminRouter(storage: Storage) {
  const router = Router();

  router.get('/ui-token', async (_req, res) => {
    try {
      const key = await storage.getAdminKey();
      if (!key) { res.status(404).json({ error: 'UI token not found' }); return; }
      res.json({ key });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch UI token' });
    }
  });

  router.post('/environments/:envId/regenerate-key', async (req, res) => {
    try {
      const env = await storage.regenerateEnvironmentKey(req.params.envId);
      res.json(env);
    } catch (_error: any) {
      if (_error.message === 'Environment not found') {
        res.status(404).json({ error: 'Environment not found' });
      } else {
        res.status(500).json({ error: 'Failed to regenerate key' });
      }
    }
  });

  return router;
}
```

- [ ] **Step 2: Replace `src/test/routes-admin.test.ts`**

Tests to include:
- `GET /admin/ui-token` returns 404 when no admin key exists
- `GET /admin/ui-token` returns the ff_ key after `storage.bootstrapAdminKey()`
- `POST /admin/environments/:envId/regenerate-key` returns 404 for unknown envId
- `POST /admin/environments/:envId/regenerate-key` returns updated environment with new `ff_` key, different from old
- After regeneration, `storage.getEnvironmentByKey(newKey)` finds the env
- After regeneration, `storage.getEnvironmentByKey(oldKey)` returns null

- [ ] **Step 3: Run admin route tests**

Run: `yarn test src/test/routes-admin.test.ts 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 4: Update `src/index.ts`**

Replace the `bootstrapUiAdminKey` function body with `await storage.bootstrapAdminKey()`. Update the log message. The `nanoid` import can stay (still used in `bootstrapAdminPassword`). Also update the admin password prefix from `rf_admin_` to `ff_admin_`.

The bootstrap call changes from:
```typescript
await bootstrapUiAdminKey(storage);
```
to:
```typescript
await storage.bootstrapAdminKey();
console.log('✓ UI admin key ready');
```

And `bootstrapUiAdminKey` function is deleted.

- [ ] **Step 5: Run full test suite**

Run: `yarn test 2>&1 | tail -30`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.ts src/index.ts src/test/routes-admin.test.ts
git commit -m "feat: admin routes — ui-token from admin_keys, regenerate-key endpoint"
```

---

## Task 6: Update projects routes tests

**Files:**
- Modify: `src/test/routes-projects.test.ts`

- [ ] **Step 1: Update `src/test/routes-projects.test.ts`**

Remove all `createApiKey`, `getAllApiKeys`, and api_keys cascade assertions. Replace with:
- `GET /admin/projects/:id/environments` asserts each environment has `key` starting with `ff_`
- `POST /admin/projects/:id/environments` asserts response body has `key` matching `/^ff_[a-zA-Z0-9_-]{32}$/`
- Cascade tests for `DELETE project` and `DELETE environment` no longer assert on api_keys

- [ ] **Step 2: Run projects route tests**

Run: `yarn test src/test/routes-projects.test.ts 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 3: Run full backend test suite**

Run: `yarn test 2>&1 | tail -30`
Expected: all 9 test files pass.

- [ ] **Step 4: Commit**

```bash
git add src/test/routes-projects.test.ts
git commit -m "test: update routes-projects tests — remove api_keys refs, add key assertions"
```

---

## Task 7: Update frontend API layer

**Files:**
- Modify: `ui/src/api/projects.ts`
- Delete: `ui/src/api/apiKeys.ts`

- [ ] **Step 1: Add `key: string` to the `Environment` interface in `ui/src/api/projects.ts`**

In the existing file, change:
```typescript
export interface Environment {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}
```
to:
```typescript
export interface Environment {
  id: string;
  projectId: string;
  name: string;
  key: string;
  createdAt: string;
}
```

- [ ] **Step 2: Add `regenerateEnvironmentKey` function at the end of `ui/src/api/projects.ts`**

```typescript
export async function regenerateEnvironmentKey(envId: string): Promise<Environment> {
  const res = await adminFetch(`/admin/environments/${envId}/regenerate-key`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to regenerate key');
  return res.json() as Promise<Environment>;
}
```

- [ ] **Step 3: Delete `ui/src/api/apiKeys.ts`**

Run: `rm ui/src/api/apiKeys.ts`

- [ ] **Step 4: Verify TypeScript in UI (errors expected only about ApiKeysPage — fixed next task)**

Run: `cd ui && yarn tsc --noEmit 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/projects.ts
git rm ui/src/api/apiKeys.ts
git commit -m "feat: frontend api — add key to Environment, regenerateEnvironmentKey, remove apiKeys module"
```

---

## Task 8: Update ProjectsPage (key display and regenerate)

**Files:**
- Modify: `ui/src/pages/ProjectsPage.tsx`

- [ ] **Step 1: Add `regenerateEnvironmentKey` to the import from `../api/projects` at the top of `ProjectsPage.tsx`**

Change:
```typescript
import {
  getProjects, createProject, deleteProject,
  getEnvironments, createEnvironment, deleteEnvironment, renameEnvironment,
  Project, Environment,
} from '../api/projects';
```
To:
```typescript
import {
  getProjects, createProject, deleteProject,
  getEnvironments, createEnvironment, deleteEnvironment, renameEnvironment, regenerateEnvironmentKey,
  Project, Environment,
} from '../api/projects';
```

- [ ] **Step 2: Add `confirmRegenerateId` state to `ProjectRow`**

Inside `ProjectRow`, after the existing `useState` declarations, add:
```typescript
const [confirmRegenerateId, setConfirmRegenerateId] = useState<string | null>(null);
```

- [ ] **Step 3: Add `handleRegenerateKey` function to `ProjectRow`**

After `handleDeleteProject`, add:
```typescript
async function handleRegenerateKey(envId: string) {
  try {
    const updated = await regenerateEnvironmentKey(envId);
    setEnvironments(prev => prev.map(e => e.id === envId ? updated : e));
    setConfirmRegenerateId(null);
    showToast('API key regenerated');
  } catch {
    showToast('Failed to regenerate key', 'error');
  }
}
```

- [ ] **Step 4: Add `copyKey` helper to `ProjectRow`**

After `handleRegenerateKey`, add:
```typescript
function copyKey(key: string) {
  void navigator.clipboard.writeText(key).then(() => showToast('Key copied to clipboard'));
}
```

- [ ] **Step 5: Update the environment row JSX to show key, Copy, and Regenerate**

In the environment row (inside the `environments.map` block), after the environment name `<span>`, add:

```tsx
{/* Key display */}
<code style={{ fontSize: 11, color: '#6b7280', background: '#f9fafb', padding: '2px 6px', borderRadius: 4, border: '1px solid #e5e7eb' }}>
  ff_••••••••••••••••
</code>
<button
  onClick={() => copyKey(env.key)}
  title="Copy API key"
  style={{ ...btnStyle('ghost'), padding: '2px 8px', fontSize: 11 }}
>
  Copy
</button>

{/* Regenerate */}
{confirmRegenerateId === env.id ? (
  <div style={{ display: 'flex', gap: 4 }}>
    <button style={{ ...btnStyle('danger'), padding: '2px 8px', fontSize: 11 }} onClick={() => void handleRegenerateKey(env.id)}>Confirm</button>
    <button style={{ ...btnStyle('ghost'), padding: '2px 8px', fontSize: 11 }} onClick={() => setConfirmRegenerateId(null)}>Cancel</button>
  </div>
) : (
  <button
    style={{ ...btnStyle('ghost'), padding: '2px 8px', fontSize: 11 }}
    title="Regenerate API key"
    onClick={() => { setConfirmRegenerateId(env.id); setConfirmDeleteEnvId(null); }}
  >
    Regenerate
  </button>
)}
```

Also wrap the rename/delete buttons in a `<div style={{ marginLeft: 'auto' }}>` to push them to the right, and add `gap: 8, flexWrap: 'wrap'` to the row's outer container.

Also clear `confirmRegenerateId` when clicking rename or delete (add `setConfirmRegenerateId(null)` to the rename/delete click handlers).

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd ui && yarn tsc --noEmit 2>&1 | head -20`
Expected: only errors about `ApiKeysPage` still imported in `App.tsx` (fixed next task).

- [ ] **Step 7: Commit**

```bash
git add ui/src/pages/ProjectsPage.tsx
git commit -m "feat: ProjectsPage — show env key, copy and regenerate UI"
```

---

## Task 9: Remove ApiKeysPage from App.tsx and delete the file

**Files:**
- Modify: `ui/src/App.tsx`
- Delete: `ui/src/pages/ApiKeysPage.tsx`

- [ ] **Step 1: Remove `ApiKeysPage` import from `ui/src/App.tsx`**

Delete the line:
```typescript
import { ApiKeysPage } from './pages/ApiKeysPage';
```

- [ ] **Step 2: Remove the "API Keys" nav link from the `nav` array in `App.tsx`**

Change:
```typescript
{ to: '/projects', label: 'Projects' },
{ to: '/flags', label: 'Feature Flags' },
{ to: '/api-keys', label: 'API Keys' },
```
To:
```typescript
{ to: '/projects', label: 'Projects' },
{ to: '/flags', label: 'Feature Flags' },
```

- [ ] **Step 3: Remove the `/api-keys` route from the `<Routes>` block**

Remove:
```tsx
<Route path="/api-keys" element={<ApiKeysPage projectId={project?.id ?? ''} environments={environments.map(e => e.name)} />} />
```

- [ ] **Step 4: Delete `ui/src/pages/ApiKeysPage.tsx`**

Run: `rm ui/src/pages/ApiKeysPage.tsx`

- [ ] **Step 5: Verify UI TypeScript compiles clean**

Run: `cd ui && yarn tsc --noEmit 2>&1`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/App.tsx
git rm ui/src/pages/ApiKeysPage.tsx
git commit -m "feat: remove API Keys page and nav link from frontend"
```

---

## Task 10: Final verification and build

- [ ] **Step 1: Run full backend test suite**

Run: `yarn test 2>&1 | tail -30`
Expected: all tests pass.

- [ ] **Step 2: Build TypeScript backend**

Run: `yarn build 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 3: Build frontend**

Run: `cd ui && yarn build 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 4: Commit any remaining changes**

```bash
git status
```

If clean, done. Otherwise:

```bash
git add -A
git commit -m "chore: final cleanup after api-key simplification"
```
