# Admin Authentication Design

## Goal

Protect all `/admin/*` endpoints with password-based authentication, using httpOnly cookies for session management, so that only the configured admin can manage API keys and feature flags via the backoffice UI.

## Context

RollerFlags is a self-hosted on-prem platform. The backoffice UI (`/admin/*` routes) is currently completely unauthenticated — anyone who can reach the server can create/delete API keys and flags. App clients authenticate via Bearer tokens (`/api/*` routes) which remain unchanged.

---

## Architecture

### Session Management

- Session tokens are stored in-memory on the server: `Map<token, expiresAt: Date>`
- Token: `nanoid(48)` — opaque, unguessable
- TTL: 24 hours from login
- No persistence across server restarts (intentional — forces re-login on deploy)
- Session cleanup: expired tokens are purged lazily (on each auth check) or on a periodic interval

### Password Storage

- `ADMIN_PASSWORD` environment variable in `.env`
- If absent at startup: auto-generate a strong password, append it to `.env`, print it once to console with clear formatting
- No hashing needed — it's compared at login time only, not stored in a DB. Simple constant-time string comparison (`crypto.timingSafeEqual`) to prevent timing attacks.

### Cookie

- Name: `rf_session`
- Flags: `HttpOnly; Secure; SameSite=Strict; Max-Age=86400` (24h)
- `Secure` flag: set when `NODE_ENV=production`. In development, omit to allow plain HTTP.

---

## Backend

### New file: `src/routes/auth.ts`

Factory function `createAuthRouter(sessions: SessionStore)` returns an Express Router with:

**`POST /auth/login`**
- Body: `{ password: string }`
- Compare with `ADMIN_PASSWORD` using `crypto.timingSafeEqual`
- On success: generate token, store in sessions map, set `rf_session` cookie, return `{ ok: true }`
- On failure: 401 `{ error: 'Invalid password' }`
- Rate limiting: not in scope for this spec (can be added later via middleware)

**`POST /auth/logout`**
- Reads `rf_session` cookie, removes from sessions map
- Clears cookie, returns `{ ok: true }`

**`GET /auth/me`**
- Returns `{ authenticated: true }` if session cookie is valid and not expired
- Returns `{ authenticated: false }` (200, not 401) if not authenticated — used by UI to decide what to render

### New file: `src/middleware/adminAuth.ts`

`requireAdminSession(sessions: SessionStore)` middleware:
- Reads `rf_session` cookie from request
- Looks up in sessions map
- If missing or expired: remove from map (cleanup), return 401 `{ error: 'Unauthorized' }`
- If valid: call `next()`

### `SessionStore` type

```typescript
type SessionStore = Map<string, Date>; // token → expiresAt
```

Created once in `src/index.ts`, passed to both `createAuthRouter` and `requireAdminSession`.

### Changes to `src/index.ts`

1. Create `const sessions: SessionStore = new Map()`
2. Mount `createAuthRouter(sessions)` at `/auth`
3. Apply `requireAdminSession(sessions)` to all `/admin/*` routes (before existing admin router)
4. Bootstrap `ADMIN_PASSWORD` on startup:
   - If `process.env.ADMIN_PASSWORD` is set: use it
   - If not: generate `rf_admin_<nanoid(32)>`, write to `.env` (append line), set `process.env.ADMIN_PASSWORD`, print to console

### Cookie parsing

Use the `cookie-parser` package (already a common Express dep, or add it). Parse `req.cookies.rf_session` in the middleware.

---

## Frontend

### New file: `ui/src/pages/LoginPage.tsx`

Simple centered form:
- Password input (type=password)
- "Login" button
- Error message on 401
- On success: navigate to `/flags`

No username field — there's only one admin user.

### New file: `ui/src/api/auth.ts`

```typescript
export async function login(password: string): Promise<void>
export async function logout(): Promise<void>
export async function checkAuth(): Promise<boolean>
```

All use plain `fetch` to `/auth/*` endpoints. Cookies are sent automatically by the browser (`credentials: 'include'` not needed since same-origin).

### Changes to `ui/src/App.tsx`

1. Add `authenticated` state (initially `null` = loading)
2. On mount: call `checkAuth()`, set `authenticated` accordingly
3. If `authenticated === null`: show loading spinner
4. If `authenticated === false`: render `<LoginPage onLogin={() => setAuthenticated(true)} />`
5. If `authenticated === true`: render existing app layout
6. Add logout button in sidebar → calls `logout()`, sets `authenticated(false)`

---

## Error Handling

- `POST /auth/login` 401: show "Invalid password" in UI, do not clear the password field
- Any `/admin/*` call returns 401 while user is logged in: show toast "Session expired, please log in again" and redirect to login (set `authenticated(false)`)
- `GET /auth/me` network failure: treat as not authenticated (fail closed)

---

## Testing

### Backend tests (`src/test/routes-auth.test.ts`)

- `POST /auth/login` with correct password → 200 + cookie set
- `POST /auth/login` with wrong password → 401
- `POST /auth/login` with missing password → 400
- `POST /auth/logout` → 200 + cookie cleared
- `GET /auth/me` with valid session → `{ authenticated: true }`
- `GET /auth/me` with no session → `{ authenticated: false }`
- `GET /auth/me` with expired session → `{ authenticated: false }`
- `/admin/*` without session → 401
- `/admin/*` with valid session → 200 (existing behavior)

### Test setup

Tests set `process.env.ADMIN_PASSWORD = 'test-password'` in `beforeEach`. Sessions map is created fresh per test suite. No real `.env` file is written in tests.

---

## What Does NOT Change

- `/api/flags/*` and `/api/evaluate/*` — unchanged, still use Bearer token auth
- The `__ui_admin__` internal API key mechanism — unchanged
- The admin router logic — only the auth middleware wraps it
- `.env.example` — add `ADMIN_PASSWORD=` as a commented example entry

---

## Out of Scope

- Multi-user / role-based access
- Password change via UI (change `.env` manually and restart)
- Rate limiting on login endpoint
- Session persistence across restarts
- CSRF protection (SameSite=Strict cookie provides sufficient protection for this use case)
