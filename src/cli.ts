#!/usr/bin/env node
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { intro, outro, text, password, select, confirm, isCancel, cancel, note, log } from '@clack/prompts';
import { nanoid } from 'nanoid';
import { startServer, ServerConfig } from './server.js';
import {
  buildConfigFromAnswers,
  defaultStoragePath,
  renderEnvFile,
  WizardAnswers,
} from './cliConfig.js';
import { runUpdate, RunResult } from './updater.js';

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
  flagforge init      Configure and start FlagForge (interactive wizard)
  flagforge start     Start FlagForge using the existing .env
  flagforge update    Update FlagForge to the latest version (where permissions allow)
  flagforge --help    Show this message
  flagforge --version Show the version
`);
}

function bail(): never {
  cancel('Operation cancelled.');
  process.exit(0);
}

async function runInit(): Promise<void> {
  intro('FlagForge — setup');

  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const overwrite = await confirm({
      message: 'A .env already exists in this folder. Reconfigure and overwrite it?',
      initialValue: false,
    });
    if (isCancel(overwrite)) bail();
    if (!overwrite) {
      log.info('Keeping the existing .env. Starting with the current configuration…');
      await runStart();
      return;
    }
  }

  const portRaw = await text({
    message: 'Which port should FlagForge run on?',
    initialValue: '6789',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return 'Enter a valid port (1-65535).';
      return undefined;
    },
  });
  if (isCancel(portRaw)) bail();

  const storageType = await select({
    message: 'Which storage do you want to use?',
    options: [
      { value: 'sqlite', label: 'SQLite (recommended)' },
      { value: 'json', label: 'JSON file' },
    ],
    initialValue: 'sqlite',
  });
  if (isCancel(storageType)) bail();

  const storagePath = await text({
    message: 'Storage path:',
    initialValue: defaultStoragePath(storageType as 'sqlite' | 'json'),
  });
  if (isCancel(storagePath)) bail();

  const adminPassword = await password({
    message: 'Admin password (leave empty to auto-generate one):',
  });
  if (isCancel(adminPassword)) bail();

  const enableMcp = await confirm({
    message: 'Setup also FlagForge MCP server? (lets AI agents manage flags)',
    initialValue: false,
  });
  if (isCancel(enableMcp)) bail();
  const mcpToken = enableMcp ? `ff_mcp_${nanoid(32)}` : undefined;

  const answers: WizardAnswers = {
    port: Number(portRaw),
    storageType: storageType as 'sqlite' | 'json',
    storagePath: storagePath,
    adminPassword: adminPassword.trim() || undefined,
    mcpToken,
  };

  const config = buildConfigFromAnswers(answers);

  // Create the data/ folder (derived from the storage path)
  const dataDir = dirname(join(process.cwd(), config.storagePath));
  mkdirSync(dataDir, { recursive: true });

  // Write .env (without the generated password yet; it's added after startup if generated)
  writeFileSync(envPath, renderEnvFile(config), 'utf8');

  await launch(config, envPath);

  if (mcpToken) {
    note(
      `MCP endpoint: http://<host>:${config.port}/mcp\n` +
      `Token (saved in .env):\n  ${mcpToken}\n\n` +
      `MCP client config (replace <host>):\n` +
      JSON.stringify(
        { mcpServers: { flagforge: { url: `http://<host>:${config.port}/mcp`, headers: { Authorization: `Bearer ${mcpToken}` } } } },
        null,
        2,
      ),
      'FlagForge MCP',
    );
  }

  outro('FlagForge is ready. Happy feature-flagging!');
}

async function runStart(): Promise<void> {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.error('No .env found in this folder. Run `flagforge init` first.');
    process.exit(1);
  }
  // Load .env via dotenv without overriding variables already present in process.env.
  dotenv.config({ path: envPath, override: false });

  const config: ServerConfig = {
    port: Number(process.env.PORT) || 6789,
    storageType: (process.env.STORAGE_TYPE as 'sqlite' | 'json') || 'sqlite',
    storagePath: process.env.STORAGE_PATH || './data/flagforge.db',
    adminPassword: process.env.ADMIN_PASSWORD,
    mcpToken: process.env.MCP_TOKEN,
  };
  await launch(config, envPath);
  outro('FlagForge is running.');
}

function runRealUpdate(): void {
  const run = (cmd: string, args: string[]): RunResult => {
    const res = spawnSync(cmd, args, { encoding: 'utf8' });
    return {
      status: res.status ?? (res.error ? 1 : 0),
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      error: res.error as NodeJS.ErrnoException | undefined,
    };
  };
  const hasCommand = (cmd: string): boolean => {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
    return (probe.status ?? 1) === 0;
  };
  runUpdate({
    currentVersion: readVersion(),
    run,
    hasCommand,
    log: (m) => console.log(m),
  });
}

async function launch(config: ServerConfig, envPath: string): Promise<void> {
  try {
    const result = await startServer(config);

    // Persist the generated password to .env so `start` reuses it.
    if (result.generatedPassword) {
      try {
        const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
        const sep = current.endsWith('\n') || current === '' ? '' : '\n';
        writeFileSync(envPath, `${current}${sep}ADMIN_PASSWORD=${result.adminPassword}\n`, 'utf8');
      } catch {
        // non-blocking
      }
      note(
        `Admin password (generated):\n  ${result.adminPassword}\n\nSaved in .env — keep it safe.`,
        'Credentials'
      );
    }

    note(`FlagForge is running at:\n  ${result.url}`, 'Ready');
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
    case 'update':
      runRealUpdate();
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
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error((err as Error).message ?? err);
  process.exit(1);
});
