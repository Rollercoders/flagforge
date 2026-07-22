# Chiavi API client/secret per environment (Fase 2)

**Data:** 2026-07-22
**Stato:** approvato

## Obiettivo

Riabilitare in modo sicuro la scrittura dei flag via API, che l'hotfix di
sicurezza precedente ha bloccato (le API key di environment davano accesso in
scrittura a `/api/flags` — escalation di privilegio). Introduciamo **due
chiavi per environment**:

- **client key** (`ff_...`): distribuita ai client/servizi per **valutare** i
  flag. Gira "nel mondo", non è un segreto forte. Sola lettura/valutazione.
- **secret key** (`ffs_...`): riservata ai backend fidati per **scrivere** i
  flag. Superset: fa tutto ciò che fa la client key + scrittura.

Consumatore reale: esiste già un tool che scriveva flag via API key e che
l'hotfix ha bloccato; con la secret key tornerà a funzionare.

## Principi di design

- **Zero breaking change per i client di lettura.** La chiave esistente resta
  la client key (stesso valore, stesso campo DB) → i client attuali non
  cambiano nulla.
- **Default sicuro.** La scrittura richiede la secret key, che è riservata. La
  client key distribuita resta innocua (403 sulle scritture).
- **Minimo cambiamento di modello.** Due chiavi fisse per environment (non una
  tabella di N chiavi con ruoli): il caso d'uso non richiede più di questo.

## 1. Modello dati (`src/types.ts`)

```ts
export interface Environment {
  id: string;
  projectId: string;
  name: string;
  key: string;        // "client key" — sola lettura/valutazione (invariata)
  secretKey: string;  // NUOVA: "secret key" — scrittura (superset)
  createdAt: string;
}
```

- Formati: client key `ff_...` (invariato), secret key `ffs_...` (il prefisso
  `ffs_` la rende riconoscibile in log/leak).
- Entrambe generate **alla creazione dell'environment**.
- Colonna DB: `key` invariata; nuova colonna `secret_key`.

## 2. Migrazione (retrocompat)

### SQLite (`src/storage/sqlite.ts`)

- Nuova colonna `secret_key TEXT` in `CREATE TABLE environments` (nuove
  installazioni) + `ALTER TABLE environments ADD COLUMN secret_key TEXT` in
  try/catch idempotente (installazioni esistenti).
- **Backfill al primo `initialize()`**: per ogni environment con `secret_key`
  vuota/NULL, genera una `ffs_...` e la persiste. Così anche gli environment
  pre-esistenti ottengono una secret key.

### JSON (`src/storage/json.ts`)

- In lettura, se un environment non ha `secretKey`, gliene viene generata e
  persistita una.

Le client key esistenti restano identiche → i client di lettura non si
accorgono di nulla.

## 3. Auth middleware (`src/middleware/auth.ts`)

- Nuova risoluzione del token che cerca sia tra le client key sia tra le secret
  key e ritorna il ruolo: `{ environment, role: 'client' | 'secret' }`.
  - Storage: nuovo metodo `getEnvironmentByAnyKey(token): Promise<{ environment: Environment; role: 'client' | 'secret' } | null>` (o estensione di `getEnvironmentByKey`). Cerca match esatto su `key` (→ client) o `secret_key` (→ secret).
- `req.apiKey` guadagna il campo `role: 'client' | 'secret'`.
- Token ignoto → 401 (invariato).

## 4. Guardia scrittura (`src/routes/flags.ts`)

La guardia `denyWrites` introdotta dall'hotfix diventa `requireSecret`:

- `POST`/`PATCH`/`DELETE` su `/api/flags` passano solo se
  `req.apiKey.role === 'secret'`; altrimenti **403** (messaggio aggiornato:
  richiede la secret key).
- `GET /api/flags` e `/api/evaluate` accettano entrambi i ruoli.

Gli handler reali di scrittura (lasciati inerti dall'hotfix) tornano
raggiungibili quando il ruolo è `secret`.

## 5. API di gestione chiavi

- `regenerateEnvironmentKey` diventa parametrico sul ruolo:
  `regenerateEnvironmentKey(envId, role: 'client' | 'secret')` (o due metodi
  `regenerateClientKey`/`regenerateSecretKey`). Rigenerare una chiave revoca la
  vecchia senza toccare l'altra.
- Le rotte che espongono l'environment (`GET /admin/projects/:id/environments`,
  ecc.) includono ora anche `secretKey`.

## 6. UI (`ui/src/pages/ProjectsPage.tsx`)

Nel pannello environment, accanto alla **Client key** (attuale: sempre
visibile + Copia):

- **Secret key** mascherata di default (`ffs_••••••••`), con pulsanti
  **Reveal** e **Copy**.
- Avviso: "Keep this secret — use it only in trusted backends, never in
  client-side code."
- Pulsante **Regenerate** dedicato (con conferma, come la client key).
- Label chiare: "Client key" (nota: "for evaluating flags in your apps") e
  "Secret key" (nota: "for writing flags from trusted backends").

## 7. Documentazione (`README.md`)

- Aggiorno "Flag Management" e la nota read-only dell'hotfix: la scrittura via
  API è ora possibile con la **secret key** (`ffs_...`); la client key
  (`ff_...`) resta di sola lettura/valutazione.
- Aggiungo un esempio `curl` di scrittura con la secret key e chiarisco quale
  chiave usare dove.

## 8. Testing

- **Storage**: migrazione (environment vecchio senza `secret_key` → ne ottiene
  una al `initialize()`); round-trip di entrambe le chiavi; rigenerazione
  indipendente (rigenerare una non tocca l'altra); sqlite + json.
- **Auth**: token client → `role: 'client'`; token secret → `role: 'secret'`;
  token ignoto → 401.
- **Rotte `/api/flags`**: scrittura con client key → 403; scrittura con secret
  key → 200/201/204; lettura con entrambe → 200. Aggiornare i test dell'hotfix
  (che oggi si aspettano 403 su ogni scrittura) per distinguere i due ruoli.
- **Rotte admin**: rigenerazione client/secret separate.
- Approccio TDD.

## 9. Retrocompatibilità (riepilogo)

- Client key esistenti invariate → client di lettura intatti.
- Secret key generata per tutti gli environment (nuovi + vecchi via
  migrazione).
- Default sicuro: la scrittura richiede la secret key riservata; la client key
  distribuita resta innocua.

## Fuori scope

- Modello a N chiavi con tabella dedicata / audit / scadenza: non necessario
  per il caso d'uso attuale. Se servirà, sarà una feature successiva.
- `flagforge update`: feature indipendente, spec separata.
