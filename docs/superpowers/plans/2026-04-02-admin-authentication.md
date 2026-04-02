# Admin Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect all `/admin/*` endpoints with password-based authentication using httpOnly session cookies, with a login page in the React UI.

**Architecture:** A `SessionStore` (`Map<string, Date>`) is created once in `src/index.ts` and shared between the new `createAuthRouter` and `requireAdminSession` middleware. `ADMIN_PASSWORD` is read from `.env` at startup; if absent it is auto-generated and appended to `.env`. The React UI checks auth state on mount via `GET /auth/me` and renders a login page or the main app accordingly.

**Tech Stack:** Express + cookie-parser (new dep), nanoid (existing), Node.js crypto for timing-safe compare, React + react-router-dom (existing).

---

## File Structure

**New files:**
- `src/middleware/adminAuth.ts` — `requireAdminSession` middleware
- `src/routes/auth.ts` — `createAuthRouter` with login/logout/me endpoints
- `src/test/routes-auth.test.ts` — backend tests for auth routes + admin protection
- `ui/src/api/auth.ts` — `login`, `logout`, `checkAuth` functions
- `ui/src/pages/LoginPage.tsx` — login form page

**Modified files:**
- `package.json` — add `cookie-parser` + `@types/cookie-parser`
- `src/index.ts` — bootstrap password, create sessions, mount auth router, protect `/admin`
- `ui/src/App.tsx` — auth state, conditional render, logout button
- `.env.example` — add `ADMIN_PASSWORD=` example line

---

### Task 1: Install cookie-parser

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install cookie-parser**

```bash
yarn add cookie-parser
yarn add -D @types/cookie-parser
```

- [ ] **Step 2: Verify installation**

```bash
grep cookie-parser package.json
```

Expected output includes `"cookie-parser"` in dependencies and `"@types/cookie-parser"` in devDependencies.

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add cookie-parser dependency"
```

---

### Task 2: SessionStore type + adminAuth middleware

**Files:**
- Create: `src/middleware/adminAuth.ts`
- Test: `src/test/routes-auth.test.ts` (partial — just the middleware behavior)

- [ ] **Step 1: Write the failing test**

Create `src/test/routes-auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { requireAdminSession, SessionStore } from '../middleware/adminAuth';
import * as path from 'path';
import * as fs from 'fs';

describe('requireAdminSession middleware', () => {
  let app: Express;
  let sessions: SessionStore;

  beforeEach(() => {
    sessions = new Map();
    app = express();
    app.use(cookieParser());
    app.use('/admin', requireAdminSession(sessions), (_req, res) => {
      res.json({ ok: true });
    });
  });

  it('returns 401 with no cookie', async () => {
    const res = await request(app).get('/admin/anything');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 with unknown token', async () => {
    const res = await request(app)
      .get('/admin/anything')
      .set('Cookie', 'rf_session=unknown-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with expired token', async () => {
    const expiredDate = new Date(Date.now() - 1000);
    sessions.set('expired-token', expiredDate);
    const res = await request(app)
      .get('/admin/anything')
      .set('Cookie', 'rf_session=expired-token');
    expect(res.status).toBe(401);
    // Expired token should be cleaned up from map
    expect(sessions.has('expired-token')).toBe(false);
  });

  it('passes through with valid token', async () => {
    const validDate = new Date(Date.now() + 86400000);
    sessions.set('valid-token', validDate);
    const res = await request(app)
      .get('/admin/anything')
      .set('Cookie', 'rf_session=valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/test/routes-auth.test.ts
```

Expected: FAIL — cannot find module `../middleware/adminAuth`

- [ ] **Step 3: Implement the middleware**

Create `src/middleware/adminAuth.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';

export type SessionStore = Map<string, Date>; // token → expiresAt

export function requireAdminSession(sessions: SessionStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.rf_session as string | undefined;

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const expiresAt = sessions.get(token);

    if (!expiresAt) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (expiresAt <= new Date()) {
      sessions.delete(token);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test src/test/routes-auth.test.ts
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/middleware/adminAuth.ts src/test/routes-auth.test.ts
git commit -m "feat: add requireAdminSession middleware"
```

---

### Task 3: Auth router (login / logout / me)

**Files:**
- Create: `src/routes/auth.ts`
- Modify: `src/test/routes-auth.test.ts` (add auth route tests)

- [ ] **Step 1: Write the failing tests**

Append to `src/test/routes-auth.test.ts`:

```typescript
import { createAuthRouter } from '../routes/auth';

describe('Auth routes', () => {
  let app: Express;
  let sessions: SessionStore;
  const TEST_PASSWORD = 'test-password-123';

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = TEST_PASSWORD;
    sessions = new Map();
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', createAuthRouter(sessions));
  });

  describe('POST /auth/login', () => {
    it('returns 200 and sets cookie on correct password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      const cookie = res.headers['set-cookie'] as string[] | undefined;
      expect(cookie).toBeDefined();
      expect(cookie![0]).toContain('rf_session=');
      expect(cookie![0]).toContain('HttpOnly');
    });

    it('returns 401 on wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid password' });
    });

    it('returns 400 on missing password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Password is required' });
    });

    it('stores session token in sessions map', async () => {
      await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      expect(sessions.size).toBe(1);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the session cookie and removes token from map', async () => {
      // Login first
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      const cookie = (loginRes.headers['set-cookie'] as string[])[0];

      // Logout
      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Cookie', cookie);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body).toEqual({ ok: true });
      expect(sessions.size).toBe(0);
      const clearedCookie = (logoutRes.headers['set-cookie'] as string[])[0];
      expect(clearedCookie).toContain('rf_session=;');
    });
  });

  describe('GET /auth/me', () => {
    it('returns authenticated: true with valid session', async () => {
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD });
      const cookie = (loginRes.headers['set-cookie'] as string[])[0];

      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: true });
    });

    it('returns authenticated: false with no session', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
    });

    it('returns authenticated: false with expired session', async () => {
      sessions.set('expired', new Date(Date.now() - 1000));
      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', 'rf_session=expired');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test src/test/routes-auth.test.ts
```

Expected: FAIL — cannot find module `../routes/auth`

- [ ] **Step 3: Implement the auth router**

Create `src/routes/auth.ts`:

```typescript
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { timingSafeEqual } from 'crypto';
import { SessionStore } from '../middleware/adminAuth.js';

export function createAuthRouter(sessions: SessionStore) {
  const router = Router();

  const isSecure = process.env.NODE_ENV === 'production';

  router.post('/login', (req, res): void => {
    const { password } = req.body as { password?: string };

    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const adminPassword = process.env.ADMIN_PASSWORD ?? '';

    // Constant-time comparison to prevent timing attacks
    let passwordsMatch = false;
    try {
      const a = Buffer.from(password);
      const b = Buffer.from(adminPassword);
      passwordsMatch = a.length === b.length && timingSafeEqual(a, b);
    } catch {
      passwordsMatch = false;
    }

    if (!passwordsMatch) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    const token = nanoid(48);
    const expiresAt = new Date(Date.now() + 86400000); // 24h
    sessions.set(token, expiresAt);

    res.cookie('rf_session', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 86400000,
    });

    res.json({ ok: true });
  });

  router.post('/logout', (req, res): void => {
    const token = req.cookies?.rf_session as string | undefined;
    if (token) {
      sessions.delete(token);
    }
    res.clearCookie('rf_session');
    res.json({ ok: true });
  });

  router.get('/me', (req, res): void => {
    const token = req.cookies?.rf_session as string | undefined;

    if (!token) {
      res.json({ authenticated: false });
      return;
    }

    const expiresAt = sessions.get(token);

    if (!expiresAt || expiresAt <= new Date()) {
      if (token) sessions.delete(token);
      res.json({ authenticated: false });
      return;
    }

    res.json({ authenticated: true });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test src/test/routes-auth.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.ts src/test/routes-auth.test.ts
git commit -m "feat: add auth router with login/logout/me endpoints"
```

---

### Task 4: Wire auth into src/index.ts + protect /admin

**Files:**
- Modify: `src/index.ts`
- Modify: `.env.example`
- Modify: `src/test/routes-auth.test.ts` (add admin protection tests)

- [ ] **Step 1: Write the failing test for admin protection**

Append to the `describe('Auth routes', ...)` block in `src/test/routes-auth.test.ts`:

```typescript
describe('Admin route protection', () => {
  let appWithAdmin: Express;
  let sessions: SessionStore;
  const TEST_PASSWORD = 'test-password-123';
  const testDbPath = path.join(__dirname, '../../test-data/routes-auth-admin.db');

  beforeEach(async () => {
    process.env.ADMIN_PASSWORD = TEST_PASSWORD;
    sessions = new Map();

    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const storage = new SqliteStorage(testDbPath);
    await storage.initialize();

    appWithAdmin = express();
    appWithAdmin.use(express.json());
    appWithAdmin.use(cookieParser());
    appWithAdmin.use('/auth', createAuthRouter(sessions));
    appWithAdmin.use('/admin', requireAdminSession(sessions), createAdminRouter(storage));
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('returns 401 on /admin without session', async () => {
    const res = await request(appWithAdmin).get('/admin/api-keys');
    expect(res.status).toBe(401);
  });

  it('allows /admin with valid session cookie', async () => {
    const loginRes = await request(appWithAdmin)
      .post('/auth/login')
      .send({ password: TEST_PASSWORD });
    const cookie = (loginRes.headers['set-cookie'] as string[])[0];

    const res = await request(appWithAdmin)
      .get('/admin/api-keys')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });
});
```

Also add the missing imports at the top of the file (after existing imports):

```typescript
import { SqliteStorage } from '../storage/sqlite';
import { createAdminRouter } from '../routes/admin';
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/test/routes-auth.test.ts
```

Expected: FAIL on admin protection tests

- [ ] **Step 3: Run existing full test suite to ensure nothing is broken**

```bash
yarn test
```

Expected: all existing tests PASS (admin protection tests fail, others pass)

- [ ] **Step 4: Update src/index.ts**

Replace the contents of `src/index.ts` with:

```typescript
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { appendFileSync, existsSync } from 'fs';
import { SqliteStorage } from './storage/sqlite.js';
import { JsonStorage } from './storage/json.js';
import { Storage } from './types.js';
import { FlagEvaluator } from './evaluator.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { requireAdminSession, SessionStore } from './middleware/adminAuth.js';
import { createFlagsRouter } from './routes/flags.js';
import { createEvaluateRouter } from './routes/evaluate.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { nanoid } from 'nanoid';

dotenv.config();

const PORT = process.env.PORT || 3000;
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'sqlite';
const STORAGE_PATH = process.env.STORAGE_PATH || './data/rollerflags.db';

const __dirname = dirname(fileURLToPath(import.meta.url));

function bootstrapAdminPassword(): void {
  if (process.env.ADMIN_PASSWORD) return;

  const password = `rf_admin_${nanoid(32)}`;
  process.env.ADMIN_PASSWORD = password;

  const envPath = join(process.cwd(), '.env');
  const line = `\nADMIN_PASSWORD=${password}\n`;
  appendFileSync(envPath, line, 'utf8');

  console.log('\n========================================');
  console.log('  ADMIN PASSWORD GENERATED (first boot)');
  console.log(`  ${password}`);
  console.log('  Saved to .env — keep it safe!');
  console.log('========================================\n');
}

async function bootstrapUiAdminKey(storage: Storage): Promise<void> {
  const allKeys = await storage.getAllApiKeys();
  const exists = allKeys.some(k => k.name === '__ui_admin__');
  if (!exists) {
    await storage.createApiKey({
      key: `rf_${nanoid(32)}`,
      name: '__ui_admin__',
      environment: '__admin__'
    });
    console.log('✓ UI admin key created');
  }
}

async function main() {
  bootstrapAdminPassword();

  const app = express();
  const sessions: SessionStore = new Map();

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // Initialize storage
  let storage: Storage;
  if (STORAGE_TYPE === 'json') {
    storage = new JsonStorage(STORAGE_PATH);
  } else {
    storage = new SqliteStorage(STORAGE_PATH);
  }

  await storage.initialize();
  console.log(`✓ Storage initialized (${STORAGE_TYPE})`);

  await bootstrapUiAdminKey(storage);

  const evaluator = new FlagEvaluator();
  const authMiddleware = createAuthMiddleware(storage);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', storage: STORAGE_TYPE });
  });

  // Auth routes (public)
  app.use('/auth', createAuthRouter(sessions));

  // Admin routes (session-protected)
  app.use('/admin', requireAdminSession(sessions), createAdminRouter(storage));

  // Protected routes (bearer token)
  app.use('/api/flags', authMiddleware, createFlagsRouter(storage));
  app.use('/api/evaluate', authMiddleware, createEvaluateRouter(storage, evaluator));

  // Serve Web UI static files
  const uiDistPath = join(__dirname, '../ui/dist');
  app.use(express.static(uiDistPath));

  // SPA catch-all
  app.get('*', (_req, res) => {
    res.sendFile(join(uiDistPath, 'index.html'), (err) => {
      if (err) res.status(404).send('Not found');
    });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 RollerFlags is running on http://localhost:${PORT}`);
    console.log(`   Storage: ${STORAGE_TYPE}`);
    console.log(`   Path: ${STORAGE_PATH}\n`);
  });
}

main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
```

- [ ] **Step 5: Update .env.example**

Add `ADMIN_PASSWORD=` line:

```
PORT=6789
STORAGE_TYPE=sqlite
STORAGE_PATH=./data/rollerflags.db
# For JSON storage, use:
# STORAGE_TYPE=json
# STORAGE_PATH=./data/flags.json
# Admin password (auto-generated on first boot if not set)
# ADMIN_PASSWORD=
```

- [ ] **Step 6: Run the full test suite**

```bash
yarn test
```

Expected: all tests PASS including the new admin protection tests

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/test/routes-auth.test.ts .env.example
git commit -m "feat: protect /admin routes with session auth"
```

---

### Task 5: Frontend — auth API + LoginPage

**Files:**
- Create: `ui/src/api/auth.ts`
- Create: `ui/src/pages/LoginPage.tsx`

- [ ] **Step 1: Create ui/src/api/auth.ts**

```typescript
export async function login(password: string): Promise<void> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? 'Login failed');
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return false;
    const data = await res.json() as { authenticated: boolean };
    return data.authenticated;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create ui/src/pages/LoginPage.tsx**

```typescript
import { useState } from 'react';
import { login } from '../api/auth';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 12,
          padding: 40,
          width: 360,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          border: '1px solid #e5e7eb',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚩</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>RollerFlags</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>Sign in to continue</p>
        </div>
        <form onSubmit={e => void handleSubmit(e)}>
          <div style={{ marginBottom: 16 }}>
            <label
              style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${error ? '#fca5a5' : '#d1d5db'}`,
                borderRadius: 6,
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {error && (
            <p style={{ fontSize: 13, color: '#ef4444', marginBottom: 12 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%',
              padding: '10px',
              background: loading || !password ? '#93c5fd' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: loading || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/api/auth.ts ui/src/pages/LoginPage.tsx
git commit -m "feat: add login page and auth API client"
```

---

### Task 6: Wire auth into App.tsx

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Update ui/src/App.tsx**

Replace the full content of `ui/src/App.tsx` with:

```typescript
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { FlagsPage } from './pages/FlagsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { LoginPage } from './pages/LoginPage';
import { Spinner } from './components/Spinner';
import { getApiKeys } from './api/apiKeys';
import { checkAuth, logout } from './api/auth';

const globalStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
`;

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [environment, setEnvironment] = useState('');

  useEffect(() => {
    checkAuth().then(ok => setAuthenticated(ok));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    getApiKeys().then(keys => {
      const envs = [...new Set(keys.map(k => k.environment))].sort();
      setEnvironments(envs);
      if (envs.length > 0) setEnvironment(envs[0]);
    }).catch(() => {});
  }, [authenticated]);

  async function handleLogout() {
    await logout();
    setAuthenticated(false);
  }

  if (authenticated === null) {
    return (
      <>
        <style>{globalStyles}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <Spinner />
        </div>
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
        <style>{globalStyles}</style>
        <LoginPage onLogin={() => setAuthenticated(true)} />
      </>
    );
  }

  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Sidebar */}
        <aside
          style={{
            width: 220,
            background: '#1e293b',
            color: '#94a3b8',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
          }}
        >
          {/* Logo */}
          <div
            style={{
              padding: '20px 20px 16px',
              color: 'white',
              fontWeight: 700,
              fontSize: 16,
              borderBottom: '1px solid #334155',
            }}
          >
            🚩 RollerFlags
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '12px 12px' }}>
            {[
              { to: '/flags', label: 'Feature Flags' },
              { to: '/api-keys', label: 'API Keys' },
            ].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                style={({ isActive }) => ({
                  display: 'block',
                  padding: '8px 12px',
                  borderRadius: 6,
                  marginBottom: 2,
                  color: isActive ? 'white' : '#94a3b8',
                  background: isActive ? '#334155' : 'transparent',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: isActive ? 500 : 400,
                })}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Environment selector */}
          <div style={{ padding: '16px', borderTop: '1px solid #334155' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Environment
            </div>
            <select
              value={environment}
              onChange={e => setEnvironment(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#334155',
                border: '1px solid #475569',
                borderRadius: 6,
                color: 'white',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {environments.length === 0
                ? <option value="">No environments yet</option>
                : environments.map(env => (
                    <option key={env} value={env}>{env}</option>
                  ))
              }
            </select>
          </div>

          {/* Logout */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #334155' }}>
            <button
              onClick={() => void handleLogout()}
              style={{
                width: '100%',
                padding: '7px 12px',
                background: 'transparent',
                border: '1px solid #475569',
                borderRadius: 6,
                color: '#94a3b8',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, marginLeft: 220, minHeight: '100vh' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/flags" replace />} />
            <Route path="/flags" element={<FlagsPage environment={environment} />} />
            <Route path="/api-keys" element={<ApiKeysPage onKeysChange={() => {
              getApiKeys().then(keys => {
                const envs = [...new Set(keys.map(k => k.environment))].sort();
                setEnvironments(envs);
                if (!envs.includes(environment)) setEnvironment(envs[0] ?? '');
              }).catch(() => {});
            }} />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Handle 401 from admin calls in apiKeys API client**

Open `ui/src/api/apiKeys.ts`. After any fetch call that receives a 401, the UI should redirect to login. Add a helper to the existing `apiFetch` equivalent. Since the admin calls use plain `fetch`, wrap them to handle 401.

Read `ui/src/api/apiKeys.ts` first to understand its current shape, then add 401 handling: if any response is 401, dispatch a custom event `unauthorized` on `window` so App.tsx can react.

In `ui/src/api/apiKeys.ts`, replace every `fetch(` call with a helper `adminFetch` that checks for 401:

```typescript
async function adminFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.dispatchEvent(new Event('rf:unauthorized'));
  }
  return res;
}
```

Then replace all `fetch(` calls in that file with `adminFetch(`.

- [ ] **Step 3: Listen for unauthorized event in App.tsx**

In `ui/src/App.tsx`, inside the `useEffect` that runs when `authenticated` is `true`, add:

```typescript
useEffect(() => {
  function handleUnauthorized() {
    setAuthenticated(false);
  }
  window.addEventListener('rf:unauthorized', handleUnauthorized);
  return () => window.removeEventListener('rf:unauthorized', handleUnauthorized);
}, []);
```

- [ ] **Step 4: Start the dev server and verify manually**

```bash
yarn dev
```

1. Open `http://localhost:5173` — should show login page
2. Enter wrong password — should show "Invalid password"
3. Enter correct password (check `.env` for `ADMIN_PASSWORD`) — should navigate to flags page
4. Navigate to `/api-keys` — should work
5. Click "Sign out" — should return to login page
6. Reload `http://localhost:5173/api-keys` — should show login page (not authenticated)

- [ ] **Step 5: Commit**

```bash
git add ui/src/App.tsx ui/src/api/apiKeys.ts
git commit -m "feat: wire admin auth into React UI with login page and logout"
```

---

### Task 7: Run full test suite + final check

**Files:** none (verification only)

- [ ] **Step 1: Run all backend tests**

```bash
yarn test
```

Expected: all tests PASS

- [ ] **Step 2: Check for TypeScript errors**

```bash
yarn build
```

Expected: builds without errors

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: address any build or test issues"
```
