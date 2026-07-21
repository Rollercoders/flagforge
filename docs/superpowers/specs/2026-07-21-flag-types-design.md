# Tipizzazione dei flag (boolean / number / string)

**Data:** 2026-07-21
**Stato:** approvato

## Obiettivo

Oggi ogni flag è booleano: ha un campo `enabled` e l'evaluate restituisce
sempre `true`/`false`. Vogliamo che un flag possa avere un **tipo**:

- `boolean` (default, comportamento attuale)
- `number`
- `string`

Un flag numerico o stringa serve un **valore** quando è "attivo" e un
**valore di default** quando è "spento" o quando targeting/rollout non fanno
match.

## Principi di design

- **Zero breaking change.** I flag esistenti diventano `type='boolean'` senza
  migrazione dei dati. I client che leggono `enabled` continuano a funzionare.
- **Il gate resta invariato.** `enabled` + targeting + rollout decidono solo se
  il flag è *on* oppure *off*. Questa semantica è identica per tutti i tipi.
- **Il tipo determina cosa viene servito**, non come si valuta il gate.

## 1. Modello dati (`src/types.ts`)

```ts
export type FlagType = 'boolean' | 'number' | 'string';
export type FlagValue = boolean | number | string;

export interface Flag {
  // ... campi esistenti ...
  enabled: boolean;            // gate globale (invariato)
  type: FlagType;              // default 'boolean'
  value?: FlagValue;           // servito quando il flag è "on"
  defaultValue?: FlagValue;    // servito quando "off" / no-match
}
```

**Semantica per tipo:**

| type    | value                | defaultValue         | Note |
|---------|----------------------|----------------------|------|
| boolean | implicito `true`     | implicito `false`    | `value`/`defaultValue` restano `undefined` a DB → identico a oggi |
| number  | obbligatorio         | obbligatorio         | |
| string  | obbligatorio         | obbligatorio         | |

**Gate (invariato):** se on → si serve `value`; se off/no-match → si serve
`defaultValue`. Per boolean questo si traduce in `true`/`false`.

## 2. Evaluator (`src/evaluator.ts`)

`evaluate()` cambia firma da `boolean` a `FlagValue`. La logica del gate è
identica a oggi, spostata in un metodo privato `isOn` (di fatto la vecchia
`evaluate` rinominata).

```ts
evaluate(flag: Flag, context: FlagEvaluationContext): FlagValue {
  const on = this.isOn(flag, context);   // enabled + targeting + rollout
  return this.resolveValue(flag, on);
}

private resolveValue(flag: Flag, on: boolean): FlagValue {
  if (flag.type === 'boolean') return on;              // identico a oggi
  return on ? flag.value! : flag.defaultValue!;
}
```

`explain()` aggiunge il campo `value` accanto a `enabled`/`reason`.

Poiché `isOn` è la vecchia logica invariata, i test esistenti del gate
restano verdi.

## 3. Storage

### SQLite (`src/storage/sqlite.ts`)

Tre nuove colonne:

```sql
type TEXT NOT NULL DEFAULT 'boolean'
value TEXT               -- JSON-encoded per preservare il tipo
default_value TEXT       -- JSON-encoded
```

- Nuove installazioni: colonne nella `CREATE TABLE`.
- Installazioni esistenti: migrazione idempotente in `initialize()` con
  `ALTER TABLE flags ADD COLUMN ...` in try/catch (righe esistenti prendono il
  default `'boolean'`).
- `value`/`default_value` sono serializzati con `JSON.stringify` per
  distinguere `"5"` (string) da `5` (number).
- `createFlag`/`updateFlag` gestiscono i nuovi campi.
- Il backfill inter-environment (in `createEnvironment`) copia anche
  `type`/`value`/`default_value`.

### JSON (`src/storage/json.ts`)

- Nessuna migrazione di schema.
- I flag privi di `type` in lettura vengono normalizzati a `'boolean'`.
- `createFlag`/`updateFlag` persistono i nuovi campi.

## 4. API REST

### adminFlags (`src/routes/adminFlags.ts`)

- `POST` e `PATCH` accettano `type`, `value`, `defaultValue`.
- Validazione:
  - `value`/`defaultValue` coerenti col `type`.
  - Per `number`/`string`: entrambi obbligatori.
  - Per `boolean`: ignorati (valori impliciti).
- `type` è **immutabile** in `PATCH` (come `key`): se presente e diverso →
  400.

### evaluate (`src/routes/evaluate.ts`)

- La risposta di `/:key` aggiunge il campo `value` (il valore risolto).
- Retrocompat del campo `enabled`:
  - boolean: `enabled === value`.
  - number/string: `enabled` = "il gate è on" (cioè `value === valore-attivo`).
- `/all` e batch (`/`): i `results` diventano `Record<string, FlagValue>`.

## 5. MCP tools (`src/mcp/tools.ts`)

I tool di creazione/modifica/valutazione rispecchiano l'API REST:

- parametri `type`/`value`/`defaultValue` con stessa validazione;
- output di valutazione con campo `value`;
- schemi Zod/JSON allineati.

## 6. UI (`ui/src/pages/FlagsPage.tsx` + `ui/src/api/flags.ts`)

- **Selettore Type** (boolean/number/string) nel form, mostrato solo in
  creazione; immutabile in modifica (come il key).
- In base al tipo:
  - `boolean`: form identico a oggi (nessun campo value).
  - `number`/`string`: due input **Value** (on) e **Default value** (off) con
    validazione di tipo.
- **Preview "Test this flag"**: `evaluateFlag` ritorna `FlagValue`; il badge
  risultato mostra il valore risolto.
- **Lista flag**: badge col tipo; la riga boolean mantiene il Toggle,
  number/string mostrano il valore corrente al posto del toggle (il gate
  `enabled` si modifica dal drawer).

## 7. Testing

- **Evaluator**: test del gate esistenti restano verdi; nuovi test per
  `resolveValue` sui tre tipi (on/off, no-match → defaultValue).
- **Storage**: test di migrazione (flag pre-esistente → `type='boolean'`),
  round-trip di value/defaultValue tipizzati su sqlite e json.
- **API/MCP**: creazione con validazione tipo, PATCH che rifiuta il cambio di
  type, risposta evaluate con `value` + `enabled` legacy.
- Approccio TDD dove sensato (evaluator e validazione per primi).

## 8. Retrocompatibilità (riepilogo)

Nessun breaking change: flag esistenti → `type='boolean'`, `value`/
`defaultValue` `undefined`; campo `enabled` dell'API preservato; client
boolean invariati.
