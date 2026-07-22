# `flagforge update` — self-update dell'istanza (orchestratore)

**Data:** 2026-07-22
**Stato:** approvato

## Obiettivo

Aggiungere un comando `flagforge update` che aggiorna l'istanza server
all'ultima versione pubblicata su npm, riducendo la procedura manuale (oggi:
`npm i -g flagforge@latest` + `nodenv rehash` + restart, con la complicazione
dei permessi root).

Il comando è un **orchestratore onesto**: esegue i passi che può con i
permessi correnti e, dove servono privilegi che non ha (root), stampa i
comandi esatti invece di fallire silenziosamente o fingere.

## Principi di design

- **Onesto sui permessi.** L'update globale richiede spesso root (dir npm/
  nodenv di proprietà di root, mentre il server gira come utente non-root).
  Il comando non finge: se non può installare, lo dice e stampa i comandi
  root.
- **Non tocca mai il restart.** Come gira il processo (pm2, systemd, docker,
  manuale) non è conoscibile dal comando. Quindi NON riavvia e NON prescrive
  un comando di restart: si limita a dire che un riavvio è necessario.
- **Nessuna magia di detection.** Per capire se può installare, prova e cattura
  l'errore di permessi, invece di indovinare i permessi in anticipo.

## 1. Comando CLI (`src/cli.ts`)

- Nuovo `case 'update'` nello `switch (cmd)` → `runUpdate()`.
- Aggiunto alla voce help (`printHelp`).
- (Opzionale) flag `--check`: esegue solo il controllo versione senza azioni.

## 2. Logica di `runUpdate()`

Sequenza:

1. **Versione corrente**: riusa `readVersion()` (già presente nel CLI).
2. **Ultima versione su npm**: `npm view flagforge version` via
   `child_process` (riusa la config npm dell'utente, nessuna dipendenza da
   fetch HTTP diretto).
3. **Confronto**:
   - se già all'ultima → stampa "Già all'ultima versione (X.Y.Z)" ed esce.
4. **Se c'è un update** → tenta `npm i -g flagforge@latest` (output in
   streaming):
   - **successo** → se `nodenv` è nel PATH, esegue `nodenv rehash`; altrimenti
     lo salta con una nota. Poi passa all'output finale "installato".
   - **fallimento per permessi (EACCES)** → cattura l'errore, **non ritenta**,
     e passa all'output finale "non ha potuto".

## 3. Output finale (solo cos'ha fatto — mai un comando di restart)

- **Installato**: "Aggiornato da X.Y.Z a A.B.C." + riga neutra: "Riavvia il
  servizio per applicare la nuova versione." (nessun comando specifico).
- **Non ha potuto (EACCES)**: "Impossibile aggiornare: permessi insufficienti.
  Esegui come root: `npm i -g flagforge@latest`" (+ `nodenv rehash` se `nodenv`
  è stato rilevato). Questi comandi di **install** sono legittimi — sono
  l'azione che l'orchestratore avrebbe eseguito. **Nessun comando di restart.**
- **Già aggiornato**: "Già all'ultima versione (X.Y.Z)."

Regola: i comandi di *install* compaiono solo nel caso EACCES; un comando di
*restart* non compare mai (dipende dal process manager, non conoscibile).

## 4. Testing

`runUpdate` esegue comandi esterni (`npm view`, `npm i -g`, `nodenv`): va
progettato con l'esecutore iniettabile per testarlo senza toccare npm reale.

- Estrarre l'esecuzione comandi dietro una dipendenza iniettabile (es. un
  `runner`/`exec` passato a `runUpdate`), così i test simulano gli esiti.
- **Casi**:
  - già aggiornato (`npm view` = versione corrente) → nessuna install, messaggio
    "già all'ultima";
  - update disponibile + install ok + `nodenv` presente → esegue `rehash`,
    messaggio "aggiornato";
  - update disponibile + install ok + `nodenv` assente → skip rehash con nota,
    messaggio "aggiornato";
  - install fallisce con EACCES → nessun retry, stampa comandi root di install;
  - **assertion trasversale**: nessun output contiene mai un comando di restart.

## 5. Fuori scope

- **Restart del processo**: dipende dal process manager, non prescritto.
- **Rollback** automatico a versione precedente.
- **Auto-update schedulato**.
- Modello a chiavi API client/secret: feature indipendente, spec separata.
