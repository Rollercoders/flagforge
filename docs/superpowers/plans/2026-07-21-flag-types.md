# Flag Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consentire ai flag di avere un tipo (`boolean` | `number` | `string`), servendo un `value` quando il flag è "on" e un `defaultValue` quando è "off"/no-match, senza rompere i flag booleani esistenti.

**Architecture:** Il "gate" (enabled + targeting + rollout) resta invariato e decide solo on/off. Un nuovo passo `resolveValue` mappa on/off al valore tipizzato. `boolean` è il default con `value=true`/`defaultValue=false` impliciti, quindi i flag esistenti non richiedono migrazione dati. Il tipo si propaga da modello → storage (sqlite+json) → evaluator → API REST → MCP → UI.

**Tech Stack:** TypeScript, Node, Express, better-sqlite3, Zod (MCP), Vitest, React (UI). Package manager: **yarn 4** (usare `yarn`, mai `npm`).

## Global Constraints

- Nessun breaking change: i flag esistenti diventano `type='boolean'`; il campo `enabled` nelle risposte API resta e per i boolean coincide col valore.
- `type` è immutabile dopo la creazione (come `key`): una PATCH con `type` diverso → 400.
- Per `number`/`string`: `value` e `defaultValue` sono obbligatori alla creazione. Per `boolean`: ignorati (valori impliciti `true`/`false`).
- `value`/`defaultValue` sono serializzati JSON in SQLite (colonne `value`, `default_value`) per preservare il tipo (`5` number vs `"5"` string).
- Commit in italiano, conventional commits, **no scope** (`feat: ...` non `feat(x): ...`).
- Test runner: `yarn test` (vitest). Lint: gira in pre-commit hook.
- Siamo già sul branch `feat/flag-types`.

## File Structure

- `src/types.ts` — aggiunge `FlagType`, `FlagValue`, campi `type`/`value`/`defaultValue` a `Flag`; estende `explain()` return type. **Modify.**
- `src/evaluator.ts` — `evaluate()` ritorna `FlagValue`; nuovo `isOn` (vecchia logica) + `resolveValue`; `explain()` aggiunge `value`. **Modify.**
- `src/flagValue.ts` — **new**: helper condivisi `normalizeFlagType`, `resolveActiveValue`, `resolveDefaultValue`, `validateTypedValues` (usati da storage, route, mcp). Unico punto di verità per la semantica dei tipi.
- `src/storage/sqlite.ts` — colonne nuove + migrazione idempotente + serializzazione. **Modify.**
- `src/storage/json.ts` — normalizzazione `type` in lettura + persistenza nuovi campi. **Modify.**
- `src/routes/adminFlags.ts` — accetta/valida `type`/`value`/`defaultValue`; PATCH rifiuta cambio type. **Modify.**
- `src/routes/evaluate.ts` — risposta con `value` + `enabled` legacy; `results` diventano `FlagValue`. **Modify.**
- `src/mcp/tools.ts` — `set_flag`/`evaluate_flag` con `type`/`value`/`defaultValue`/`value` in output. **Modify.**
- `ui/src/api/flags.ts` — tipi TS aggiornati. **Modify.**
- `ui/src/pages/FlagsPage.tsx` — selettore type, input value/defaultValue, preview tipizzata, lista. **Modify.**
- Test: `src/test/evaluator.test.ts`, `src/test/storage-sqlite.test.ts`, `src/test/storage-json.test.ts`, `src/test/routes-adminFlags.test.ts`, `src/test/routes-evaluate.test.ts`, `src/test/mcp-tools.test.ts`, e nuovo `src/test/flagValue.test.ts`. **Modify/new.**

---

### Task 1: Modello dati e helper di semantica dei tipi

**Files:**
- Modify: `src/types.ts`
- Create: `src/flagValue.ts`
- Test: `src/test/flagValue.test.ts` (new)

**Interfaces:**
- Consumes: niente (task base).
- Produces:
  - `type FlagType = 'boolean' | 'number' | 'string'`
  - `type FlagValue = boolean | number | string`
  - `Flag` con campi opzionali `type?: FlagType`, `value?: FlagValue`, `defaultValue?: FlagValue`
  - `normalizeFlagType(type: unknown): FlagType` — ritorna `'boolean'` se assente/non valido.
  - `resolveActiveValue(flag: Pick<Flag,'type'|'value'>): FlagValue` — boolean→`true`, altrimenti `flag.value!`.
  - `resolveDefaultValue(flag: Pick<Flag,'type'|'defaultValue'>): FlagValue` — boolean→`false`, altrimenti `flag.defaultValue!`.
  - `validateTypedValues(type: FlagType, value: unknown, defaultValue: unknown): { ok: true } | { ok: false; error: string }` — per number/string entrambi obbligatori e del tipo giusto; per boolean ok sempre.

- [ ] **Step 1: Aggiorna `src/types.ts`**

Aggiungi in cima al file i due type e modifica l'interfaccia `Flag`:

```ts
export type FlagType = 'boolean' | 'number' | 'string';
export type FlagValue = boolean | number | string;

export interface Flag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  type?: FlagType;          // default 'boolean' quando assente
  value?: FlagValue;        // servito quando "on" (non usato per boolean)
  defaultValue?: FlagValue; // servito quando "off"/no-match (non usato per boolean)
  environment: string;
  targeting?: Targeting;
  rollout?: Rollout;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Scrivi il test che fallisce** in `src/test/flagValue.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normalizeFlagType, resolveActiveValue, resolveDefaultValue, validateTypedValues } from '../flagValue';

describe('flagValue helpers', () => {
  it('normalizeFlagType defaults to boolean', () => {
    expect(normalizeFlagType(undefined)).toBe('boolean');
    expect(normalizeFlagType('nonsense')).toBe('boolean');
    expect(normalizeFlagType('number')).toBe('number');
    expect(normalizeFlagType('string')).toBe('string');
  });

  it('resolveActiveValue returns true for boolean, value otherwise', () => {
    expect(resolveActiveValue({ type: 'boolean' })).toBe(true);
    expect(resolveActiveValue({ type: undefined })).toBe(true);
    expect(resolveActiveValue({ type: 'number', value: 42 })).toBe(42);
    expect(resolveActiveValue({ type: 'string', value: 'hi' })).toBe('hi');
  });

  it('resolveDefaultValue returns false for boolean, defaultValue otherwise', () => {
    expect(resolveDefaultValue({ type: 'boolean' })).toBe(false);
    expect(resolveDefaultValue({ type: 'number', defaultValue: 0 })).toBe(0);
    expect(resolveDefaultValue({ type: 'string', defaultValue: 'off' })).toBe('off');
  });

  it('validateTypedValues requires matching types for number/string', () => {
    expect(validateTypedValues('boolean', undefined, undefined).ok).toBe(true);
    expect(validateTypedValues('number', 1, 0).ok).toBe(true);
    expect(validateTypedValues('number', 1, undefined).ok).toBe(false);
    expect(validateTypedValues('number', 'x', 0).ok).toBe(false);
    expect(validateTypedValues('string', 'a', 'b').ok).toBe(true);
    expect(validateTypedValues('string', 'a', 5).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisce**

Run: `yarn test src/test/flagValue.test.ts`
Expected: FAIL (modulo `../flagValue` non trovato).

- [ ] **Step 4: Implementa `src/flagValue.ts`**

```ts
import { Flag, FlagType, FlagValue } from './types';

export function normalizeFlagType(type: unknown): FlagType {
  return type === 'number' || type === 'string' ? type : 'boolean';
}

export function resolveActiveValue(flag: Pick<Flag, 'type' | 'value'>): FlagValue {
  if (normalizeFlagType(flag.type) === 'boolean') return true;
  return flag.value as FlagValue;
}

export function resolveDefaultValue(flag: Pick<Flag, 'type' | 'defaultValue'>): FlagValue {
  if (normalizeFlagType(flag.type) === 'boolean') return false;
  return flag.defaultValue as FlagValue;
}

export function validateTypedValues(
  type: FlagType,
  value: unknown,
  defaultValue: unknown,
): { ok: true } | { ok: false; error: string } {
  if (type === 'boolean') return { ok: true };
  const jsType = type === 'number' ? 'number' : 'string';
  if (typeof value !== jsType) {
    return { ok: false, error: `value must be a ${jsType} for a ${type} flag` };
  }
  if (typeof defaultValue !== jsType) {
    return { ok: false, error: `defaultValue must be a ${jsType} for a ${type} flag` };
  }
  return { ok: true };
}
```

- [ ] **Step 5: Esegui il test e verifica che passa**

Run: `yarn test src/test/flagValue.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: aggiungi modello tipizzato flag e helper di semantica"
```

---

### Task 2: Evaluator tipizzato

**Files:**
- Modify: `src/evaluator.ts`
- Test: `src/test/evaluator.test.ts`

**Interfaces:**
- Consumes: `resolveActiveValue`, `resolveDefaultValue` da `src/flagValue.ts`; `FlagValue` da `src/types.ts`.
- Produces:
  - `FlagEvaluator.evaluate(flag, context): FlagValue`
  - `FlagEvaluator.explain(flag, context): { enabled: boolean; value: FlagValue; reason: string }`
  - `FlagEvaluator.isOn(flag, context): boolean` (privato — ex `evaluate`).

- [ ] **Step 1: Aggiungi i test che falliscono** in `src/test/evaluator.test.ts`

Aggiorna prima l'helper `createFlag` (in cima al describe) così i test tipizzati possono passare i campi. Aggiungi in fondo al file, dentro `describe('FlagEvaluator', ...)`:

```ts
  describe('Typed flags', () => {
    it('boolean flag keeps returning booleans', () => {
      expect(evaluator.evaluate(createFlag({ type: 'boolean', enabled: true }), {})).toBe(true);
      expect(evaluator.evaluate(createFlag({ type: 'boolean', enabled: false }), {})).toBe(false);
    });

    it('number flag returns value when on, defaultValue when off', () => {
      const on = createFlag({ type: 'number', value: 42, defaultValue: 7, enabled: true });
      const off = createFlag({ type: 'number', value: 42, defaultValue: 7, enabled: false });
      expect(evaluator.evaluate(on, {})).toBe(42);
      expect(evaluator.evaluate(off, {})).toBe(7);
    });

    it('string flag returns defaultValue on targeting miss', () => {
      const flag = createFlag({
        type: 'string', value: 'blue', defaultValue: 'gray', enabled: true,
        targeting: { userIds: ['vip'] },
      });
      expect(evaluator.evaluate(flag, { userId: 'someone-else' })).toBe('gray');
      expect(evaluator.evaluate(flag, { userId: 'vip' })).toBe('blue');
    });

    it('explain exposes the resolved value', () => {
      const flag = createFlag({ type: 'number', value: 99, defaultValue: 0, enabled: false });
      const res = evaluator.explain(flag, {});
      expect(res.enabled).toBe(false);
      expect(res.value).toBe(0);
      expect(res.reason).toBe('disabled');
    });
  });
```

- [ ] **Step 2: Esegui i test e verifica che falliscono**

Run: `yarn test src/test/evaluator.test.ts`
Expected: FAIL (evaluate ritorna boolean, `explain` non ha `value`).

- [ ] **Step 3: Riscrivi `src/evaluator.ts`**

```ts
import { Flag, FlagEvaluationContext, FlagValue } from './types';
import { resolveActiveValue, resolveDefaultValue } from './flagValue';

export class FlagEvaluator {
  evaluate(flag: Flag, context: FlagEvaluationContext): FlagValue {
    return this.isOn(flag, context)
      ? resolveActiveValue(flag)
      : resolveDefaultValue(flag);
  }

  explain(flag: Flag, context: FlagEvaluationContext): { enabled: boolean; value: FlagValue; reason: string } {
    if (!flag.enabled) {
      return { enabled: false, value: resolveDefaultValue(flag), reason: 'disabled' };
    }
    if (flag.targeting && !this.matchesTargeting(flag.targeting, context)) {
      return { enabled: false, value: resolveDefaultValue(flag), reason: 'targeting-miss' };
    }
    if (flag.rollout && !this.matchesRollout(flag.rollout.percentage, context)) {
      return { enabled: false, value: resolveDefaultValue(flag), reason: 'rollout-excluded' };
    }
    return { enabled: true, value: resolveActiveValue(flag), reason: 'enabled' };
  }

  private isOn(flag: Flag, context: FlagEvaluationContext): boolean {
    if (!flag.enabled) return false;
    if (flag.targeting && !this.matchesTargeting(flag.targeting, context)) return false;
    if (flag.rollout) return this.matchesRollout(flag.rollout.percentage, context);
    return true;
  }

  private matchesTargeting(targeting: NonNullable<Flag['targeting']>, context: FlagEvaluationContext): boolean {
    if (targeting.userIds && context.userId) {
      if (targeting.userIds.includes(context.userId)) return true;
    }
    if (targeting.attributes && context.attributes) {
      for (const [key, values] of Object.entries(targeting.attributes)) {
        if (context.attributes[key] && values.includes(context.attributes[key])) return true;
      }
    }
    return false;
  }

  private matchesRollout(percentage: number, context: FlagEvaluationContext): boolean {
    if (!context.userId) return false;
    const hash = this.hashString(context.userId);
    return (hash % 100) < percentage;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
```

Nota: la vecchia `explain` ritornava `false` con reason `targeting-miss` anche quando `matchesTargeting` falliva ma non c'era rollout. Il nuovo `explain` preserva esattamente lo stesso ordine e le stesse reason.

- [ ] **Step 4: Esegui l'intera suite evaluator e verifica che passa**

Run: `yarn test src/test/evaluator.test.ts`
Expected: PASS (test vecchi + nuovi).

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: evaluator ritorna valore tipizzato con resolveValue"
```

---

### Task 3: Storage SQLite — colonne, migrazione, serializzazione

**Files:**
- Modify: `src/storage/sqlite.ts`
- Test: `src/test/storage-sqlite.test.ts`

**Interfaces:**
- Consumes: `normalizeFlagType` da `src/flagValue.ts`; `FlagValue`/`FlagType` da types.
- Produces: `createFlag`/`updateFlag`/`rowToFlag` che persistono e leggono `type`/`value`/`defaultValue`. Migrazione idempotente in `initialize()`.

- [ ] **Step 1: Scrivi i test che falliscono** in `src/test/storage-sqlite.test.ts`

Aggiungi un nuovo `describe` in fondo (dentro il describe principale). Segui il pattern di setup già presente nel file per creare lo storage temporaneo (riusa l'helper/`beforeEach` esistente; `storage` e `projectId` sono già disponibili nei test del file).

```ts
  describe('Typed flags', () => {
    it('persists and reads a number flag round-trip', async () => {
      const project = await storage.createProject({ name: 'typed-proj' });
      await storage.createFlag({
        projectId: project.id, key: 'max-items', name: 'Max Items',
        enabled: true, environment: 'production',
        type: 'number', value: 25, defaultValue: 10,
      });
      const flag = await storage.getFlag(project.id, 'max-items', 'production');
      expect(flag?.type).toBe('number');
      expect(flag?.value).toBe(25);
      expect(flag?.defaultValue).toBe(10);
    });

    it('preserves string vs number distinction', async () => {
      const project = await storage.createProject({ name: 'typed-proj-2' });
      await storage.createFlag({
        projectId: project.id, key: 'label', name: 'Label',
        enabled: true, environment: 'production',
        type: 'string', value: '25', defaultValue: 'x',
      });
      const flag = await storage.getFlag(project.id, 'label', 'production');
      expect(flag?.type).toBe('string');
      expect(flag?.value).toBe('25');
      expect(typeof flag?.value).toBe('string');
    });

    it('defaults legacy flags (no type) to boolean', async () => {
      const project = await storage.createProject({ name: 'legacy-proj' });
      await storage.createFlag({
        projectId: project.id, key: 'old-flag', name: 'Old',
        enabled: true, environment: 'production',
      });
      const flag = await storage.getFlag(project.id, 'old-flag', 'production');
      expect(flag?.type).toBe('boolean');
    });
  });
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `yarn test src/test/storage-sqlite.test.ts`
Expected: FAIL (`type`/`value` undefined, colonne assenti).

- [ ] **Step 3: Aggiungi le colonne alla `CREATE TABLE flags`** in `initialize()`

Dentro il blocco `CREATE TABLE IF NOT EXISTS flags (...)`, aggiungi dopo `enabled INTEGER NOT NULL DEFAULT 0,`:

```sql
        type TEXT NOT NULL DEFAULT 'boolean',
        value TEXT,
        default_value TEXT,
```

- [ ] **Step 4: Aggiungi la migrazione idempotente** subito dopo `this.db.exec(\`...\`)` in `initialize()`

```ts
    // Migrazione idempotente: aggiunge le colonne dei flag tipizzati se mancano.
    for (const stmt of [
      "ALTER TABLE flags ADD COLUMN type TEXT NOT NULL DEFAULT 'boolean'",
      'ALTER TABLE flags ADD COLUMN value TEXT',
      'ALTER TABLE flags ADD COLUMN default_value TEXT',
    ]) {
      try {
        this.db.exec(stmt);
      } catch {
        // colonna già presente: no-op
      }
    }
```

- [ ] **Step 5: Aggiorna `createFlag`** (import + INSERT + oggetto ritornato)

In cima al file aggiungi l'import:

```ts
import { normalizeFlagType } from '../flagValue.js';
```

Sostituisci l'INSERT e il loop con la versione che include i nuovi campi:

```ts
    const type = normalizeFlagType(flag.type);
    const valueJson = flag.value !== undefined ? JSON.stringify(flag.value) : null;
    const defaultValueJson = flag.defaultValue !== undefined ? JSON.stringify(flag.defaultValue) : null;

    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO flags (id, project_id, key, name, description, enabled, type, value, default_value, environment, targeting, rollout, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const created: Flag[] = [];
    for (const envName of envNames) {
      const id = nanoid();
      insert.run(id, projectId, flag.key, flag.name, flag.description || null, flag.enabled ? 1 : 0,
        type, valueJson, defaultValueJson, envName,
        flag.targeting ? JSON.stringify(flag.targeting) : null, flag.rollout ? JSON.stringify(flag.rollout) : null, now, now);
      created.push({ id, projectId: flag.projectId, key: flag.key, name: flag.name, description: flag.description,
        enabled: flag.enabled, type, value: flag.value, defaultValue: flag.defaultValue, environment: envName,
        targeting: flag.targeting, rollout: flag.rollout, createdAt: now, updatedAt: now });
    }
    return created;
```

- [ ] **Step 6: Aggiorna `updateFlag`** per gestire `value`/`defaultValue` (il `type` non si aggiorna)

Dopo il blocco `if (updates.rollout !== undefined) {...}` aggiungi:

```ts
    if (updates.value !== undefined) { fields.push('value = ?'); values.push(updates.value === null ? null : JSON.stringify(updates.value)); }
    if (updates.defaultValue !== undefined) { fields.push('default_value = ?'); values.push(updates.defaultValue === null ? null : JSON.stringify(updates.defaultValue)); }
```

- [ ] **Step 7: Aggiorna `rowToFlag`**

```ts
  private rowToFlag(row: any): Flag {
    return {
      id: row.id, projectId: row.project_id, key: row.key, name: row.name, description: row.description,
      enabled: row.enabled === 1, type: normalizeFlagType(row.type), environment: row.environment,
      value: row.value != null ? JSON.parse(row.value) : undefined,
      defaultValue: row.default_value != null ? JSON.parse(row.default_value) : undefined,
      targeting: row.targeting ? JSON.parse(row.targeting) : undefined,
      rollout: row.rollout ? JSON.parse(row.rollout) : undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
```

- [ ] **Step 8: Aggiorna il backfill inter-environment** in `createEnvironment`

Nella query che legge gli `existingFlags` aggiungi `type, value, default_value`:

```ts
    const existingFlags = this.db.prepare(
      'SELECT key, name, description, type, value, default_value, targeting, rollout FROM flags WHERE project_id = ? AND environment != ? GROUP BY key'
    ).all(env.projectId, env.name) as any[];
```

E nell'INSERT del backfill aggiungi le tre colonne/valori:

```ts
      this.db.prepare(
        'INSERT OR IGNORE INTO flags (id, project_id, key, name, description, enabled, type, value, default_value, environment, targeting, rollout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(flagId, env.projectId, flag.key, flag.name, flag.description ?? null, 0,
        flag.type ?? 'boolean', flag.value ?? null, flag.default_value ?? null,
        env.name, flag.targeting ?? null, flag.rollout ?? null, now, now);
```

- [ ] **Step 9: Esegui i test sqlite e verifica che passano**

Run: `yarn test src/test/storage-sqlite.test.ts`
Expected: PASS (vecchi + nuovi).

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat: persisti flag tipizzati su storage sqlite con migrazione"
```

---

### Task 4: Storage JSON — normalizzazione e persistenza

**Files:**
- Modify: `src/storage/json.ts`
- Test: `src/test/storage-json.test.ts`

**Interfaces:**
- Consumes: `normalizeFlagType` da `src/flagValue.ts`.
- Produces: `createFlag`/`getFlag`/`getAllFlags`/`updateFlag` che gestiscono `type`/`value`/`defaultValue`; flag letti senza `type` normalizzati a `'boolean'`.

- [ ] **Step 1: Scrivi i test che falliscono** in `src/test/storage-json.test.ts`

Segui il pattern di setup già presente nel file (storage JSON temporaneo). Aggiungi in fondo:

```ts
  describe('Typed flags', () => {
    it('round-trips a number flag', async () => {
      const project = await storage.createProject({ name: 'typed' });
      await storage.createFlag({
        projectId: project.id, key: 'limit', name: 'Limit',
        enabled: true, environment: 'production', type: 'number', value: 3, defaultValue: 1,
      });
      const flag = await storage.getFlag(project.id, 'limit', 'production');
      expect(flag?.type).toBe('number');
      expect(flag?.value).toBe(3);
      expect(flag?.defaultValue).toBe(1);
    });

    it('normalizes a flag without type to boolean on read', async () => {
      const project = await storage.createProject({ name: 'legacy' });
      await storage.createFlag({
        projectId: project.id, key: 'plain', name: 'Plain',
        enabled: true, environment: 'production',
      });
      const flag = await storage.getFlag(project.id, 'plain', 'production');
      expect(flag?.type).toBe('boolean');
    });
  });
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `yarn test src/test/storage-json.test.ts`
Expected: FAIL (`type` undefined).

- [ ] **Step 3: Import + normalizzazione in lettura**

In cima al file:

```ts
import { normalizeFlagType } from '../flagValue.js';
```

Aggiungi un helper privato nella classe e usalo in `getFlag`/`getAllFlags`:

```ts
  private normalizeFlag(flag: Flag): Flag {
    return { ...flag, type: normalizeFlagType(flag.type) };
  }
```

`getFlag`:

```ts
  async getFlag(projectId: string, key: string, environment: string): Promise<Flag | null> {
    const flag = this.data.flags.find(f => f.projectId === projectId && f.key === key && f.environment === environment);
    return flag ? this.normalizeFlag(flag) : null;
  }
```

`getAllFlags`:

```ts
  async getAllFlags(projectId: string, environment?: string): Promise<Flag[]> {
    return this.data.flags
      .filter(f => f.projectId === projectId && (!environment || f.environment === environment))
      .map(f => this.normalizeFlag(f));
  }
```

- [ ] **Step 4: Persisti i campi in `createFlag`**

Nel corpo del `for (const envName ...)`, aggiorna la costruzione di `newFlag`:

```ts
      const newFlag: Flag = { id: nanoid(), projectId: flag.projectId, key: flag.key, name: flag.name,
        description: flag.description, enabled: flag.enabled, type: normalizeFlagType(flag.type),
        value: flag.value, defaultValue: flag.defaultValue, environment: envName,
        targeting: flag.targeting, rollout: flag.rollout, createdAt: now, updatedAt: now };
```

Nota: `updateFlag` in JSON fa già spread di `updates` filtrando gli `undefined`, quindi `value`/`defaultValue` vengono gestiti senza modifiche. Il backfill in `createEnvironment` copia già `flag.targeting`/`flag.rollout`; aggiungi anche i nuovi campi al push del backfill:

```ts
        this.data.flags.push({ id: nanoid(), projectId: env.projectId, key: flag.key, name: flag.name,
          description: flag.description, enabled: false, type: normalizeFlagType(flag.type),
          value: flag.value, defaultValue: flag.defaultValue, environment: env.name,
          targeting: flag.targeting, rollout: flag.rollout, createdAt: now, updatedAt: now });
```

- [ ] **Step 5: Esegui i test json e verifica che passano**

Run: `yarn test src/test/storage-json.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: gestisci flag tipizzati su storage json"
```

---

### Task 5: API REST admin flags — validazione e type immutabile

**Files:**
- Modify: `src/routes/adminFlags.ts`
- Test: `src/test/routes-adminFlags.test.ts`

**Interfaces:**
- Consumes: `normalizeFlagType`, `validateTypedValues` da `src/flagValue.ts`.
- Produces: `POST /admin/flags` accetta `type`/`value`/`defaultValue` con validazione; `PATCH /admin/flags/:key` rifiuta cambio `type` con 400 e valida `value`/`defaultValue` contro il tipo esistente.

- [ ] **Step 1: Scrivi i test che falliscono** in `src/test/routes-adminFlags.test.ts`

Segui il pattern del file (app express + agent già configurati; riusa gli helper esistenti per creare progetto/environment). Aggiungi:

```ts
  it('creates a number flag with value and defaultValue', async () => {
    // ... crea progetto + environment come negli altri test del file ...
    const res = await request(app)
      .post('/admin/flags')
      .set(authHeader)
      .send({ projectId, environment: 'production', key: 'limit', name: 'Limit',
        type: 'number', value: 5, defaultValue: 1 });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('number');
    expect(res.body.value).toBe(5);
    expect(res.body.defaultValue).toBe(1);
  });

  it('rejects a number flag missing defaultValue', async () => {
    const res = await request(app)
      .post('/admin/flags')
      .set(authHeader)
      .send({ projectId, environment: 'production', key: 'bad', name: 'Bad',
        type: 'number', value: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects changing type via PATCH', async () => {
    await request(app).post('/admin/flags').set(authHeader)
      .send({ projectId, environment: 'production', key: 'switch', name: 'Switch' });
    const res = await request(app)
      .patch(`/admin/flags/switch?projectId=${projectId}&environment=production`)
      .set(authHeader)
      .send({ type: 'number' });
    expect(res.status).toBe(400);
  });
```

(Adatta `authHeader`/`projectId`/creazione environment ai nomi realmente usati nel file — sono già definiti negli altri test.)

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `yarn test src/test/routes-adminFlags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Aggiorna il `POST` handler**

In cima al file:

```ts
import { normalizeFlagType, validateTypedValues } from '../flagValue.js';
```

Sostituisci il destructuring e la creazione:

```ts
      const { key, name, description, targeting, rollout, projectId, environment, type, value, defaultValue } = req.body as {
        key: string; name: string; description?: string;
        targeting?: Flag['targeting']; rollout?: Flag['rollout'];
        projectId: string; environment: string;
        type?: string; value?: unknown; defaultValue?: unknown;
      };
      if (!key || !name || !projectId || !environment) {
        res.status(400).json({ error: 'key, name, projectId and environment are required' });
        return;
      }
      const flagType = normalizeFlagType(type);
      const validation = validateTypedValues(flagType, value, defaultValue);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }
      const flags = await storage.createFlag({
        projectId, key, name, description, enabled: false, environment,
        targeting, rollout, type: flagType,
        value: flagType === 'boolean' ? undefined : (value as Flag['value']),
        defaultValue: flagType === 'boolean' ? undefined : (defaultValue as Flag['defaultValue']),
      });
```

- [ ] **Step 4: Aggiorna il `PATCH` handler**

Dopo aver recuperato `flag` (il flag esistente), prima di costruire gli `updates`:

```ts
      if (req.body.type !== undefined && normalizeFlagType(req.body.type) !== normalizeFlagType(flag.type)) {
        res.status(400).json({ error: 'flag type is immutable' });
        return;
      }
```

Estendi gli `updates` con value/defaultValue, validando contro il tipo esistente quando cambiano:

```ts
      const updates: Partial<Pick<Flag, 'name' | 'description' | 'enabled' | 'targeting' | 'rollout' | 'value' | 'defaultValue'>> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.targeting !== undefined) updates.targeting = req.body.targeting;
      if (req.body.rollout !== undefined) updates.rollout = req.body.rollout;

      const flagType = normalizeFlagType(flag.type);
      if (flagType !== 'boolean' && (req.body.value !== undefined || req.body.defaultValue !== undefined)) {
        const nextValue = req.body.value !== undefined ? req.body.value : flag.value;
        const nextDefault = req.body.defaultValue !== undefined ? req.body.defaultValue : flag.defaultValue;
        const validation = validateTypedValues(flagType, nextValue, nextDefault);
        if (!validation.ok) {
          res.status(400).json({ error: validation.error });
          return;
        }
        if (req.body.value !== undefined) updates.value = req.body.value;
        if (req.body.defaultValue !== undefined) updates.defaultValue = req.body.defaultValue;
      }
```

- [ ] **Step 5: Esegui i test e verifica che passano**

Run: `yarn test src/test/routes-adminFlags.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: valida flag tipizzati nelle route admin e rendi type immutabile"
```

---

### Task 6: API REST evaluate — campo value + enabled legacy

**Files:**
- Modify: `src/routes/evaluate.ts`
- Test: `src/test/routes-evaluate.test.ts`

**Interfaces:**
- Consumes: `FlagEvaluator.evaluate` (ora `FlagValue`), `FlagEvaluator.explain`; `resolveActiveValue` da `src/flagValue.ts`; `FlagValue` da types.
- Produces: `/evaluate/:key` risponde `{ key, value, enabled, metadata }`; `/evaluate/all` e batch rispondono `Record<string, FlagValue>`.

- [ ] **Step 1: Scrivi i test che falliscono** in `src/test/routes-evaluate.test.ts`

Riusa gli helper del file (creazione flag + api key). Aggiungi:

```ts
  it('returns typed value and legacy enabled for a number flag', async () => {
    // crea un flag number enabled con value=42, defaultValue=0 (via storage/admin come negli altri test)
    const res = await request(app).post('/evaluate/limit').set(apiKeyHeader).send({ userId: 'u1' });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(42);
    expect(res.body.enabled).toBe(true); // gate on
  });

  it('all endpoint returns typed values', async () => {
    const res = await request(app).post('/evaluate/all').set(apiKeyHeader).send({ userId: 'u1' });
    expect(res.body.limit).toBe(42);
  });
```

(Adatta i nomi degli helper — `apiKeyHeader`, creazione flag — a quelli reali nel file.)

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `yarn test src/test/routes-evaluate.test.ts`
Expected: FAIL (`value` assente).

- [ ] **Step 3: Aggiorna i tre handler**

In cima al file:

```ts
import { FlagValue } from '../types';
import { resolveActiveValue } from '../flagValue';
```

`/all` — cambia il tipo dei results e usa `evaluate`:

```ts
      const results: Record<string, FlagValue> = {};
      for (const flag of flags) {
        results[flag.key] = evaluator.evaluate(flag, context);
      }
```

`/:key` — aggiungi `value` alla risposta con `enabled` legacy calcolato dal gate:

```ts
      const value = evaluator.evaluate(flag, context);
      const gateOn = value === resolveActiveValue(flag);
      res.json({
        key: flag.key,
        value,
        enabled: gateOn,
        metadata: {
          flagEnabled: flag.enabled,
          type: flag.type ?? 'boolean',
          hasTargeting: !!flag.targeting,
          hasRollout: !!flag.rollout,
        },
      });
```

Batch (`/`) — cambia i results a `FlagValue`:

```ts
      const results: Record<string, FlagValue> = {};
      // ... nel loop:
          if (flag) {
            results[key] = evaluator.evaluate(flag, evaluationContext);
          } else {
            results[key] = false;
          }
```

Nota su `gateOn`: per boolean `resolveActiveValue` è `true`, quindi `enabled` = `value === true`, identico a oggi. Per number/string `enabled` riflette "gate on". Edge case: se `value === defaultValue` per scelta dell'utente (stesso valore on/off), `enabled` risulterà `true` anche a gate off; è accettabile perché il valore servito è comunque corretto e i client tipizzati leggono `value`, non `enabled`.

- [ ] **Step 4: Esegui i test e verifica che passano**

Run: `yarn test src/test/routes-evaluate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: esponi value tipizzato nelle route di valutazione"
```

---

### Task 7: MCP tools

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `src/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `normalizeFlagType`, `validateTypedValues` da `src/flagValue.ts`.
- Produces: `set_flag` accetta `type`/`value`/`defaultValue`; `evaluate_flag` ritorna `value` oltre a `enabled`/`reason`.

- [ ] **Step 1: Scrivi i test che falliscono** in `src/test/mcp-tools.test.ts`

Riusa il setup del file (`buildTools(storage, evaluator)`, progetto+environment creati). Aggiungi:

```ts
  it('set_flag creates a number flag', async () => {
    // crea progetto + environment come negli altri test
    const setFlag = tools.find(t => t.name === 'set_flag')!;
    const res = await setFlag.handler({
      projectId, environment: 'production', key: 'limit', name: 'Limit',
      type: 'number', value: 9, defaultValue: 2, enabled: true,
    });
    expect(res.isError).toBeFalsy();
    const flag = await storage.getFlag(projectId, 'limit', 'production');
    expect(flag?.type).toBe('number');
    expect(flag?.value).toBe(9);
  });

  it('evaluate_flag returns the resolved value', async () => {
    const evalFlag = tools.find(t => t.name === 'evaluate_flag')!;
    const res = await evalFlag.handler({ projectId, environment: 'production', key: 'limit', userId: 'u1' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.value).toBe(9);
  });
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `yarn test src/test/mcp-tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Estendi `set_flag`**

In cima al file:

```ts
import { normalizeFlagType, validateTypedValues } from '../flagValue.js';
```

Aggiungi allo `inputSchema` di `set_flag`:

```ts
        type: z.enum(['boolean', 'number', 'string']).optional(),
        value: z.union([z.boolean(), z.number(), z.string()]).optional(),
        defaultValue: z.union([z.boolean(), z.number(), z.string()]).optional(),
```

Nel handler, nel ramo `if (!existing)` (creazione), calcola e valida il tipo prima di `createFlag`:

```ts
        const flagType = normalizeFlagType(args.type);
        const validation = validateTypedValues(flagType, args.value, args.defaultValue);
        if (!validation.ok) return fail(validation.error);
```

e passa a `createFlag` i campi `type`, `value` (undefined se boolean), `defaultValue` (undefined se boolean).

Nel ramo update (flag esistente): se `args.type` è presente e diverso dal tipo esistente → `return fail('flag type is immutable')`. Se il flag esistente non è boolean e arrivano `value`/`defaultValue`, valida col tipo esistente e aggiungi a `updates`.

- [ ] **Step 4: Estendi `evaluate_flag`**

Nel handler, sostituisci l'output:

```ts
        const { enabled, value, reason } = evaluator.explain(flag, context);
        return ok({ key: flag.key, environment: flag.environment, value, enabled, reason });
```

Aggiorna la `description` del tool per menzionare che ritorna anche `value`.

- [ ] **Step 5: Esegui i test e verifica che passano**

Run: `yarn test src/test/mcp-tools.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: supporta flag tipizzati nei tool mcp"
```

---

### Task 8: Verifica backend completa

**Files:** nessuna modifica; solo verifica.

- [ ] **Step 1: Esegui l'intera suite**

Run: `yarn test`
Expected: PASS — tutti i test (i 204 esistenti + i nuovi). Se qualcosa fallisce per via del cambio firma di `evaluate` (ora `FlagValue`) in punti non previsti, correggi il chiamante e ri-esegui.

- [ ] **Step 2: Build TypeScript**

Run: `yarn build`
Expected: nessun errore di tipo.

- [ ] **Step 3: Commit (se sono servite correzioni)**

```bash
git add .
git commit -m "test: allinea suite ai flag tipizzati"
```

Se non sono servite correzioni, salta il commit.

---

### Task 9: UI — tipi API

**Files:**
- Modify: `ui/src/api/flags.ts`

**Interfaces:**
- Produces: `FlagType`, `FlagValue`, campi su `Flag`/`CreateFlagPayload`/`UpdateFlagPayload`.

- [ ] **Step 1: Aggiorna `ui/src/api/flags.ts`**

```ts
export type FlagType = 'boolean' | 'number' | 'string';
export type FlagValue = boolean | number | string;

export interface Flag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  type: FlagType;
  value?: FlagValue;
  defaultValue?: FlagValue;
  environment: string;
  targeting?: { userIds?: string[]; attributes?: Record<string, string[]> };
  rollout?: { percentage: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlagPayload {
  key: string;
  name: string;
  description?: string;
  type?: FlagType;
  value?: FlagValue;
  defaultValue?: FlagValue;
  targeting?: Flag['targeting'];
  rollout?: Flag['rollout'];
}

export interface UpdateFlagPayload {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  value?: FlagValue;
  defaultValue?: FlagValue;
  targeting?: Flag['targeting'] | null;
  rollout?: Flag['rollout'] | null;
}
```

- [ ] **Step 2: Verifica il typecheck UI**

Run: `yarn --cwd ui build`
Expected: FAIL su `FlagsPage.tsx` (usa `Flag` ma non ancora i nuovi campi) — atteso, lo risolviamo nel Task 10. Se preferisci una verifica pulita, salta questo step e verifica dopo il Task 10.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: aggiungi tipi flag tipizzati al client ui"
```

---

### Task 10: UI — form, preview e lista

**Files:**
- Modify: `ui/src/pages/FlagsPage.tsx`

**Interfaces:**
- Consumes: `Flag`, `FlagType`, `FlagValue`, `CreateFlagPayload`, `UpdateFlagPayload` da `../api/flags`.
- Produces: form con selettore type + input value/defaultValue; preview e lista tipizzate.

- [ ] **Step 1: Estendi `FlagFormState`**

Aggiungi i campi:

```ts
interface FlagFormState {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  type: FlagType;
  value: string;         // input grezzo; convertito in base al type al submit
  defaultValue: string;  // input grezzo
  targetingUserIds: string[];
  targetingUserIdInput: string;
  targetingAttributes: { key: string; values: string }[];
  rolloutPercentage: string;
}
```

Importa `FlagType`, `FlagValue` da `../api/flags`.

- [ ] **Step 2: Aggiorna `emptyForm` e `flagToForm`**

`emptyForm`: aggiungi `type: 'boolean', value: '', defaultValue: ''`.

`flagToForm`: aggiungi
```ts
    type: flag.type,
    value: flag.value !== undefined ? String(flag.value) : '',
    defaultValue: flag.defaultValue !== undefined ? String(flag.defaultValue) : '',
```

- [ ] **Step 3: Aggiungi il parsing tipizzato e aggiorna `formToPayload`**

Aggiungi una helper sopra `formToPayload`:

```ts
function parseTypedValue(type: FlagType, raw: string): FlagValue | undefined {
  if (type === 'boolean') return undefined;
  if (type === 'number') {
    const n = Number(raw);
    return raw.trim() === '' || Number.isNaN(n) ? undefined : n;
  }
  return raw; // string: stringa grezza (anche vuota è valida)
}
```

In `formToPayload`, aggiungi al ritorno:
```ts
    type: form.type,
    value: parseTypedValue(form.type, form.value),
    defaultValue: parseTypedValue(form.type, form.defaultValue),
```

- [ ] **Step 4: Aggiorna `evaluateFlag` (preview) per ritornare `FlagValue`**

Cambia la firma e i return:

```ts
function evaluateFlag(form: FlagFormState, userId: string, attrs: { key: string; value: string }[]): FlagValue {
  const active = form.type === 'boolean' ? true : (parseTypedValue(form.type, form.value) ?? '');
  const fallback = form.type === 'boolean' ? false : (parseTypedValue(form.type, form.defaultValue) ?? '');

  if (!form.enabled) return fallback;

  const hasUserIds = form.targetingUserIds.length > 0;
  const hasAttrs = form.targetingAttributes.some(a => a.key.trim());
  const hasTargeting = hasUserIds || hasAttrs;

  if (hasTargeting) {
    let matched = false;
    if (hasUserIds && userId && form.targetingUserIds.includes(userId)) matched = true;
    if (!matched && hasAttrs) {
      const attrMap: Record<string, string> = {};
      for (const a of attrs) { if (a.key.trim()) attrMap[a.key.trim()] = a.value; }
      for (const ta of form.targetingAttributes) {
        if (!ta.key.trim()) continue;
        const vals = ta.values.split(',').map(s => s.trim()).filter(Boolean);
        if (attrMap[ta.key.trim()] && vals.includes(attrMap[ta.key.trim()])) { matched = true; break; }
      }
    }
    if (!matched && !form.rolloutPercentage) return fallback;
    if (!matched && form.rolloutPercentage) {
      if (!userId) return fallback;
      return (hashString(userId) % 100) < Number(form.rolloutPercentage) ? active : fallback;
    }
    if (matched) return active;
  }

  if (form.rolloutPercentage) {
    if (!userId) return fallback;
    return (hashString(userId) % 100) < Number(form.rolloutPercentage) ? active : fallback;
  }

  return active;
}
```

- [ ] **Step 5: Aggiungi il selettore Type nel form (drawer)**

Subito dopo il campo `key`, aggiungi (mostra il select solo in creazione; in modifica mostra il tipo come testo readonly):

```tsx
        <div style={fieldStyle}>
          <label style={labelStyle}>Type</label>
          {editingFlag ? (
            <input style={{ ...inputStyle, background: '#f9fafb' }} value={form.type} readOnly />
          ) : (
            <select
              style={inputStyle}
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as FlagType }))}
            >
              <option value="boolean">boolean</option>
              <option value="number">number</option>
              <option value="string">string</option>
            </select>
          )}
        </div>

        {form.type !== 'boolean' && (
          <>
            <div style={fieldStyle}>
              <label style={labelStyle}>Value (when on) *</label>
              <input
                style={inputStyle}
                type={form.type === 'number' ? 'number' : 'text'}
                value={form.value}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                placeholder={form.type === 'number' ? 'e.g. 42' : 'e.g. blue'}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Default value (when off) *</label>
              <input
                style={inputStyle}
                type={form.type === 'number' ? 'number' : 'text'}
                value={form.defaultValue}
                onChange={e => setForm(f => ({ ...f, defaultValue: e.target.value }))}
                placeholder={form.type === 'number' ? 'e.g. 0' : 'e.g. gray'}
              />
            </div>
          </>
        )}
```

- [ ] **Step 6: Aggiorna `handleSave`** per inviare i nuovi campi

Nel ramo `createFlag`, aggiungi al payload `type`, `value`, `defaultValue` da `payload`. Nel ramo `updateFlag` (modifica), aggiungi `value`/`defaultValue` solo se `form.type !== 'boolean'`:

```ts
        await createFlag(projectId, environment, {
          key: payload.key,
          name: payload.name,
          description: payload.description,
          type: payload.type,
          value: payload.value,
          defaultValue: payload.defaultValue,
          targeting: payload.targeting,
          rollout: payload.rollout,
        });
```

```ts
        const updates: UpdateFlagPayload = {
          name: payload.name,
          description: payload.description ?? null,
          enabled: form.enabled,
          targeting: payload.targeting ?? null,
          rollout: payload.rollout ?? null,
          ...(form.type !== 'boolean'
            ? { value: payload.value, defaultValue: payload.defaultValue }
            : {}),
        };
```

- [ ] **Step 7: Aggiorna la validazione del bottone Save**

Per number/string, Save deve essere disabilitato se value/defaultValue sono vuoti. Cambia la condizione `disabled`:

```ts
            disabled={
              saving || !form.key || !form.name ||
              (form.type !== 'boolean' && (form.value.trim() === '' || form.defaultValue.trim() === ''))
            }
```

(Applica la stessa condizione allo `style` `background`/`cursor`.)

- [ ] **Step 8: Aggiorna il badge risultato della preview**

Il risultato ora è `FlagValue`. Sostituisci il blocco che mostra `true`/`false`:

```tsx
              {(() => {
                const result = evaluateFlag(form, previewUserId, previewAttrs);
                const isTruthy = result !== false && result !== '' && result !== 0;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                    <span style={{ color: '#4b5563' }}>→ Result:</span>
                    <span style={{ color: isTruthy ? '#065f46' : '#991b1b', background: isTruthy ? '#d1fae5' : '#fee2e2', padding: '2px 10px', borderRadius: 999 }}>
                      {String(result)}
                    </span>
                  </div>
                );
              })()}
```

- [ ] **Step 9: Aggiorna la lista flag**

Nella riga di lista, aggiungi un badge col tipo e mostra il valore per i non-boolean. Dopo i badge `Targeting`/`Rollout` esistenti aggiungi:

```tsx
                  {flag.type !== 'boolean' && <Badge color="gray">{flag.type}</Badge>}
```

E per la parte destra: mantieni il `Toggle` per boolean, mostra il valore per number/string:

```tsx
              <div onClick={e => e.stopPropagation()}>
                {flag.type === 'boolean' ? (
                  <Toggle checked={flag.enabled} onChange={() => void handleToggleEnabled(flag)} />
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 600, color: flag.enabled ? '#065f46' : '#6b7280' }}>
                    {String(flag.enabled ? flag.value : flag.defaultValue)}
                  </span>
                )}
              </div>
```

Verifica che `Badge` supporti `color="gray"`; se non lo supporta, usa un colore già esistente (es. `"blue"`) — controlla `ui/src/components/Badge.tsx`.

- [ ] **Step 10: Build UI**

Run: `yarn --cwd ui build`
Expected: PASS (nessun errore TS).

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: selettore tipo e valori tipizzati nella ui dei flag"
```

---

### Task 11: Documentazione (README) e verifica finale

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Aggiorna la sezione Features del README**

Nel blocco `## Features`, aggiorna la voce dei flag per menzionare i tipi. Esempio, sostituisci/aggiungi una riga:

```markdown
- **Typed Flags**: boolean, number or string flags with an active value and a default (off) value
```

Se esiste una sezione che documenta il payload di creazione flag o la risposta di `/evaluate`, aggiungi una nota che la risposta include ora il campo `value` e che il body di creazione accetta `type`/`value`/`defaultValue`.

- [ ] **Step 2: Verifica finale completa**

Run: `yarn test && yarn build && yarn --cwd ui build`
Expected: tutto PASS.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "docs: documenta i flag tipizzati nel readme"
```

---

## Note finali

- Non pushare né aprire la PR senza conferma esplicita dell'utente (regola di progetto).
- La PR va aperta verso `develop` con squash merge; il titolo sarà un conventional commit `feat: ...` (triggera il bump minor in CI).
