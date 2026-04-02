# Projects Feature Design

## Goal

Introduce a **Project** as a top-level organizational unit above environments. Each project has its own environments, feature flags, and API keys. App clients authenticate with an API key scoped to `project + environment` and see only the flags for that project/environment combination.

## Context

RollerFlags is self-hosted and not yet in production — no migration from existing data is needed. The current model is flat: flags and API keys have an `environment` string with no project concept. This feature adds a proper project hierarchy.

---

## Data Model

### New entities

**Project**
```
id        TEXT PRIMARY KEY
name      TEXT UNIQUE NOT NULL
createdAt TEXT NOT NULL
```

**Environment** (per-project)
```
id        TEXT PRIMARY KEY
projectId TEXT NOT NULL → projects.id
name      TEXT NOT NULL
createdAt TEXT NOT NULL
UNIQUE(projectId, name)
```

### Modified entities

**Flag** — add `projectId`:
```
id          TEXT PRIMARY KEY
projectId   TEXT NOT NULL → projects.id
key         TEXT NOT NULL
name        TEXT NOT NULL
description TEXT
enabled     INTEGER NOT NULL DEFAULT 0
environment TEXT NOT NULL          ← still a plain string (environment name)
targeting   TEXT
rollout     TEXT
createdAt   TEXT NOT NULL
updatedAt   TEXT NOT NULL
UNIQUE(projectId, key, environment) ← replaces old UNIQUE(key, environment)
```

**ApiKey** — add `projectId`:
```
id          TEXT PRIMARY KEY
projectId   TEXT NOT NULL → projects.id
key         TEXT UNIQUE NOT NULL
name        TEXT NOT NULL
environment TEXT NOT NULL
createdAt   TEXT NOT NULL
```

### Flag creation behavior

When a flag is created in a project, the server reads all environments of that project and inserts one flag row per environment, all with `enabled: false`. The flag `name`, `description`, `key` are identical across all rows; only `environment` differs.

### TypeScript interfaces (src/types.ts)

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
  createdAt: string;
}

export interface Flag {
  id: string;
  projectId: string;   // NEW
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

export interface ApiKey {
  id: string;
  projectId: string;   // NEW
  key: string;
  name: string;
  environment: string;
  createdAt: string;
}
```

### Storage interface additions (src/types.ts)

```typescript
// Projects
createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project>;
getProject(id: string): Promise<Project | null>;
getAllProjects(): Promise<Project[]>;
deleteProject(id: string): Promise<void>;

// Environments
createEnvironment(env: Omit<Environment, 'id' | 'createdAt'>): Promise<Environment>;
getEnvironmentsByProject(projectId: string): Promise<Environment[]>;
deleteEnvironment(id: string): Promise<void>;
```

Existing flag and API key methods gain a `projectId` parameter where needed:
```typescript
createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]>;
// Returns array (one per environment) instead of single Flag

getAllFlags(projectId: string, environment?: string): Promise<Flag[]>;
getFlag(projectId: string, key: string, environment: string): Promise<Flag | null>;
// updateFlag and deleteFlag use id — unchanged in signature
// deleteFlag deletes ALL rows for that flag key in the project
deleteFlag(projectId: string, key: string): Promise<void>; // changed: by project+key, not id
```

API key methods:
```typescript
getAllApiKeys(projectId?: string): Promise<ApiKey[]>;
// getApiKey(key) unchanged — still looks up by key string
```

---

## Backend

### New file: `src/routes/projects.ts`

`createProjectsRouter(storage: Storage)` — all routes require admin session (applied in index.ts):

```
POST   /admin/projects
  body: { name: string }
  → 201 Project

GET    /admin/projects
  → 200 Project[]

DELETE /admin/projects/:id
  → 204 (also deletes all environments, flags, api keys for that project)

GET    /admin/projects/:id/environments
  → 200 Environment[]

POST   /admin/projects/:id/environments
  body: { name: string }
  → 201 Environment
  side effect: for every existing flag key in the project, insert a new flag row for this environment with enabled: false

DELETE /admin/projects/:id/environments/:envId
  → 204 (also deletes all flags for that environment, and api keys scoped to it)
```

### Modified: `src/routes/admin.ts`

- `POST /admin/api-keys` — body now requires `projectId`
- `GET /admin/api-keys` — accepts `?projectId=` query param, returns only that project's keys (excluding `__ui_admin__`)

### Modified: `src/routes/flags.ts`

All operations read `req.apiKey.projectId` (set by auth middleware) to scope queries.

- `POST /api/flags` — no longer needs `environment` in body (comes from API key). Creates the flag once; body needs `key`, `name`, `description?`. No longer returns a single flag — but for the API response, returns the flag record for the API key's environment.
- `GET /api/flags` — filtered by `projectId + environment` from API key
- `GET /api/flags/:key` — filtered by `projectId + environment` from API key
- `PATCH /api/flags/:key` — updates the specific `projectId + environment + key` row
- `DELETE /api/flags/:key` — deletes ALL environment rows for that flag key in the project

### Modified: `src/middleware/auth.ts`

`req.apiKey` now includes `projectId`:
```typescript
req.apiKey = {
  id: string;
  name: string;
  projectId: string;  // NEW
  environment: string;
}
```

### Modified: `src/index.ts`

- Mount `createProjectsRouter(storage)` at `/admin` (alongside existing admin router, or merged into it)
- `bootstrapUiAdminKey` — the `__ui_admin__` key no longer needs a `projectId` (it's a special internal key); give it a sentinel `projectId = '__admin__'` consistent with environment

---

## Frontend

### Modified: `ui/src/App.tsx`

State changes:
- Add `projects: Project[]`, `project: Project | null`
- Add `environments: Environment[]`, `environment: string`
- On auth: load all projects, select first
- On project change: load environments for that project, select first environment
- Pass `project.id` and `environment` down to pages

Sidebar layout (top to bottom):
1. Logo
2. **Project selector** — dropdown of project names
3. **Environment selector** — dropdown of environments for current project
4. Nav links (Feature Flags, API Keys, Projects)
5. Sign out

### New page: `ui/src/pages/ProjectsPage.tsx`

- List all projects with their environments inline
- Create project (name input + button)
- Per project: add environment (name input), delete environment
- Delete project (with confirm)

### Modified: `ui/src/pages/FlagsPage.tsx`

- Receives `projectId` and `environment` as props (instead of just `environment`)
- Create flag form: no environment selector (auto-applied to all envs) — just `key`, `name`, `description`
- All API calls pass `projectId` via the API key (transparent — the bearer token carries it)

### Modified: `ui/src/pages/ApiKeysPage.tsx`

- Receives `projectId` as prop
- Lists only API keys for current project
- Create form: environment is a dropdown of the current project's environments (not free text)

### New file: `ui/src/api/projects.ts`

```typescript
export async function getProjects(): Promise<Project[]>
export async function createProject(name: string): Promise<Project>
export async function deleteProject(id: string): Promise<void>
export async function getEnvironments(projectId: string): Promise<Environment[]>
export async function createEnvironment(projectId: string, name: string): Promise<Environment>
export async function deleteEnvironment(projectId: string, envId: string): Promise<void>
```

### Modified: `ui/src/api/apiKeys.ts`

- `getApiKeys(projectId: string)` — adds `?projectId=` query param
- `createApiKey(name, environment, projectId)` — adds `projectId` to body

---

## Authentication Flow (app clients)

1. Admin creates project `myapp` with environments `production`, `staging`
2. Admin creates API key for `myapp / production` → gets `rf_xxxx`
3. App client sends `Authorization: Bearer rf_xxxx`
4. Auth middleware looks up the key, finds `{ projectId: 'myapp-id', environment: 'production' }`
5. All flag queries automatically scoped to that project + environment

---

## Error Handling

- Creating a project with a duplicate name → 409 `{ error: 'Project name already exists' }`
- Creating an environment with a duplicate name in the same project → 409 `{ error: 'Environment already exists in this project' }`
- Deleting a project that has API keys in use → 204 anyway (hard delete, caller's responsibility)
- Creating a flag with a duplicate key in the same project → 409 (same as today but scoped to project)

---

## Testing

### Backend (`src/test/`)

- `routes-projects.test.ts` — CRUD projects and environments, including:
  - Creating a flag after adding an environment auto-creates the flag row for that env
  - Deleting an environment removes its flag rows
  - Deleting a project cascades to environments, flags, api keys
- `routes-flags.test.ts` — update to pass `projectId` via API key
- `routes-admin.test.ts` — update to include `projectId` in API key creation
- `storage-sqlite.test.ts` and `storage-json.test.ts` — new tests for project/environment CRUD

### What does NOT change

- Auth middleware logic (bearer token lookup) — only the shape of `req.apiKey`
- Admin session cookie auth — completely unchanged
- Evaluator logic — unchanged (still takes a flag and context)
- `/api/evaluate` routes — unchanged in behavior, just scoped by projectId from auth

---

## Out of Scope

- Project-level roles or permissions (single admin user)
- Renaming projects or environments
- Reordering environments
- Copying flags between projects
- API key rotation
