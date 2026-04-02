# Web UI — Design Spec

**Data:** 2026-04-02  
**Progetto:** RollerFlags  
**Scope:** Interfaccia web per la gestione di feature flag e API key

---

## Contesto

RollerFlags è una piattaforma di feature flagging on-prem open source. Chiunque può scaricarlo e hostarlo. La Web UI è uno strumento di gestione interno — non richiede autenticazione propria (è onere di chi hosta proteggere l'accesso, es. con basic auth o IP restriction a livello infrastrutturale).

---

## Architettura

### Stack

- **Frontend:** React + TypeScript, bundlato con Vite
- **Backend:** Express esistente, invariato nella struttura
- **Integrazione:** il build `ui/dist/` viene servito da Express come static files sulla root `/`

### Struttura cartelle

```
ui/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/              ← fetch wrapper per ogni gruppo di endpoint
│   │   ├── flags.ts
│   │   └── apiKeys.ts
│   ├── components/       ← componenti riusabili
│   │   ├── Drawer.tsx
│   │   ├── Toggle.tsx
│   │   ├── Badge.tsx
│   │   └── Toast.tsx
│   └── pages/
│       ├── FlagsPage.tsx
│       └── ApiKeysPage.tsx
├── index.html
├── package.json
└── vite.config.ts
```

### Dev vs produzione

- **Development:** Vite gira su porta 5173, proxya `/api/*` e `/admin/*` verso Express (porta 6789)
- **Produzione:** un unico processo Node; Express serve `ui/dist/` come static + catch-all su `index.html`

### Modifiche al backend

1. `src/index.ts` — aggiungere `express.static('ui/dist')` e catch-all `index.html` per il routing SPA
2. `src/routes/admin.ts` — filtrare `__ui_admin__` dalla `GET /admin/api-keys`
3. `src/routes/admin.ts` — aggiungere `GET /admin/ui-token` (non autenticato): restituisce la key `__ui_admin__` per uso esclusivo della UI
4. `src/index.ts` — logica di bootstrap: al primo avvio, se non esiste una API key con name `__ui_admin__`, crearne una automaticamente e salvarla nello storage

---

## Autenticazione della UI verso il backend

La UI usa una API key admin interna generata automaticamente al primo avvio del server:

- Name: `__ui_admin__`
- Environment: `__admin__`
- Generata con lo stesso meccanismo delle API key normali (`rf_` + nanoid)
- Salvata nello storage come le altre API key
- **Esclusa** da `GET /admin/api-keys` — non compare mai nella UI né nelle risposte API
- La UI la recupera tramite un endpoint dedicato: `GET /admin/ui-token` (non autenticato, restituisce solo questa key)

---

## Layout generale

- **Sidebar fissa** a sinistra con: logo/nome, voci di navigazione (Feature Flags, API Keys), environment selector in fondo
- **Area contenuto** a destra che cambia in base alla voce selezionata
- **Environment selector:** dropdown che cambia l'environment attivo per tutta la UI; il valore viene passato come contesto a tutte le chiamate ai flag

---

## Pagine

### FlagsPage

Lista tutti i flag dell'environment selezionato, ordinati per data di creazione (più recenti prima).

Ogni riga mostra:
- `key` del flag
- `name`
- Toggle on/off per `enabled` (aggiornamento immediato via PATCH)
- Badge "Targeting" se il flag ha regole di targeting
- Badge "Rollout X%" se il flag ha rollout configurato

Azioni:
- Pulsante **"New Flag"** in alto a destra — apre il drawer in modalità creazione
- Click su una riga — apre il drawer in modalità modifica

### Drawer flag (creazione / modifica)

Pannello laterale che si apre sull'area contenuto. Campi:

| Campo | Note |
|---|---|
| `key` | Readonly in modalità modifica; editabile solo in creazione |
| `name` | Testo libero |
| `description` | Testo libero, opzionale |
| `enabled` | Toggle |
| Targeting — User IDs | Input tag-style: inserisci uno user ID e premi Enter per aggiungerlo; click sulla tag per rimuoverlo |
| Targeting — Attributi | Lista di coppie key → values (values comma-separated); pulsante per aggiungere/rimuovere coppie |
| Rollout percentage | Input numerico 0–100, opzionale; se vuoto il rollout non è configurato |

Azioni nel drawer:
- **Salva** — crea (POST) o aggiorna (PATCH) il flag
- **Elimina** (solo in modifica) — mostra conferma inline prima di procedere con DELETE
- **X / Annulla** — chiude il drawer senza salvare

### ApiKeysPage

Lista tutte le API key (esclusa `__ui_admin__`), ordinate per data di creazione.

Ogni riga mostra:
- `name`
- `environment`
- `key` mascherata (`rf_••••••••`) con pulsante copia-negli-appunti
- Data di creazione

Azioni:
- Pulsante **"New API Key"** — apre un modal con due campi: `name` e `environment` (input libero)
- Pulsante **Elimina** su ogni riga — con conferma inline

---

## Feedback e stati UI

- **Toast notifications:** appaiono in alto a destra, durata 3 secondi. Usati per: salvataggio riuscito, errore di rete, copia negli appunti
- **Spinner inline** nelle liste durante il caricamento
- **Stato vuoto** nelle liste quando non ci sono elementi (con CTA per crearne uno)
- **Errore di connessione** — messaggio nella pagina se il server non è raggiungibile

---

## Testing

Nessun test frontend in questa fase. La codebase backend mantiene la sua coverage esistente. I test per la UI (Vitest + Testing Library) possono essere aggiunti in un secondo momento.

---

## Build e sviluppo

`package.json` della root va aggiornato con script per:
- `yarn ui:dev` — avvia Vite in dev mode
- `yarn ui:build` — builda la UI in `ui/dist/`
- `yarn dev` — avvia sia Express che Vite in parallelo (con `concurrently`)
- `yarn build` — esegue `ui:build` + build TypeScript del backend

---

## Fuori scope

- Autenticazione/login nella UI
- Dark mode
- Internazionalizzazione
- Test frontend
- Audit log delle operazioni fatte tramite UI
