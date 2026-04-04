# Evaluate All Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/evaluate/all` to FlagForge — evaluates all flags for the authenticated environment in one call, returning `Record<string, boolean>`.

**Architecture:** Single new route handler in `src/routes/evaluate.ts`, registered before the `/:key` wildcard. Reuses existing `storage.getAllFlags()` and `FlagEvaluator.evaluate()` — no new storage methods needed.

**Tech Stack:** TypeScript, Express, Vitest, Supertest

---

## Files

- Modify: `src/routes/evaluate.ts` — add `/all` route handler
- Modify: `src/test/routes-evaluate.test.ts` — add test suite for new endpoint

---

### Task 1: Add tests for `POST /api/evaluate/all`

**Files:**
- Modify: `src/test/routes-evaluate.test.ts`

- [ ] **Step 1: Add the new describe block at the end of the file, before the closing `}`**

Open `src/test/routes-evaluate.test.ts` and append this describe block after the `'Authentication'` describe block (before the final `});` that closes the outer `describe('Evaluate Routes', ...)`):

```typescript
  describe('POST /api/evaluate/all', () => {
    beforeEach(async () => {
      await storage.createFlag({
        key: 'flag-a',
        name: 'Flag A',
        enabled: true,
        environment: 'test',
        projectId
      });

      await storage.createFlag({
        key: 'flag-b',
        name: 'Flag B',
        enabled: false,
        environment: 'test',
        projectId
      });

      await storage.createFlag({
        key: 'flag-c',
        name: 'Flag C',
        enabled: true,
        environment: 'test',
        projectId,
        targeting: {
          userIds: ['user-premium']
        }
      });
    });

    it('should return all flags evaluated with context', async () => {
      const response = await request(app)
        .post('/api/evaluate/all')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ userId: 'user-123' });

      expect(response.status).toBe(200);
      expect(response.body['flag-a']).toBe(true);
      expect(response.body['flag-b']).toBe(false);
      expect(response.body['flag-c']).toBe(false); // targeting doesn't match
    });

    it('should apply targeting rules correctly', async () => {
      const response = await request(app)
        .post('/api/evaluate/all')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ userId: 'user-premium' });

      expect(response.status).toBe(200);
      expect(response.body['flag-c']).toBe(true); // targeting matches
    });

    it('should apply attribute targeting correctly', async () => {
      await storage.createFlag({
        key: 'premium-flag',
        name: 'Premium Flag',
        enabled: true,
        environment: 'test',
        projectId,
        targeting: { attributes: { plan: ['premium'] } }
      });

      const response = await request(app)
        .post('/api/evaluate/all')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ userId: 'user-123', attributes: { plan: 'premium' } });

      expect(response.status).toBe(200);
      expect(response.body['premium-flag']).toBe(true);
    });

    it('should return {} for an environment with no flags', async () => {
      const project2 = await storage.createProject({ name: 'empty-project' });
      const env2 = await storage.createEnvironment({ projectId: project2.id, name: 'empty' });

      const response = await request(app)
        .post('/api/evaluate/all')
        .set('Authorization', `Bearer ${env2.key}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    });

    it('should work without a body', async () => {
      const response = await request(app)
        .post('/api/evaluate/all')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({});

      expect(response.status).toBe(200);
      expect(typeof response.body).toBe('object');
    });

    it('should reject requests without auth', async () => {
      const response = await request(app)
        .post('/api/evaluate/all')
        .send({ userId: 'user-123' });

      expect(response.status).toBe(401);
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
yarn test src/test/routes-evaluate.test.ts
```

Expected: the 6 new tests in `POST /api/evaluate/all` fail with 404 (route not found yet). All existing tests still pass.

---

### Task 2: Implement `POST /api/evaluate/all`

**Files:**
- Modify: `src/routes/evaluate.ts`

- [ ] **Step 1: Add the `/all` route before the `/:key` wildcard**

Open `src/routes/evaluate.ts`. Insert this new route between line 6 (`const router = Router();`) and line 10 (`router.post('/:key', ...)`):

```typescript
  // Evaluate all flags for the environment
  router.post('/all', async (req: AuthRequest, res) => {
    try {
      const environment = req.apiKey?.environment;

      if (!environment) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const projectId = req.apiKey?.projectId ?? '';
      const body = req.body as { userId?: string; attributes?: Record<string, string> };
      const context: FlagEvaluationContext = {
        userId: body.userId,
        attributes: body.attributes
      };

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
```

**Important:** This route MUST appear before `router.post('/:key', ...)` — otherwise Express matches `/all` as a key value.

- [ ] **Step 2: Run the tests to verify they pass**

```bash
yarn test src/test/routes-evaluate.test.ts
```

Expected: all tests pass, including the 6 new ones.

- [ ] **Step 3: Run the full test suite to check for regressions**

```bash
yarn test
```

Expected: all 136+ tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/evaluate.ts src/test/routes-evaluate.test.ts
git commit -m "feat: aggiungi endpoint POST /api/evaluate/all"
```
