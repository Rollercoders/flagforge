#!/usr/bin/env node
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { intro, outro, text, select, confirm, isCancel, cancel, note, log } from '@clack/prompts';
import { startServer, ServerConfig } from './server.js';
import {
  buildConfigFromAnswers,
  defaultStoragePath,
  renderEnvFile,
  WizardAnswers,
} from './cliConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp(): void {
  console.log(`
FlagForge — open-source feature flagging platform

Usage:
  flagforge init      Configura e avvia FlagForge (wizard interattivo)
  flagforge start     Avvia FlagForge usando il .env esistente
  flagforge --help    Mostra questo messaggio
  flagforge --version Mostra la versione
`);
}

function bail(): never {
  cancel('Operazione annullata.');
  process.exit(0);
}

async function runInit(): Promise<void> {
  intro('FlagForge — setup');

  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const overwrite = await confirm({
      message: 'Esiste già un .env in questa cartella. Vuoi riconfigurare e sovrascriverlo?',
      initialValue: false,
    });
    if (isCancel(overwrite)) bail();
    if (!overwrite) {
      log.info('Mantengo il .env esistente. Avvio con la configurazione attuale…');
      await runStart();
      return;
    }
  }

  const portRaw = await text({
    message: 'Su quale porta vuoi avviare FlagForge?',
    initialValue: '6789',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return 'Inserisci una porta valida (1-65535).';
      return undefined;
    },
  });
  if (isCancel(portRaw)) bail();

  const storageType = await select({
    message: 'Quale storage vuoi usare?',
    options: [
      { value: 'sqlite', label: 'SQLite (consigliato)' },
      { value: 'json', label: 'File JSON' },
    ],
    initialValue: 'sqlite',
  });
  if (isCancel(storageType)) bail();

  const storagePath = await text({
    message: 'Percorso dello storage:',
    initialValue: defaultStoragePath(storageType as 'sqlite' | 'json'),
  });
  if (isCancel(storagePath)) bail();

  const adminPassword = await text({
    message: 'Admin password (lascia vuoto per generarne una automaticamente):',
    initialValue: '',
  });
  if (isCancel(adminPassword)) bail();

  const answers: WizardAnswers = {
    port: Number(portRaw),
    storageType: storageType as 'sqlite' | 'json',
    storagePath: storagePath as string,
    adminPassword: (adminPassword as string).trim() || undefined,
  };

  const config = buildConfigFromAnswers(answers);

  // Crea la cartella data/ (deriva dal path dello storage)
  const dataDir = dirname(join(process.cwd(), config.storagePath));
  mkdirSync(dataDir, { recursive: true });

  // Scrive .env (senza ancora la password generata; verrà aggiunta dopo l'avvio se generata)
  writeFileSync(envPath, renderEnvFile(config), 'utf8');

  await launch(config, envPath);
  outro('FlagForge è pronto. Buon feature-flagging!');
}

async function runStart(): Promise<void> {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.error('Nessun .env trovato in questa cartella. Esegui prima `flagforge init`.');
    process.exit(1);
  }
  // Carica .env tramite dotenv senza sovrascrivere variabili già presenti in process.env.
  dotenv.config({ path: envPath, override: false });

  const config: ServerConfig = {
    port: Number(process.env.PORT) || 6789,
    storageType: (process.env.STORAGE_TYPE as 'sqlite' | 'json') || 'sqlite',
    storagePath: process.env.STORAGE_PATH || './data/flagforge.db',
    adminPassword: process.env.ADMIN_PASSWORD,
  };
  await launch(config, envPath);
  outro('FlagForge è in esecuzione.');
}

async function launch(config: ServerConfig, envPath: string): Promise<void> {
  try {
    const result = await startServer(config);

    // Persisti la password generata su .env, così `start` la riusa.
    if (result.generatedPassword) {
      try {
        const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
        const sep = current.endsWith('\n') || current === '' ? '' : '\n';
        writeFileSync(envPath, `${current}${sep}ADMIN_PASSWORD=${result.adminPassword}\n`, 'utf8');
      } catch {
        // non bloccante
      }
      note(
        `Admin password (generata):\n  ${result.adminPassword}\n\nSalvata in .env — conservala.`,
        'Credenziali'
      );
    }

    note(`FlagForge è in esecuzione su:\n  ${result.url}`, 'Pronto');
  } catch (err) {
    console.error((err as Error).message ?? err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'init':
      await runInit();
      break;
    case 'start':
      await runStart();
      break;
    case '--version':
    case '-v':
      console.log(readVersion());
      break;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Comando sconosciuto: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main();
