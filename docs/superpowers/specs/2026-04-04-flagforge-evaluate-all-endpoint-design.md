# FlagForge — `POST /api/evaluate/all` Endpoint — Design Spec

**Date:** 2026-04-04
**Scope:** Single new endpoint on the FlagForge server

---

## Overview

Add `POST /api/evaluate/all` to the FlagForge server. This endpoint evaluates all flags for the authenticated environment in a single call, returning a `Record<string, boolean>`. It is needed by client libraries (React, PHP) that want to pre-fetch all flag values at startup without a separate `GET /api/flags` call.

---

## Endpoint

```
POST /api/evaluate/all
Authorization: Bearer <environment-api-key>
```

**Request body:**
```json
{
  "userId": "user-123",
  "attributes": { "plan": "premium", "region": "us-west" }
}
```

Both fields are optional — same contract as `POST /api/evaluate` (batch).

**Response (200):**
```json
{
  "feature-x": true,
  "feature-y": false,
  "new-dashboard": true
}
```

Same format as the existing batch endpoint (`POST /api/evaluate`).

**Response (empty environment):** `{}` — no flags defined, not an error.

---

## Implementation

In `src/routes/evaluate.ts`:

1. Add route `router.post('/all', authMiddleware, handler)`
2. Handler reads context from request body (`userId`, `attributes`)
3. Calls `storage.getAllFlags(projectId, environment)` to get all flags for the environment
4. Runs `FlagEvaluator.evaluate(flag, context)` on each flag
5. Returns `Record<string, boolean>` keyed by `flag.key`

No new storage methods needed — reuses `getAllFlags` and `FlagEvaluator`.

---

## Auth

Same as all other `/api/*` routes — requires valid Bearer token. The environment and projectId are derived from the token, same as `GET /api/flags` and `POST /api/evaluate`.

---

## Testing

Add tests in `src/test/routes-evaluate.test.ts`:

- Returns all flags evaluated with context
- Empty environment returns `{}`
- Targeting and rollout rules are applied correctly
- Missing/invalid auth returns 401
- Body fields `userId` and `attributes` are optional
