# Client/Secret API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each environment two API keys — a `client` key (`ff_`, read/evaluate only) and a `secret` key (`ffs_`, superset that can also write) — re-enabling API writes safely after the read-only security fix.

**Architecture:** The existing `key` field stays as the client key (zero-migration for existing consumers). A new `secretKey` field is added, generated for every environment (new via `createEnvironment`, old via an idempotent backfill at `initialize()`). Auth resolves a token to `{ environment, role }`; the write-guard on `/api/flags` becomes `requireSecret` (writes need `role === 'secret'`).

**Tech Stack:** TypeScript, Node ESM, Express, better-sqlite3, React (UI), Vitest. Package manager: **yarn 4**.

## Global Constraints

- **All repo text in English** (this is a public repo): commit messages, PR title/body, code, comments. (Chat with the user stays Italian, but nothing in the repo.)
- **ESM**: relative runtime imports MUST carry the `.js` extension. Verify with `yarn build && yarn smoke`.
- Client key format `ff_` (unchanged); secret key format `ffs_`.
- Both keys generated at environment creation; existing environments get a secret key via idempotent backfill at `initialize()`.
- Client key = read/evaluate only. Secret key = superset (read/evaluate + write). Writes on `/api/flags` require `role === 'secret'` → otherwise 403.
- Zero breaking change for existing client keys (same value, same `key` field/column).
- `regenerateEnvironmentKey` becomes role-parametric; it is part of the `Storage` interface → update the interface and BOTH implementations (sqlite + json).
- Conventional commits, no scope.

## File Structure

- `src/types.ts` — add `secretKey` to `Environment`; update `Storage.regenerateEnvironmentKey` signature; add a `role` type. **Modify.**
- `src/storage/sqlite.ts` — `secret_key` column + migration + backfill; generate on create; `rowToEnvironment`; role-parametric regenerate; new `getEnvironmentByAnyKey`. **Modify.**
- `src/storage/json.ts` — same behavior for JSON store. **Modify.**
- `src/middleware/auth.ts` — resolve token to `{ environment, role }`; add `role` to `req.apiKey`. **Modify.**
- `src/routes/flags.ts` — `denyWrites` → `requireSecret` (writes need secret role). **Modify.**
- `src/routes/admin.ts` (+ any env-exposing route) — role param for regenerate; expose `secretKey`. **Modify.**
- `ui/src/api/projects.ts` — `secretKey` on the Environment type; regenerate accepts role. **Modify.**
- `ui/src/pages/ProjectsPage.tsx` — masked secret key with reveal/copy/regenerate. **Modify.**
- `README.md` — document the two keys. **Modify.**
- Tests: `src/test/storage-sqlite.test.ts`, `storage-json.test.ts`, `middleware-auth.test.ts`, `routes-flags.test.ts`, `routes-admin.test.ts`. **Modify.**

---

### Task 1: Data model + storage (sqlite) — secret key, migration, resolution by role

**Files:**
- Modify: `src/types.ts`, `src/storage/sqlite.ts`
- Test: `src/test/storage-sqlite.test.ts`

**Interfaces:**
- Produces:
  - `type ApiKeyRole = 'client' | 'secret'`
  - `Environment.secretKey: string`
  - `Storage.getEnvironmentByAnyKey(token: string): Promise<{ environment: Environment; role: ApiKeyRole } | null>`
  - `Storage.regenerateEnvironmentKey(envId: string, role: ApiKeyRole): Promise<Environment>`

- [ ] **Step 1: Update `src/types.ts`**

Add near the top:
```ts
export type ApiKeyRole = 'client' | 'secret';
```
In `Environment` add `secretKey: string;` after `key`.
In the `Storage` interface:
```ts
  regenerateEnvironmentKey(envId: string, role: ApiKeyRole): Promise<Environment>;
  getEnvironmentByKey(key: string): Promise<Environment | null>;
  getEnvironmentByAnyKey(token: string): Promise<{ environment: Environment; role: ApiKeyRole } | null>;
```

- [ ] **Step 2: Write failing tests** in `src/test/storage-sqlite.test.ts` (new `describe('API key roles', ...)`, reuse existing setup helpers)

```ts
  describe('API key roles', () => {
    it('creates an environment with both a client and a secret key', async () => {
      const project = await storage.createProject({ name: 'keys-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      expect(env.key).toMatch(/^ff_/);
      expect(env.secretKey).toMatch(/^ffs_/);
      expect(env.secretKey).not.toBe(env.key);
    });

    it('resolves a client token to role client and a secret token to role secret', async () => {
      const project = await storage.createProject({ name: 'resolve-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      const asClient = await storage.getEnvironmentByAnyKey(env.key);
      const asSecret = await storage.getEnvironmentByAnyKey(env.secretKey);
      expect(asClient?.role).toBe('client');
      expect(asSecret?.role).toBe('secret');
      expect(await storage.getEnvironmentByAnyKey('ff_unknown')).toBeNull();
    });

    it('regenerates client and secret keys independently', async () => {
      const project = await storage.createProject({ name: 'regen-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      const afterClient = await storage.regenerateEnvironmentKey(env.id, 'client');
      expect(afterClient.key).not.toBe(env.key);
      expect(afterClient.secretKey).toBe(env.secretKey); // untouched
      const afterSecret = await storage.regenerateEnvironmentKey(env.id, 'secret');
      expect(afterSecret.secretKey).not.toBe(env.secretKey);
      expect(afterSecret.key).toBe(afterClient.key); // untouched
    });

    it('backfills a secret key for an environment created with the old schema', async () => {
      // create env, then null out its secret_key to simulate a pre-migration row
      const project = await storage.createProject({ name: 'legacy-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      (storage as any).db.prepare('UPDATE environments SET secret_key = NULL WHERE id = ?').run(env.id);
      await storage.backfillSecretKeys(); // idempotent backfill, also called in initialize()
      const reloaded = (await storage.getEnvironmentsByProject(project.id))[0];
      expect(reloaded.secretKey).toMatch(/^ffs_/);
    });
  });
```

- [ ] **Step 3: Run and confirm failure**

Run: `yarn test src/test/storage-sqlite.test.ts`
Expected: FAIL.

- [ ] **Step 4: Schema + migration + backfill** in `src/storage/sqlite.ts`

In `CREATE TABLE environments`, add after `key TEXT UNIQUE NOT NULL DEFAULT '',`:
```sql
        secret_key TEXT NOT NULL DEFAULT '',
```
After `this.db.exec(\`...\`)` in `initialize()`, add the idempotent column migration and call the backfill:
```ts
    try { this.db.exec("ALTER TABLE environments ADD COLUMN secret_key TEXT NOT NULL DEFAULT ''"); } catch { /* already present */ }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_environments_secret_key ON environments(secret_key)');
    await this.backfillSecretKeys();
```
Add the backfill method:
```ts
  async backfillSecretKeys(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const rows = this.db.prepare("SELECT id FROM environments WHERE secret_key IS NULL OR secret_key = ''").all() as any[];
    for (const r of rows) {
      this.db.prepare('UPDATE environments SET secret_key = ? WHERE id = ?').run(`ffs_${nanoid(32)}`, r.id);
    }
  }
```

- [ ] **Step 5: Generate on create + map the row**

In `createEnvironment`, after `const key = ...`:
```ts
    const secretKey = `ffs_${nanoid(32)}`;
```
Update the INSERT to include `secret_key`:
```ts
    this.db.prepare('INSERT INTO environments (id, project_id, name, key, secret_key, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, env.projectId, env.name, key, secretKey, now);
```
Return `{ id, projectId: env.projectId, name: env.name, key, secretKey, createdAt: now }`.
Update `rowToEnvironment`:
```ts
  private rowToEnvironment(row: any): Environment {
    return { id: row.id, projectId: row.project_id, name: row.name, key: row.key, secretKey: row.secret_key ?? '', createdAt: row.created_at };
  }
```

- [ ] **Step 6: Role-parametric regenerate + resolve-by-any-key**

Replace `regenerateEnvironmentKey`:
```ts
  async regenerateEnvironmentKey(envId: string, role: ApiKeyRole): Promise<Environment> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(envId) as any;
    if (!row) throw new Error('Environment not found');
    if (role === 'client') {
      const newKey = `ff_${nanoid(32)}`;
      this.db.prepare('UPDATE environments SET key = ? WHERE id = ?').run(newKey, envId);
      return this.rowToEnvironment({ ...row, key: newKey });
    }
    const newSecret = `ffs_${nanoid(32)}`;
    this.db.prepare('UPDATE environments SET secret_key = ? WHERE id = ?').run(newSecret, envId);
    return this.rowToEnvironment({ ...row, secret_key: newSecret });
  }

  async getEnvironmentByAnyKey(token: string): Promise<{ environment: Environment; role: ApiKeyRole } | null> {
    if (!this.db) throw new Error('Database not initialized');
    const byClient = this.db.prepare('SELECT * FROM environments WHERE key = ?').get(token) as any;
    if (byClient) return { environment: this.rowToEnvironment(byClient), role: 'client' };
    const bySecret = this.db.prepare('SELECT * FROM environments WHERE secret_key = ?').get(token) as any;
    if (bySecret) return { environment: this.rowToEnvironment(bySecret), role: 'secret' };
    return null;
  }
```
Import `ApiKeyRole` in the file's type import from `../types.js`.

- [ ] **Step 7: Run tests**

Run: `yarn test src/test/storage-sqlite.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/storage/sqlite.ts src/test/storage-sqlite.test.ts
git commit -m "feat: add secret API key to environments (sqlite)"
```

---

### Task 2: Storage (json) — same behavior

**Files:**
- Modify: `src/storage/json.ts`
- Test: `src/test/storage-json.test.ts`

**Interfaces:**
- Consumes: `ApiKeyRole` from `../types.js`.
- Produces: JSON store honoring `secretKey`, `getEnvironmentByAnyKey`, role-parametric `regenerateEnvironmentKey`, `backfillSecretKeys`.

- [ ] **Step 1: Write failing tests** in `src/test/storage-json.test.ts`

Mirror the four tests from Task 1 (create has both keys; resolve client/secret; independent regenerate; backfill when `secretKey` missing). Reuse the file's JSON-store setup. For the backfill test, delete the field: `delete (env as any).secretKey` is not enough (it's a copy) — instead set the stored env's secretKey to '' via a fresh store read, or call `regenerate`-free path: simplest is to create the env, then manually clear it through the store's internal data if the test already accesses it; otherwise assert that `backfillSecretKeys()` leaves an already-populated key unchanged AND that reading an env whose stored secretKey is '' produces one. Keep the test aligned to how the JSON store exposes data in existing tests.

- [ ] **Step 2: Run and confirm failure**

Run: `yarn test src/test/storage-json.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/storage/json.ts`**

- `createEnvironment`: set `secretKey: \`ffs_${nanoid(32)}\`` on the new env object.
- On read (`getEnvironmentsByProject`, `getEnvironmentByKey`, any env return), normalize: if `secretKey` missing/empty, generate one and persist (or run through `backfillSecretKeys`).
- Add `backfillSecretKeys()`: iterate `data.environments`, fill missing `secretKey`, `save()`.
- Add `getEnvironmentByAnyKey(token)`: match `key` → client, else `secretKey` → secret, else null.
- Replace `regenerateEnvironmentKey(envId, role)`: regenerate `key` or `secretKey` based on role, leave the other untouched, `save()`.
- Call `backfillSecretKeys()` inside `initialize()` after loading data.

- [ ] **Step 4: Run tests**

Run: `yarn test src/test/storage-json.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/json.ts src/test/storage-json.test.ts
git commit -m "feat: add secret API key to environments (json)"
```

---

### Task 3: Auth middleware — resolve role

**Files:**
- Modify: `src/middleware/auth.ts`
- Test: `src/test/middleware-auth.test.ts`

**Interfaces:**
- Consumes: `Storage.getEnvironmentByAnyKey`, `ApiKeyRole`.
- Produces: `req.apiKey` now includes `role: ApiKeyRole`.

- [ ] **Step 1: Write failing tests** in `src/test/middleware-auth.test.ts`

Following the file's existing pattern (build a request with a Bearer token, run the middleware, assert `req.apiKey`):
- valid client token → `req.apiKey.role === 'client'`, correct projectId/environment.
- valid secret token → `req.apiKey.role === 'secret'`.
- unknown token → 401.

- [ ] **Step 2: Run and confirm failure**

Run: `yarn test src/test/middleware-auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `src/middleware/auth.ts`**

Add `role` to the `AuthRequest.apiKey` type:
```ts
  apiKey?: { id: string; name: string; projectId: string; environment: string; role: ApiKeyRole; };
```
(import `ApiKeyRole` from `../types.js`). In the middleware, replace `getEnvironmentByKey` with:
```ts
    const resolved = await storage.getEnvironmentByAnyKey(token);
    if (!resolved) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
    const { environment: env, role } = resolved;
    req.apiKey = { id: env.id, name: env.name, projectId: env.projectId, environment: env.name, role };
    next();
```

- [ ] **Step 4: Run tests**

Run: `yarn test src/test/middleware-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.ts src/test/middleware-auth.test.ts
git commit -m "feat: resolve API key role in auth middleware"
```

---

### Task 4: Write guard on /api/flags requires secret role

**Files:**
- Modify: `src/routes/flags.ts`
- Test: `src/test/routes-flags.test.ts`

**Interfaces:**
- Consumes: `req.apiKey.role`.
- Produces: writes (`POST`/`PATCH`/`DELETE`) return 403 for client role, proceed for secret role; reads work for both.

- [ ] **Step 1: Update failing tests** in `src/test/routes-flags.test.ts`

The current tests expect 403 on every write (from the hotfix) using the environment key. Now:
- the setup creates an env; use `env.key` (client) and `env.secretKey` (secret).
- write with **client** key → still 403 (assert storage unchanged, as today).
- write with **secret** key → success (POST 201, PATCH 200, DELETE 204) and storage actually changes.
- read (GET) with **either** key → 200.

Update the existing write-guard tests to use the client key for the 403 cases and add secret-key success cases. Adjust the test app setup to mount `createAuthMiddleware` (already present) so `req.apiKey.role` is populated — the file already builds the app with the auth middleware.

- [ ] **Step 2: Run and confirm failure**

Run: `yarn test src/test/routes-flags.test.ts`
Expected: FAIL (secret writes currently 403 too).

- [ ] **Step 3: Update `src/routes/flags.ts`**

Replace the `denyWrites` guard with a role check:
```ts
  const requireSecret = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.apiKey?.role !== 'secret') {
      res.status(403).json({ error: 'This API key is read-only; use the secret key to modify flags' });
      return;
    }
    next();
  };
  router.post('/', requireSecret);
  router.patch('/:key', requireSecret);
  router.delete('/:key', requireSecret);
```
(import `Response, NextFunction` from express if not already; `AuthRequest` already imported.) The real write handlers below stay unchanged and now run when the guard calls `next()`.

- [ ] **Step 4: Run tests**

Run: `yarn test src/test/routes-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/flags.ts src/test/routes-flags.test.ts
git commit -m "feat: allow flag writes with the secret API key"
```

---

### Task 5: Admin route — role-aware regenerate + expose secretKey

**Files:**
- Modify: `src/routes/admin.ts` (and any other env-exposing route if needed)
- Test: `src/test/routes-admin.test.ts`

**Interfaces:**
- Consumes: `Storage.regenerateEnvironmentKey(envId, role)`.
- Produces: regenerate endpoint accepts a `role` (default `client` for backward compat); env responses include `secretKey`.

- [ ] **Step 1: Write failing tests** in `src/test/routes-admin.test.ts`

Following the file's pattern (admin session):
- regenerate with `role: 'secret'` → response env has a new `secretKey`, same `key`.
- regenerate with `role: 'client'` (or omitted → default client) → new `key`, same `secretKey`.
- an environment listing/response includes `secretKey`.

- [ ] **Step 2: Run and confirm failure**

Run: `yarn test src/test/routes-admin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `src/routes/admin.ts`**

The regenerate handler currently calls `storage.regenerateEnvironmentKey(req.params.envId)`. Read the role from the body (default `'client'`), validate it's `'client'|'secret'`, and pass it:
```ts
      const role = (req.body?.role === 'secret' ? 'secret' : 'client');
      const env = await storage.regenerateEnvironmentKey(req.params.envId, role);
```
Ensure the JSON response serializes the full environment (it already returns the env object, which now carries `secretKey` via `rowToEnvironment`). If any route strips fields explicitly, add `secretKey`.

- [ ] **Step 4: Run tests**

Run: `yarn test src/test/routes-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts src/test/routes-admin.test.ts
git commit -m "feat: role-aware key regeneration in admin route"
```

---

### Task 6: Backend verification

- [ ] **Step 1: Full suite + build + smoke**

Run: `yarn test && yarn build && yarn smoke`
Expected: all PASS. Fix any caller that broke due to the `regenerateEnvironmentKey(envId, role)` signature change (e.g. an internal call passing no role) or the `Environment` type gaining `secretKey` (object literals missing the field).

- [ ] **Step 2: Commit (only if fixes were needed)**

```bash
git add -A src/
git commit -m "test: align suite with client/secret keys"
```

---

### Task 7: UI — secret key (masked, reveal, copy, regenerate)

**Files:**
- Modify: `ui/src/api/projects.ts`, `ui/src/pages/ProjectsPage.tsx`

**Interfaces:**
- Consumes: env responses now include `secretKey`; regenerate accepts a role.

- [ ] **Step 1: Update `ui/src/api/projects.ts`**

Add `secretKey: string` to the `Environment` type. Update `regenerateEnvironmentKey` to accept a role and send it in the body:
```ts
export async function regenerateEnvironmentKey(envId: string, role: 'client' | 'secret' = 'client'): Promise<Environment> {
  // ...existing fetch, add body: JSON.stringify({ role })
}
```

- [ ] **Step 2: Update `ui/src/pages/ProjectsPage.tsx`**

Next to the existing client-key row (copy + regenerate, ~lines 168-183), add a secret-key row:
- label "Secret key" with note "for writing flags from trusted backends"; the existing key gets label "Client key" / "for evaluating flags in your apps".
- secret value masked by default (show `ffs_••••••••` or the first chars + dots); a **Reveal** toggle shows the full value; a **Copy** button; a **Regenerate** button (with confirm) calling `regenerateEnvironmentKey(env.id, 'secret')`.
- the existing regenerate button calls `regenerateEnvironmentKey(env.id, 'client')` (pass the role explicitly now).
- add a short warning near the secret key: "Keep this secret — never expose it in client-side code."
- follow the file's inline-style pattern; reuse the existing copy handler (`copyKey`).

- [ ] **Step 3: Build UI**

Run: `yarn --cwd ui build`
Expected: PASS (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add ui/src/api/projects.ts ui/src/pages/ProjectsPage.tsx
git commit -m "feat: show and manage the secret API key in the UI"
```

---

### Task 8: Docs + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

- In "Flag Management" (the table + note added by the read-only hotfix): writes are now possible with the **secret key** (`ffs_`); the client key (`ff_`) remains read/evaluate only.
- Add a short "API keys" explanation: each environment has a client key (distribute to apps, read/evaluate) and a secret key (keep in trusted backends, can write).
- Add a `curl` example writing a flag with the secret key.

- [ ] **Step 2: Final verification**

Run: `yarn test && yarn build && yarn smoke && yarn --cwd ui build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document client and secret API keys"
```

---

## Final notes

- Do not push or open the PR without explicit user confirmation.
- PR to `develop`, English title `feat: ...` → minor bump in CI.
- The CI smoke test guards against broken ESM imports.
- This unblocks the user's tool that used to write flags via API (it will use the secret key).
