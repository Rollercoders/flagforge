# FlagForge Client Libraries — Design Spec

**Date:** 2026-04-04
**Scope:** `flagforge-react` and `flagforge-php` — two separate repositories in `~/Projects/misc/`

---

## Overview

Two standalone read-only client libraries for consuming FlagForge feature flags. Both libraries only evaluate flags — no management (create/update/delete) capabilities.

---

## Server Change Required

Add `POST /api/evaluate/all` to FlagForge server.

**Request:**
```json
{
  "userId": "user-123",
  "attributes": { "plan": "premium" }
}
```

**Response:** `Record<string, boolean>` — same format as the existing batch endpoint.

This endpoint evaluates all flags for the authenticated environment in a single call.

---

## Library 1: `flagforge-react`

**Repository:** `~/Projects/misc/flagforge-react`
**Published to:** npm

### Architecture

Provider + hooks + components pattern. `FlagForgeProvider` initializes the client and manages flag state in React context.

```
FlagForgeProvider (context, fetch, polling)
  ├── useFlagForge()        — raw context access
  ├── useFlag(key)          — boolean for a single flag
  ├── useFlags(keys[])      — Record<string, boolean> for multiple flags
  ├── <FeatureFlag>         — renders children if flag is true
  └── <FlagGate>            — renders children/fallback based on flag
```

### Provider API

```tsx
<FlagForgeProvider
  host="https://flagforge.myapp.com"
  apiKey="ff_xxxx"
  mode="eager"             // "eager" | "lazy" — default: "eager"
  pollInterval={30000}     // ms, optional — only meaningful in eager mode
  context={{
    userId: "user-123",
    attributes: { plan: "premium" }
  }}
>
```

### Modes

**eager (default):** On mount, calls `POST /api/evaluate/all` to pre-fetch all flags. Optional polling refreshes all flags every `pollInterval` ms. Flag values are available immediately from context.

**lazy:** No fetch on mount. Each `useFlag(key)` call triggers `POST /api/evaluate/:key` on-demand. Results are cached locally in context to avoid duplicate calls. No polling.

### Data Flow

**Eager:**
1. Provider mounts → `POST /api/evaluate/all` with `context`
2. Response populates flags map in context
3. If `pollInterval` set → repeat step 1 every N ms
4. If `context` prop changes → re-fetch immediately

**Lazy:**
1. Provider mounts → no fetch
2. `useFlag(key)` called → check local cache → if miss, `POST /api/evaluate/:key`
3. Result stored in local cache
4. Cache is per-mount (cleared on unmount)

### State

```typescript
interface FlagForgeState {
  flags: Record<string, boolean>;
  loading: boolean;   // true only during initial fetch (eager mode)
  error: Error | null;
}
```

### Error Handling

- `loading: true` during initial fetch — `useFlag` returns `false` (fail-safe)
- Network error on first fetch: `error` is set, all flags return `false`
- Network error on poll refresh: `error` is set, flags retain last known values
- Unknown flag key: returns `false`
- Lazy fetch error: `useFlag` returns `false`, `error` is set on context

### Components

```tsx
// Renders children only if flag is enabled
<FeatureFlag flag="new-dashboard">
  <NewDashboard />
</FeatureFlag>

// Renders children or fallback
<FlagGate flag="new-dashboard" fallback={<OldDashboard />}>
  <NewDashboard />
</FlagGate>
```

### Hooks

```typescript
const enabled = useFlag("new-dashboard");              // boolean
const flags = useFlags(["flag-a", "flag-b"]);          // Record<string, boolean>
const { flags, loading, error } = useFlagForge();      // raw context
```

### Testing

- Vitest + React Testing Library
- Fetch mocked — tests cover: loading state, success, error, unknown flag, polling (fake timers)
- Both eager and lazy modes tested

### Project Structure

```
flagforge-react/
├── src/
│   ├── context.tsx          — FlagForgeContext + FlagForgeProvider
│   ├── hooks.ts             — useFlag, useFlags, useFlagForge
│   ├── components.tsx       — FeatureFlag, FlagGate
│   ├── client.ts            — HTTP client (fetch wrapper)
│   └── index.ts             — public exports
├── test/
│   ├── hooks.test.tsx
│   └── components.test.tsx
├── package.json
├── tsconfig.json
├── vite.config.ts           — library build
└── README.md
```

---

## Library 2: `flagforge-php`

**Repository:** `~/Projects/misc/flagforge-php`
**Published to:** Packagist (Composer)
**Requires:** PHP 8.1+, ext-curl

### Architecture

Single class `FlagForgeClient` with no external dependencies. Uses cURL for HTTP calls.

### Client API

```php
$client = new FlagForgeClient([
    'host'    => 'https://flagforge.myapp.com',
    'api_key' => 'ff_xxxx',
    'timeout' => 5,  // seconds, optional — default: 5
]);

// Evaluate a single flag — throws FlagForgeException on error
$enabled = $client->isEnabled('new-dashboard', [
    'userId'     => 'user-123',
    'attributes' => ['plan' => 'premium'],
]);

// Evaluate a single flag — returns false on error (no exception)
$enabled = $client->isEnabledSafe('new-dashboard', [
    'userId' => 'user-123',
]);

// Evaluate multiple flags
$results = $client->evaluateMany(['flag-a', 'flag-b'], [
    'userId' => 'user-123',
]);
// Returns: ['flag-a' => true, 'flag-b' => false]

// Evaluate all flags
$results = $client->evaluateAll([
    'userId' => 'user-123',
]);
```

### Caching

No built-in cache. PHP share-nothing model means each request makes its own HTTP call. Users can wrap calls with their preferred cache (APCu, Redis, etc.).

### Error Handling

- `FlagForgeException` thrown on: cURL error, non-2xx HTTP response, invalid JSON response
- `isEnabledSafe()` catches all exceptions and returns `false`
- `evaluateMany()` and `evaluateAll()` always throw — callers handle exceptions explicitly

### Project Structure

```
flagforge-php/
├── src/
│   ├── FlagForgeClient.php
│   └── FlagForgeException.php
├── tests/
│   └── FlagForgeClientTest.php   — PHPUnit, HTTP mocked via mock handler
├── composer.json
└── README.md
```

### composer.json

```json
{
  "name": "flagforge/flagforge-php",
  "description": "PHP client for FlagForge feature flagging",
  "require": { "php": ">=8.1", "ext-curl": "*" },
  "require-dev": { "phpunit/phpunit": "^11" },
  "autoload": { "psr-4": { "FlagForge\\": "src/" } }
}
```

---

## Out of Scope

- Flag management (create/update/delete) in client libraries
- Framework-specific integrations (Laravel, Symfony, Next.js SSR, etc.)
- Built-in caching in PHP library
- Per-flag polling in lazy mode
