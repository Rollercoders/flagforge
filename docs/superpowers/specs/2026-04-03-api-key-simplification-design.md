# Design: API Key Simplification

**Date:** 2026-04-03  
**Status:** Approved

## Summary

Remove the standalone API Keys screen and model. Each environment owns exactly one API key, generated automatically at environment creation. Keys use the `ff_` prefix (FlagForge). The `api_keys` table is eliminated; admin UI authentication moves to a dedicated `admin_keys` table.

---

## Data Model

### `Environment` (updated)
```typescript
interface Environment {
  id: string;
  projectId: string;
  name: string;
  key: string;       // NEW — ff_<nanoid(32)>
  createdAt: string;
}
```

### New table: `admin_keys`
Single-row table holding the web UI admin key (previously `__ui_admin__` in `api_keys`).

```sql
CREATE TABLE admin_keys (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### Removed table: `api_keys`
Dropped entirely. The `__ui_admin__` row is migrated to `admin_keys`.

---

## Storage Interface Changes

**Removed methods:**
- `createApiKey`
- `getApiKey`
- `getAllApiKeys`
- `deleteApiKey`

**Updated methods:**
- `createEnvironment` — generates `ff_<nanoid(32)>` key automatically
- `getEnvironmentsByProject` — returns `key` field in each `Environment`

**New method:**
- `regenerateEnvironmentKey(envId: string): Promise<Environment>` — generates a new `ff_` key for the environment

**Auth lookup change:**
- `getApiKey(key)` is replaced by a direct lookup against the `environments` table by key value. The middleware receives the matched environment's `{ id, projectId, name }` as the scoping context.

---

## Backend Changes

### DB Migration (SQLite)
1. Add column `key TEXT NOT NULL DEFAULT ''` to `environments`
2. Backfill: generate `ff_<nanoid(32)>` for each existing environment
3. Add UNIQUE index on `environments.key`
4. Create `admin_keys` table
5. Migrate `__ui_admin__` row from `api_keys` to `admin_keys`
6. Drop `api_keys` table

### JSON storage
Same logical changes applied to the JSON schema.

### Routes removed
- `POST /admin/api-keys`
- `GET /admin/api-keys`
- `DELETE /admin/api-keys/:id`

### Routes added
- `POST /admin/environments/:envId/regenerate-key` — calls `regenerateEnvironmentKey`, returns updated `Environment`

### Routes unchanged
- `GET /admin/ui-token` — now reads from `admin_keys` instead of `api_keys`

### Auth middleware (`src/middleware/auth.ts`)
- Looks up bearer token in `environments.key` instead of `api_keys.key`
- `req.apiKey` continues to expose `{ id, name, environment, projectId }` (same shape, sourced differently)

---

## Frontend Changes

### Removed
- `ui/src/pages/ApiKeysPage.tsx`
- `ui/src/api/apiKeys.ts`
- Route `/api-keys` in `App.tsx`
- "API Keys" nav link in `App.tsx`

### Updated: `ProjectsPage`
Each environment row gains:
- Masked key display: `ff_••••••••••••••••`
- **Copy** button — copies full key to clipboard
- **Regenerate** button — shows inline confirmation, calls `POST /admin/environments/:envId/regenerate-key`, updates local state

### Updated: `ui/src/api/projects.ts`
- `getEnvironments` / `createEnvironment` return `key` field
- New function: `regenerateEnvironmentKey(projectId: string, envId: string): Promise<Environment>`

---

## Key Format

All generated keys use prefix `ff_` followed by 32 random characters (nanoid):
```
ff_<nanoid(32)>
```

This applies to both environment keys and the admin UI key.

---

## Out of Scope

- Role-based permissions on keys (not planned)
- Multiple keys per environment (explicitly removed by this design)
- Key expiry or rotation policies
